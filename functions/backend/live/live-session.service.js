const { EventEmitter } = require('events');
const { ApiError } = require('../lib/http.js');

const sessions = new Map();
const streamConnections = new Map();

const clone = (value) => JSON.parse(JSON.stringify(value));
const nowIso = () => new Date().toISOString();

const sanitizeParticipant = (participant) => ({
  userId: participant.userId,
  name: participant.name,
  role: participant.role,
  joinedAt: participant.joinedAt,
  lastSeenAt: participant.lastSeenAt,
  micMuted: participant.micMuted,
  videoEnabled: participant.videoEnabled,
  handRaised: participant.handRaised,
  handStatus: participant.handStatus,
  canSpeak: participant.canSpeak,
  isScreenSharing: participant.isScreenSharing,
  isPresenting: participant.isPresenting,
  removed: participant.removed,
});

const sanitizeSession = (session) => ({
  liveClassId: session.liveClassId,
  status: session.status,
  roomName: session.roomName,
  startedAt: session.startedAt,
  endedAt: session.endedAt,
  activePresenterId: session.activePresenterId,
  participants: Array.from(session.participants.values())
    .filter((participant) => !participant.removed)
    .sort((left, right) => {
      if (left.role !== right.role) {
        return left.role === 'admin' ? -1 : 1;
      }
      return Date.parse(left.joinedAt) - Date.parse(right.joinedAt);
    })
    .map(sanitizeParticipant),
});

const ensureSession = (liveClass, overrides = {}) => {
  const liveClassId = String(liveClass._id);
  if (!sessions.has(liveClassId)) {
    sessions.set(liveClassId, {
      liveClassId,
      status: String(overrides.status || liveClass.status || 'scheduled'),
      roomName: String(
        overrides.roomName
          || liveClass.roomName
          || liveClass.liveRoomName
          || `edumaster-live-${liveClassId}`,
      ),
      startedAt: overrides.startedAt || null,
      endedAt: overrides.endedAt || null,
      activePresenterId: null,
      participants: new Map(),
      emitter: new EventEmitter(),
    });
  }

  const session = sessions.get(liveClassId);
  if (overrides.status) {
    session.status = String(overrides.status);
  }
  if (overrides.roomName) {
    session.roomName = String(overrides.roomName);
  }
  if (overrides.startedAt !== undefined) {
    session.startedAt = overrides.startedAt;
  }
  if (overrides.endedAt !== undefined) {
    session.endedAt = overrides.endedAt;
  }
  return session;
};

const getSessionOrThrow = (liveClassId) => {
  const session = sessions.get(String(liveClassId));
  if (!session) {
    throw new ApiError(404, 'Live session not found', { code: 'LIVE_SESSION_NOT_FOUND' });
  }
  return session;
};

const publish = (session, event, payload = {}) => {
  const message = {
    event,
    liveClassId: session.liveClassId,
    timestamp: nowIso(),
    ...payload,
  };

  session.emitter.emit('event', message);
  const listeners = streamConnections.get(session.liveClassId) || new Set();
  listeners.forEach((res) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(message)}\n\n`);
  });
};

const getSessionSnapshot = (liveClass) => sanitizeSession(ensureSession(liveClass));

const syncStatus = (liveClass, nextStatus) => {
  const session = ensureSession(liveClass, {
    status: nextStatus,
    startedAt: nextStatus === 'live' ? (sessions.get(String(liveClass._id))?.startedAt || nowIso()) : sessions.get(String(liveClass._id))?.startedAt || null,
    endedAt: nextStatus === 'ended' ? nowIso() : null,
  });

  if (nextStatus === 'ended') {
    session.activePresenterId = null;
    session.participants.forEach((participant) => {
      participant.canSpeak = false;
      participant.handRaised = false;
      participant.handStatus = 'idle';
      participant.isScreenSharing = false;
      participant.isPresenting = false;
    });
  }

  publish(session, 'session.updated', { session: sanitizeSession(session) });
  return sanitizeSession(session);
};

const joinSession = (liveClass, user) => {
  const session = ensureSession(liveClass);
  const existing = session.participants.get(String(user._id)) || null;
  const participant = {
    userId: String(user._id),
    name: user.name,
    role: user.role,
    joinedAt: existing?.joinedAt || nowIso(),
    lastSeenAt: nowIso(),
    micMuted: existing?.micMuted ?? (user.role !== 'admin'),
    videoEnabled: existing?.videoEnabled ?? (user.role === 'admin'),
    handRaised: false,
    handStatus: existing?.handStatus || 'idle',
    canSpeak: existing?.canSpeak ?? (user.role === 'admin'),
    isScreenSharing: existing?.isScreenSharing ?? false,
    isPresenting: existing?.isPresenting ?? (user.role === 'admin'),
    removed: false,
  };

  session.participants.set(participant.userId, participant);
  if (participant.isPresenting || participant.isScreenSharing) {
    session.activePresenterId = participant.userId;
  }

  publish(session, 'participant.joined', {
    participant: sanitizeParticipant(participant),
    session: sanitizeSession(session),
  });
  return sanitizeParticipant(participant);
};

const leaveSession = (liveClassId, userId) => {
  const session = getSessionOrThrow(liveClassId);
  const participant = session.participants.get(String(userId));
  if (!participant) {
    return sanitizeSession(session);
  }

  participant.lastSeenAt = nowIso();
  participant.videoEnabled = false;
  participant.isPresenting = false;
  participant.isScreenSharing = false;

  if (session.activePresenterId === participant.userId) {
    session.activePresenterId = null;
  }

  publish(session, 'participant.left', {
    participant: sanitizeParticipant(participant),
    session: sanitizeSession(session),
  });
  return sanitizeSession(session);
};

const heartbeat = (liveClassId, userId) => {
  const session = getSessionOrThrow(liveClassId);
  const participant = session.participants.get(String(userId));
  if (!participant || participant.removed) {
    throw new ApiError(403, 'Participant is not active in this session', { code: 'LIVE_PARTICIPANT_INACTIVE' });
  }
  participant.lastSeenAt = nowIso();
  return sanitizeParticipant(participant);
};

const updateParticipantMedia = (liveClassId, userId, payload = {}) => {
  const session = getSessionOrThrow(liveClassId);
  const participant = session.participants.get(String(userId));
  if (!participant || participant.removed) {
    throw new ApiError(403, 'Participant is not active in this session', { code: 'LIVE_PARTICIPANT_INACTIVE' });
  }

  if (typeof payload.micMuted === 'boolean') {
    participant.micMuted = payload.micMuted;
  }
  if (typeof payload.videoEnabled === 'boolean') {
    participant.videoEnabled = payload.videoEnabled;
  }
  if (typeof payload.isScreenSharing === 'boolean') {
    participant.isScreenSharing = payload.isScreenSharing;
    if (payload.isScreenSharing) {
      participant.isPresenting = true;
      session.activePresenterId = participant.userId;
    } else if (session.activePresenterId === participant.userId) {
      session.activePresenterId = null;
    }
  }

  participant.lastSeenAt = nowIso();
  publish(session, 'participant.media-updated', {
    participant: sanitizeParticipant(participant),
    session: sanitizeSession(session),
  });
  return sanitizeParticipant(participant);
};

const setRaisedHand = (liveClassId, userId, raised) => {
  const session = getSessionOrThrow(liveClassId);
  const participant = session.participants.get(String(userId));
  if (!participant || participant.removed) {
    throw new ApiError(403, 'Participant is not active in this session', { code: 'LIVE_PARTICIPANT_INACTIVE' });
  }

  participant.handRaised = Boolean(raised);
  participant.handStatus = raised ? 'pending' : 'idle';
  if (!raised && participant.role !== 'admin') {
    participant.canSpeak = false;
  }

  publish(session, 'participant.hand-updated', {
    participant: sanitizeParticipant(participant),
    session: sanitizeSession(session),
  });
  return sanitizeParticipant(participant);
};

const setSpeakerApproval = (liveClassId, targetUserId, approved) => {
  const session = getSessionOrThrow(liveClassId);
  const participant = session.participants.get(String(targetUserId));
  if (!participant || participant.removed) {
    throw new ApiError(404, 'Participant not found', { code: 'LIVE_PARTICIPANT_NOT_FOUND' });
  }

  participant.canSpeak = Boolean(approved);
  participant.handRaised = false;
  participant.handStatus = approved ? 'approved' : 'rejected';
  if (!approved) {
    participant.micMuted = true;
  }

  publish(session, 'participant.speaking-updated', {
    participant: sanitizeParticipant(participant),
    session: sanitizeSession(session),
  });
  return sanitizeParticipant(participant);
};

const setParticipantMuted = (liveClassId, targetUserId, muted) => {
  const session = getSessionOrThrow(liveClassId);
  const participant = session.participants.get(String(targetUserId));
  if (!participant || participant.removed) {
    throw new ApiError(404, 'Participant not found', { code: 'LIVE_PARTICIPANT_NOT_FOUND' });
  }

  participant.micMuted = Boolean(muted);

  publish(session, 'participant.mute-updated', {
    participant: sanitizeParticipant(participant),
    session: sanitizeSession(session),
  });
  return sanitizeParticipant(participant);
};

const removeParticipant = (liveClassId, targetUserId) => {
  const session = getSessionOrThrow(liveClassId);
  const participant = session.participants.get(String(targetUserId));
  if (!participant) {
    throw new ApiError(404, 'Participant not found', { code: 'LIVE_PARTICIPANT_NOT_FOUND' });
  }

  participant.removed = true;
  participant.canSpeak = false;
  participant.micMuted = true;
  participant.videoEnabled = false;
  participant.isPresenting = false;
  participant.isScreenSharing = false;
  participant.lastSeenAt = nowIso();

  if (session.activePresenterId === participant.userId) {
    session.activePresenterId = null;
  }

  publish(session, 'participant.removed', {
    participant: sanitizeParticipant(participant),
    session: sanitizeSession(session),
  });
  return sanitizeParticipant(participant);
};

const publishChat = (liveClassId, chatMessage) => {
  const session = getSessionOrThrow(liveClassId);
  publish(session, 'chat.message', { message: clone(chatMessage) });
};

const registerStream = (liveClassId, res) => {
  const key = String(liveClassId);
  const listeners = streamConnections.get(key) || new Set();
  listeners.add(res);
  streamConnections.set(key, listeners);
};

const unregisterStream = (liveClassId, res) => {
  const key = String(liveClassId);
  const listeners = streamConnections.get(key);
  if (!listeners) {
    return;
  }
  listeners.delete(res);
  if (listeners.size === 0) {
    streamConnections.delete(key);
  }
};

module.exports = {
  ensureSession,
  getSessionSnapshot,
  syncStatus,
  joinSession,
  leaveSession,
  heartbeat,
  updateParticipantMedia,
  setRaisedHand,
  setSpeakerApproval,
  setParticipantMuted,
  removeParticipant,
  publishChat,
  registerStream,
  unregisterStream,
};
