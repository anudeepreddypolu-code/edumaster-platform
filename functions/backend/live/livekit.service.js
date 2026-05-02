const {
  AccessToken,
  RoomServiceClient,
  TrackSource,
} = require('livekit-server-sdk');
const { appConfig } = require('../lib/config.js');

const toLiveKitControlUrl = (value) => {
  const url = new URL(String(value || ''));
  if (url.protocol === 'wss:') {
    url.protocol = 'https:';
  } else if (url.protocol === 'ws:') {
    url.protocol = 'http:';
  }
  return url.origin;
};

const getRoomServiceClient = () => {
  if (!appConfig.hasLiveKit) {
    return null;
  }

  return new RoomServiceClient(
    toLiveKitControlUrl(appConfig.livekitUrl),
    appConfig.livekitApiKey,
    appConfig.livekitApiSecret,
  );
};

const getRoomName = (liveClass) => String(
  liveClass?.roomName
    || liveClass?.liveRoomName
    || `${appConfig.livekitRoomPrefix}-${String(liveClass?._id || '')}`,
);

const getParticipantIdentity = (userId) => String(userId || '');

const buildPublishSources = ({ isAdmin, canSpeak, micMuted }) => {
  if (isAdmin) {
    return [
      TrackSource.CAMERA,
      TrackSource.MICROPHONE,
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
    ];
  }

  const sources = [TrackSource.CAMERA];
  if (canSpeak && !micMuted) {
    sources.push(TrackSource.MICROPHONE);
  }
  return sources;
};

const buildParticipantPermission = ({ isAdmin, canSpeak, micMuted }) => {
  const canPublishSources = buildPublishSources({ isAdmin, canSpeak, micMuted });
  return {
    canSubscribe: true,
    canPublish: canPublishSources.length > 0,
    canPublishData: true,
    canPublishSources,
    hidden: false,
  };
};

const createRoomIfMissing = async (liveClass) => {
  const client = getRoomServiceClient();
  if (!client) {
    return null;
  }

  const roomName = getRoomName(liveClass);
  try {
    await client.createRoom({
      name: roomName,
      emptyTimeout: 60 * 30,
      departureTimeout: 60 * 5,
      maxParticipants: Number(liveClass?.maxAttendees || appConfig.liveClassMaxAttendees || 2500),
      metadata: JSON.stringify({
        liveClassId: String(liveClass?._id || ''),
        title: liveClass?.title || 'Live class',
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (!/already exists|already_exists|exists/i.test(message)) {
      throw error;
    }
  }

  return roomName;
};

const buildToken = async ({ liveClass, user, participant }) => {
  if (!appConfig.hasLiveKit) {
    return null;
  }

  const roomName = await createRoomIfMissing(liveClass);
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const permission = buildParticipantPermission({
    isAdmin,
    canSpeak: participant?.canSpeak ?? isAdmin,
    micMuted: participant?.micMuted ?? !isAdmin,
  });
  const ttlSeconds = Number(appConfig.livekitTokenTtlSeconds || 600);
  const issuedAt = Date.now();
  const token = new AccessToken(
    appConfig.livekitApiKey,
    appConfig.livekitApiSecret,
    {
      ttl: ttlSeconds,
      identity: getParticipantIdentity(user?._id),
      name: user?.name || user?.email || 'Live participant',
      metadata: JSON.stringify({
        userId: String(user?._id || ''),
        email: user?.email || '',
        role: user?.role || 'student',
        liveClassId: String(liveClass?._id || ''),
      }),
      attributes: {
        role: String(user?.role || 'student'),
        liveClassId: String(liveClass?._id || ''),
      },
    },
  );
  token.addGrant({
    roomJoin: true,
    roomAdmin: isAdmin,
    room: roomName,
    ...permission,
  });

  return {
    roomName,
    token: await token.toJwt(),
    identity: getParticipantIdentity(user?._id),
    tokenExpiresAt: new Date(issuedAt + (ttlSeconds * 1000)).toISOString(),
  };
};

const syncParticipantPermission = async (liveClass, participant) => {
  const client = getRoomServiceClient();
  if (!client || !participant?.userId) {
    return null;
  }

  const roomName = getRoomName(liveClass);
  const identity = getParticipantIdentity(participant.userId);
  const permission = buildParticipantPermission({
    isAdmin: String(participant.role || '').toLowerCase() === 'admin',
    canSpeak: Boolean(participant.canSpeak),
    micMuted: Boolean(participant.micMuted),
  });

  try {
    await client.updateParticipant(roomName, identity, { permission });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (!/not found|participant does not exist|does not exist|could not find/i.test(message)) {
      throw error;
    }
    return null;
  }

  try {
    const participantInfo = await client.getParticipant(roomName, identity);
    const microphoneTrack = (participantInfo?.tracks || []).find((track) =>
      Number(track.source) === Number(TrackSource.MICROPHONE));
    if (microphoneTrack?.sid) {
      await client.mutePublishedTrack(roomName, identity, microphoneTrack.sid, Boolean(participant.micMuted));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (!/not found|participant does not exist|does not exist|could not find/i.test(message)) {
      throw error;
    }
  }

  return true;
};

const removeParticipant = async (liveClass, userId) => {
  const client = getRoomServiceClient();
  if (!client || !userId) {
    return null;
  }

  try {
    await client.removeParticipant(getRoomName(liveClass), getParticipantIdentity(userId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (!/not found|participant does not exist|does not exist|could not find/i.test(message)) {
      throw error;
    }
  }

  return true;
};

const closeRoom = async (liveClass) => {
  const client = getRoomServiceClient();
  if (!client) {
    return null;
  }

  try {
    await client.deleteRoom(getRoomName(liveClass));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (!/not found|does not exist|could not find/i.test(message)) {
      throw error;
    }
  }

  return true;
};

module.exports = {
  getRoomName,
  getParticipantIdentity,
  createRoomIfMissing,
  buildToken,
  syncParticipantPermission,
  removeParticipant,
  closeRoom,
};
