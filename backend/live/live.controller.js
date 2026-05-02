const { liveClassesRepository, usersRepository } = require('../lib/repositories.js');
const path = require('path');
const {
  ApiError,
  asyncHandler,
  ok,
  created,
  requireString,
  optionalString,
  requireNumber,
  requireBoolean,
} = require('../lib/http.js');
const { appConfig } = require('../lib/config.js');
const sessionService = require('./live-session.service.js');
const liveKitService = require('./livekit.service.js');
const { issuePlaybackToken, verifyPlaybackToken } = require('../lib/private-video.js');
const {
  getSignedPrivateVideoUrl,
  getPrivateStorageObjectBuffer,
  isS3Provider,
} = require('../lib/private-video-storage.js');
const {
  getHlsAssetMimeType,
  rewriteHlsManifestUris,
} = require('../lib/hls-manifest.js');

const slugify = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 64);

const buildJitsiUrls = (liveClassId, title) => {
  const roomName = `edumaster-${slugify(title) || 'live-class'}-${String(liveClassId)}`;
  const roomUrl = `https://${appConfig.jitsiMeetDomain}/${roomName}`;
  const embedUrl = `${roomUrl}#config.prejoinPageEnabled=false&config.requireDisplayName=false&config.disableDeepLinking=true&config.startWithAudioMuted=false&config.startWithVideoMuted=false&interfaceConfig.DISABLE_JOIN_LEAVE_NOTIFICATIONS=true`;
  return { roomName, roomUrl, embedUrl };
};

const buildManagedHlsPlaybackUrl = (streamName) => {
  if (!appConfig.liveHlsInternalBaseUrl || !streamName) {
    return null;
  }

  return `${String(appConfig.liveHlsInternalBaseUrl).replace(/\/+$/, '')}/${encodeURIComponent(String(streamName))}/master.m3u8`;
};

const buildAdminIngestDetails = (liveClass) => {
  if (!appConfig.liveIngestStreamBaseUrl || !appConfig.liveIngestPublisherSecret) {
    return liveClass;
  }

  const streamName = liveClass.courseId && liveClass.moduleId
    ? `${liveClass._id}__${liveClass.courseId}__${liveClass.moduleId}__${liveClass.chapterId || 'root'}`
    : String(liveClass._id);

  return {
    ...liveClass,
    ingestServerUrl: appConfig.liveIngestStreamBaseUrl,
    ingestStreamKey: `${streamName}?secret=${appConfig.liveIngestPublisherSecret}`,
  };
};

const buildLiveHlsAssetUrl = (payload, storagePath, mimeType) => {
  const issued = issuePlaybackToken({
    userId: payload.userId,
    sessionId: payload.sessionId,
    liveClassId: payload.liveClassId,
    storageProvider: payload.storageProvider || 'local',
    storagePath,
    mimeType,
    assetKind: 'hls',
  });
  return `/backend/api/live-classes/stream/${issued.token}`;
};

const sanitizeTeacherProfileInput = (value, fallbackName = 'Live Faculty') => {
  const profile = value && typeof value === 'object' ? value : {};
  return {
    name: optionalString(profile.name, fallbackName, { maxLength: 120 }),
    role: optionalString(profile.role, '', { maxLength: 120 }) || null,
    experience: optionalString(profile.experience, '', { maxLength: 160 }) || null,
    bio: optionalString(profile.bio, '', { maxLength: 1200 }) || null,
    avatarUrl: optionalString(profile.avatarUrl, '', { maxLength: 2000 }) || null,
  };
};

const sanitizeResourceItemsInput = (value) => (
  Array.isArray(value)
    ? value
      .map((item, index) => {
        const entry = item && typeof item === 'object' ? item : {};
        const title = optionalString(entry.title, '', { maxLength: 160 });
        if (!title) {
          return null;
        }
        return {
          id: optionalString(entry.id, `resource-${index + 1}`, { maxLength: 80 }) || `resource-${index + 1}`,
          title,
          type: optionalString(entry.type, '', { maxLength: 40 }) || null,
          url: optionalString(entry.url, '', { maxLength: 2000 }) || null,
          description: optionalString(entry.description, '', { maxLength: 500 }) || null,
          lines: Array.isArray(entry.lines)
            ? entry.lines.map((line) => optionalString(line, '', { maxLength: 240 })).filter(Boolean)
            : [],
        };
      })
      .filter(Boolean)
    : []
);

const sanitizeActivePollInput = (value) => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const question = optionalString(value.question, '', { maxLength: 240 });
  const options = Array.isArray(value.options)
    ? value.options
      .map((option, index) => {
        const entry = option && typeof option === 'object' ? option : {};
        const text = optionalString(entry.text, '', { maxLength: 120 });
        if (!text) {
          return null;
        }
        return {
          id: optionalString(entry.id, `option-${index + 1}`, { maxLength: 80 }) || `option-${index + 1}`,
          text,
        };
      })
      .filter(Boolean)
    : [];

  if (!question || options.length === 0) {
    return null;
  }

  return {
    question,
    status: optionalString(value.status, 'live', { maxLength: 40 }) || 'live',
    options,
  };
};

const rewriteLiveHlsManifest = (manifestText, payload) => rewriteHlsManifestUris(manifestText, (assetReference) => {
  const resolvedAssetPath = path.posix.join(path.posix.dirname(payload.storagePath), assetReference);
  return buildLiveHlsAssetUrl(payload, resolvedAssetPath, getHlsAssetMimeType(resolvedAssetPath));
});

const getActingUser = async (req) => {
  const user = await usersRepository.findById(req.user?.id || '');
  if (!user) {
    throw new ApiError(404, 'User not found', { code: 'USER_NOT_FOUND' });
  }
  return user;
};

const requireAdmin = (req) => {
  if (req.user?.role !== 'admin') {
    throw new ApiError(403, 'Admin access required', { code: 'ADMIN_REQUIRED' });
  }
};

const findLiveClassOrThrow = async (liveClassId) => {
  const liveClass = await liveClassesRepository.findRawById(liveClassId);
  if (!liveClass) {
    throw new ApiError(404, 'Live class not found', { code: 'LIVE_CLASS_NOT_FOUND' });
  }
  return liveClass;
};

const listLiveClasses = asyncHandler(async (_req, res) => {
  const liveClasses = await liveClassesRepository.list();
  return ok(res, { liveClasses });
});

const listAdminLiveClasses = asyncHandler(async (req, res) => {
  requireAdmin(req);
  const liveClasses = await liveClassesRepository.listAdmin();
  return ok(res, { liveClasses: liveClasses.map(buildAdminIngestDetails) });
});

const createLiveClass = asyncHandler(async (req, res) => {
  requireAdmin(req);
  const title = requireString(req.body?.title, 'title', { maxLength: 160 });
  const startTime = requireString(req.body?.startTime, 'startTime');
  const durationMinutes = requireNumber(req.body?.durationMinutes ?? 60, 'durationMinutes', { min: 15, max: 480 });
  const provider = optionalString(req.body?.provider, appConfig.hasLiveKit ? 'LiveKit Cloud' : 'Jitsi Meet', { maxLength: 80 });
  const mockTestId = optionalString(req.body?.mockTestId, '', { maxLength: 120 }) || null;
  const mockTestTitle = optionalString(req.body?.mockTestTitle, '', { maxLength: 255 }) || null;
  const courseId = optionalString(req.body?.courseId, '', { maxLength: 120 }) || null;
  const linkageType = optionalString(
    req.body?.linkageType,
    mockTestId ? 'mock-test' : courseId ? 'course' : 'standalone',
    { maxLength: 40 },
  );
  const topicTags = Array.isArray(req.body?.topicTags) ? req.body.topicTags.map((tag) => String(tag).trim()).filter(Boolean) : [];
  const instructor = optionalString(req.body?.instructor, 'Live Faculty', { maxLength: 120 });
  const teacherProfile = sanitizeTeacherProfileInput(req.body?.teacherProfile, instructor);
  if (mockTestId && !topicTags.some((tag) => String(tag).toLowerCase() === `mock-test-id:${String(mockTestId).toLowerCase()}`)) {
    topicTags.push(`mock-test-id:${mockTestId}`);
  }
  if (mockTestTitle && !topicTags.some((tag) => String(tag).toLowerCase().startsWith('mock-test:'))) {
    topicTags.push(`mock-test:${mockTestTitle}`);
  }

  const createdLiveClass = await liveClassesRepository.create({
    title,
    linkageType,
    courseId,
    moduleId: optionalString(req.body?.moduleId, '', { maxLength: 120 }) || null,
    moduleTitle: optionalString(req.body?.moduleTitle, '', { maxLength: 160 }) || null,
    chapterId: optionalString(req.body?.chapterId, '', { maxLength: 120 }) || null,
    chapterTitle: optionalString(req.body?.chapterTitle, '', { maxLength: 160 }) || null,
    mockTestId,
    mockTestTitle,
    instructor,
    startTime,
    durationMinutes,
    provider,
    mode: 'live',
    status: optionalString(req.body?.status, 'scheduled', { maxLength: 30 }),
    attendees: requireNumber(req.body?.attendees ?? 0, 'attendees', { min: 0 }),
    maxAttendees: requireNumber(req.body?.maxAttendees ?? 2500, 'maxAttendees', { min: 1, max: 100000 }),
    requiresEnrollment: req.body?.requiresEnrollment === undefined ? true : requireBoolean(req.body.requiresEnrollment, 'requiresEnrollment'),
    chatEnabled: req.body?.chatEnabled === undefined ? true : requireBoolean(req.body.chatEnabled, 'chatEnabled'),
    doubtSolving: req.body?.doubtSolving === undefined ? true : requireBoolean(req.body.doubtSolving, 'doubtSolving'),
    replayAvailable: req.body?.replayAvailable === undefined ? true : requireBoolean(req.body.replayAvailable, 'replayAvailable'),
    posterUrl: optionalString(req.body?.posterUrl, '', { maxLength: 2000 }) || null,
    description: optionalString(req.body?.description, '', { maxLength: 3000 }) || null,
    teacherProfile,
    sessionNotes: Array.isArray(req.body?.sessionNotes)
      ? req.body.sessionNotes.map((item) => optionalString(item, '', { maxLength: 240 })).filter(Boolean)
      : [],
    resources: sanitizeResourceItemsInput(req.body?.resources),
    activePoll: sanitizeActivePollInput(req.body?.activePoll),
    topicTags,
  });

  const jitsi = buildJitsiUrls(createdLiveClass._id, title);
  const livePlaybackType = appConfig.hasLiveKit ? 'livekit' : appConfig.hasManagedLiveHls ? 'hls' : 'jitsi';
  const roomName = appConfig.hasLiveKit ? liveKitService.getRoomName(createdLiveClass) : jitsi.roomName;
  const managedHlsPlaybackUrl = livePlaybackType === 'hls' ? buildManagedHlsPlaybackUrl(createdLiveClass._id) : null;
  const liveClass = await liveClassesRepository.update(createdLiveClass._id, {
    livePlaybackType,
    roomUrl: livePlaybackType === 'jitsi' ? jitsi.roomUrl : null,
    embedUrl: livePlaybackType === 'jitsi' ? jitsi.embedUrl : null,
    livePlaybackUrl: managedHlsPlaybackUrl,
    roomName,
    provider: livePlaybackType === 'hls' ? 'Managed HLS' : provider,
  });

  sessionService.ensureSession(liveClass, {
    status: liveClass.status || 'scheduled',
    roomName,
  });
  return created(res, { liveClass: buildAdminIngestDetails(liveClass) });
});

const updateLiveClass = asyncHandler(async (req, res) => {
  requireAdmin(req);
  const liveClass = await findLiveClassOrThrow(req.params.liveClassId);
  const nextLiveClass = await liveClassesRepository.update(liveClass._id, {
    title: req.body?.title === undefined ? liveClass.title : requireString(req.body.title, 'title', { maxLength: 160 }),
    instructor: req.body?.instructor === undefined ? liveClass.instructor : requireString(req.body.instructor, 'instructor', { maxLength: 120 }),
    startTime: req.body?.startTime === undefined ? liveClass.startTime : requireString(req.body.startTime, 'startTime'),
    durationMinutes: req.body?.durationMinutes === undefined ? liveClass.durationMinutes : requireNumber(req.body.durationMinutes, 'durationMinutes', { min: 15, max: 480 }),
    status: req.body?.status === undefined ? liveClass.status : optionalString(req.body.status, liveClass.status, { maxLength: 30 }),
    linkageType: req.body?.linkageType === undefined ? liveClass.linkageType : optionalString(req.body.linkageType, liveClass.linkageType || 'standalone', { maxLength: 40 }),
    courseId: req.body?.courseId === undefined ? liveClass.courseId : optionalString(req.body.courseId, '', { maxLength: 120 }) || null,
    moduleId: req.body?.moduleId === undefined ? liveClass.moduleId : optionalString(req.body.moduleId, '', { maxLength: 120 }) || null,
    moduleTitle: req.body?.moduleTitle === undefined ? liveClass.moduleTitle : optionalString(req.body.moduleTitle, '', { maxLength: 160 }) || null,
    chapterId: req.body?.chapterId === undefined ? liveClass.chapterId : optionalString(req.body.chapterId, '', { maxLength: 120 }) || null,
    chapterTitle: req.body?.chapterTitle === undefined ? liveClass.chapterTitle : optionalString(req.body.chapterTitle, '', { maxLength: 160 }) || null,
    mockTestId: req.body?.mockTestId === undefined ? liveClass.mockTestId : optionalString(req.body.mockTestId, '', { maxLength: 120 }) || null,
    mockTestTitle: req.body?.mockTestTitle === undefined ? liveClass.mockTestTitle : optionalString(req.body.mockTestTitle, '', { maxLength: 255 }) || null,
    recordingUrl: req.body?.recordingUrl === undefined ? liveClass.recordingUrl : optionalString(req.body.recordingUrl, '', { maxLength: 2000 }) || null,
    recordingStorageProvider: req.body?.recordingStorageProvider === undefined ? liveClass.recordingStorageProvider : optionalString(req.body.recordingStorageProvider, '', { maxLength: 40 }) || null,
    recordingStoragePath: req.body?.recordingStoragePath === undefined ? liveClass.recordingStoragePath : optionalString(req.body.recordingStoragePath, '', { maxLength: 2000 }) || null,
    recordingPublishedAt: req.body?.recordingPublishedAt === undefined ? liveClass.recordingPublishedAt : optionalString(req.body.recordingPublishedAt, '', { maxLength: 80 }) || null,
    recordingExpiresAt: req.body?.recordingExpiresAt === undefined ? liveClass.recordingExpiresAt : optionalString(req.body.recordingExpiresAt, '', { maxLength: 80 }) || null,
    recordingDurationMinutes: req.body?.recordingDurationMinutes === undefined ? liveClass.recordingDurationMinutes : requireNumber(req.body.recordingDurationMinutes, 'recordingDurationMinutes', { min: 1, max: 10000 }),
    replayAvailable: req.body?.replayAvailable === undefined ? liveClass.replayAvailable : requireBoolean(req.body.replayAvailable, 'replayAvailable'),
    replayCourseId: req.body?.replayCourseId === undefined ? liveClass.replayCourseId : optionalString(req.body.replayCourseId, '', { maxLength: 120 }) || null,
    replayLessonId: req.body?.replayLessonId === undefined ? liveClass.replayLessonId : optionalString(req.body.replayLessonId, '', { maxLength: 120 }) || null,
    posterUrl: req.body?.posterUrl === undefined ? liveClass.posterUrl : optionalString(req.body.posterUrl, '', { maxLength: 2000 }) || null,
    description: req.body?.description === undefined ? liveClass.description : optionalString(req.body.description, '', { maxLength: 3000 }) || null,
    teacherProfile: req.body?.teacherProfile === undefined ? liveClass.teacherProfile : sanitizeTeacherProfileInput(req.body.teacherProfile, req.body?.instructor === undefined ? liveClass.instructor : requireString(req.body.instructor, 'instructor', { maxLength: 120 })),
    sessionNotes: Array.isArray(req.body?.sessionNotes)
      ? req.body.sessionNotes.map((item) => optionalString(item, '', { maxLength: 240 })).filter(Boolean)
      : liveClass.sessionNotes,
    resources: req.body?.resources === undefined ? liveClass.resources : sanitizeResourceItemsInput(req.body.resources),
    activePoll: req.body?.activePoll === undefined ? liveClass.activePoll : sanitizeActivePollInput(req.body.activePoll),
    topicTags: Array.isArray(req.body?.topicTags) ? req.body.topicTags.map((tag) => String(tag).trim()).filter(Boolean) : liveClass.topicTags,
  });

  sessionService.ensureSession(nextLiveClass, {
    status: nextLiveClass.status,
    roomName: nextLiveClass.roomName || liveClass.roomName || null,
  });
  return ok(res, { liveClass: buildAdminIngestDetails(nextLiveClass) });
});

const deleteLiveClass = asyncHandler(async (req, res) => {
  requireAdmin(req);
  const liveClass = await findLiveClassOrThrow(req.params.liveClassId);
  await liveClassesRepository.delete(liveClass._id);
  return ok(res, { message: 'Live class deleted successfully', liveClassId: liveClass._id });
});

const startLiveClass = asyncHandler(async (req, res) => {
  requireAdmin(req);
  const liveClass = await findLiveClassOrThrow(req.params.liveClassId);
  const jitsi = buildJitsiUrls(liveClass._id, liveClass.title);
  const livePlaybackType = appConfig.hasLiveKit ? 'livekit' : appConfig.hasManagedLiveHls ? 'hls' : 'jitsi';
  const roomName = appConfig.hasLiveKit ? liveKitService.getRoomName(liveClass) : (liveClass.roomName || jitsi.roomName);
  const managedHlsPlaybackUrl = livePlaybackType === 'hls' ? buildManagedHlsPlaybackUrl(liveClass._id) : null;
  const nextLiveClass = await liveClassesRepository.update(liveClass._id, {
    status: 'live',
    startTime: liveClass.startTime || new Date().toISOString(),
    livePlaybackType,
    provider: appConfig.hasLiveKit ? 'LiveKit Cloud' : appConfig.hasManagedLiveHls ? 'Managed HLS' : (liveClass.provider || 'Jitsi Meet'),
    livePlaybackUrl: managedHlsPlaybackUrl || liveClass.livePlaybackUrl || null,
    roomUrl: livePlaybackType === 'jitsi' ? (liveClass.roomUrl || jitsi.roomUrl) : null,
    embedUrl: livePlaybackType === 'jitsi' ? (liveClass.embedUrl || jitsi.embedUrl) : null,
    roomName,
  });

  if (appConfig.hasLiveKit) {
    await liveKitService.createRoomIfMissing(nextLiveClass);
  }

  const session = sessionService.syncStatus(nextLiveClass, 'live');
  return ok(res, { liveClass: buildAdminIngestDetails(nextLiveClass), session });
});

const endLiveClass = asyncHandler(async (req, res) => {
  requireAdmin(req);
  const liveClass = await findLiveClassOrThrow(req.params.liveClassId);
  const nextLiveClass = await liveClassesRepository.update(liveClass._id, {
    status: 'ended',
  });

  const session = sessionService.syncStatus(nextLiveClass, 'ended');
  if (appConfig.hasLiveKit) {
    await liveKitService.closeRoom(nextLiveClass);
  }
  return ok(res, { liveClass: nextLiveClass, session });
});

const getLiveClassAccess = asyncHandler(async (req, res) => {
  const liveClass = await findLiveClassOrThrow(req.params.liveClassId);
  const access = await liveClassesRepository.getAccess({
    liveClassId: req.params.liveClassId,
    userId: req.user?.id,
  });
  if (access.accessType === 'livekit-room' && appConfig.hasLiveKit) {
    const user = await getActingUser(req);
    const session = sessionService.getSessionSnapshot(liveClass);
    const participant = session.participants.find((entry) => entry.userId === String(user._id)) || null;
    const liveKitAccess = await liveKitService.buildToken({
      liveClass,
      user,
      participant,
    });
    return ok(res, {
      ...access,
      liveRoomName: liveKitAccess?.roomName || access.liveRoomName || liveKitService.getRoomName(liveClass),
      liveKitUrl: appConfig.livekitUrl || access.liveKitUrl || null,
      liveKitToken: liveKitAccess?.token || null,
      liveKitIdentity: liveKitAccess?.identity || null,
      tokenExpiresAt: liveKitAccess?.tokenExpiresAt || null,
    });
  }
  return ok(res, access);
});

const getLiveClassChat = asyncHandler(async (req, res) => {
  await liveClassesRepository.getAccess({
    liveClassId: req.params.liveClassId,
    userId: req.user?.id,
  });
  const messages = await liveClassesRepository.getChat(req.params.liveClassId);
  return ok(res, { messages });
});

const postLiveClassChat = asyncHandler(async (req, res) => {
  const message = await liveClassesRepository.postChat({
    liveClassId: req.params.liveClassId,
    userId: req.user?.id,
    message: requireString(req.body?.message, 'message', { maxLength: 2000 }),
    kind: optionalString(req.body?.kind, 'chat', { maxLength: 20 }),
  });

  sessionService.publishChat(req.params.liveClassId, message);
  return created(res, { message });
});

const getSessionState = asyncHandler(async (req, res) => {
  const liveClass = await findLiveClassOrThrow(req.params.liveClassId);
  await liveClassesRepository.getAccess({
    liveClassId: req.params.liveClassId,
    userId: req.user?.id,
  });
  return ok(res, { session: sessionService.getSessionSnapshot(liveClass) });
});

const joinSession = asyncHandler(async (req, res) => {
  const liveClass = await findLiveClassOrThrow(req.params.liveClassId);
  const access = await liveClassesRepository.getAccess({
    liveClassId: req.params.liveClassId,
    userId: req.user?.id,
  });
  if (access.status !== 'live') {
    throw new ApiError(409, 'Live class is not active yet', { code: 'LIVE_CLASS_NOT_ACTIVE' });
  }

  const user = await getActingUser(req);
  const participant = sessionService.joinSession(liveClass, user);
  return ok(res, {
    participant,
    session: sessionService.getSessionSnapshot(liveClass),
  });
});

const leaveSession = asyncHandler(async (req, res) => {
  const session = sessionService.leaveSession(req.params.liveClassId, req.user?.id);
  return ok(res, { session });
});

const heartbeat = asyncHandler(async (req, res) => {
  const participant = sessionService.heartbeat(req.params.liveClassId, req.user?.id);
  return ok(res, { participant });
});

const updateMedia = asyncHandler(async (req, res) => {
  const participant = sessionService.updateParticipantMedia(req.params.liveClassId, req.user?.id, {
    micMuted: req.body?.micMuted === undefined ? undefined : requireBoolean(req.body.micMuted, 'micMuted'),
    videoEnabled: req.body?.videoEnabled === undefined ? undefined : requireBoolean(req.body.videoEnabled, 'videoEnabled'),
    isScreenSharing: req.body?.isScreenSharing === undefined ? undefined : requireBoolean(req.body.isScreenSharing, 'isScreenSharing'),
  });
  return ok(res, { participant });
});

const updateRaisedHand = asyncHandler(async (req, res) => {
  const participant = sessionService.setRaisedHand(
    req.params.liveClassId,
    req.user?.id,
    requireBoolean(req.body?.raised, 'raised'),
  );
  return ok(res, { participant });
});

const updateSpeakerApproval = asyncHandler(async (req, res) => {
  requireAdmin(req);
  const liveClass = await findLiveClassOrThrow(req.params.liveClassId);
  const participant = sessionService.setSpeakerApproval(
    req.params.liveClassId,
    req.params.participantUserId,
    requireBoolean(req.body?.approved, 'approved'),
  );
  if (appConfig.hasLiveKit) {
    await liveKitService.syncParticipantPermission(liveClass, participant);
  }
  return ok(res, { participant });
});

const updateParticipantMute = asyncHandler(async (req, res) => {
  requireAdmin(req);
  const liveClass = await findLiveClassOrThrow(req.params.liveClassId);
  const participant = sessionService.setParticipantMuted(
    req.params.liveClassId,
    req.params.participantUserId,
    requireBoolean(req.body?.muted, 'muted'),
  );
  if (appConfig.hasLiveKit) {
    await liveKitService.syncParticipantPermission(liveClass, participant);
  }
  return ok(res, { participant });
});

const removeParticipant = asyncHandler(async (req, res) => {
  requireAdmin(req);
  const liveClass = await findLiveClassOrThrow(req.params.liveClassId);
  const participant = sessionService.removeParticipant(req.params.liveClassId, req.params.participantUserId);
  if (appConfig.hasLiveKit) {
    await liveKitService.removeParticipant(liveClass, req.params.participantUserId);
  }
  return ok(res, { participant });
});

const validateIngestPublish = asyncHandler(async (req, res) => {
  const rawStreamName = String(req.body?.name || req.body?.path || req.query?.name || req.query?.path || '').trim();
  const authAction = String(req.body?.action || '').trim().toLowerCase();
  const authProtocol = String(req.body?.protocol || '').trim().toLowerCase();
  const requestQuery = new URLSearchParams(String(req.body?.query || req.originalUrl.split('?')[1] || ''));
  const secret = String(
    req.body?.secret
      || req.query?.secret
      || req.body?.password
      || req.body?.token
      || requestQuery.get('secret')
      || requestQuery.get('pass')
      || '',
  ).trim();

  if (!appConfig.liveIngestPublisherSecret || secret !== appConfig.liveIngestPublisherSecret) {
    throw new ApiError(403, 'Invalid live ingest secret', { code: 'LIVE_INGEST_SECRET_INVALID' });
  }

  if (authAction && authAction !== 'publish') {
    res.status(204).end();
    return;
  }

  if (authProtocol && authProtocol !== 'rtmp') {
    res.status(204).end();
    return;
  }

  if (!rawStreamName) {
    throw new ApiError(400, 'Missing stream name', { code: 'LIVE_INGEST_STREAM_NAME_REQUIRED' });
  }

  const liveClassId = rawStreamName.split('__')[0];
  const liveClass = await findLiveClassOrThrow(liveClassId);
  const playbackUrl = buildManagedHlsPlaybackUrl(rawStreamName);
  const nextLiveClass = await liveClassesRepository.update(liveClass._id, {
    status: 'live',
    livePlaybackType: 'hls',
    livePlaybackUrl: playbackUrl,
    provider: 'Managed HLS',
  });
  sessionService.syncStatus(nextLiveClass, 'live');
  res.status(204).end();
});

const streamProtectedLiveAsset = asyncHandler(async (req, res) => {
  const token = requireString(req.params.token, 'playback token');
  const payload = verifyPlaybackToken(token);

  if (!payload) {
    throw new ApiError(401, 'Playback token is invalid or expired', { code: 'PLAYBACK_TOKEN_INVALID' });
  }

  if (payload.upstreamUrl) {
    res.setHeader('Cache-Control', payload.assetKind === 'live-hls' ? 'no-store' : 'private, no-store');
    res.redirect(307, payload.upstreamUrl);
    return;
  }

  if (isS3Provider(payload.storageProvider) && payload.assetKind === 'hls') {
    const extension = path.extname(String(payload.storagePath || '')).toLowerCase();
    if (extension === '.m3u8') {
      const manifestBuffer = await getPrivateStorageObjectBuffer({
        storageProvider: payload.storageProvider,
        storagePath: payload.storagePath,
      });

      if (!manifestBuffer) {
        throw new ApiError(404, 'Protected live replay manifest could not be delivered', { code: 'LIVE_HLS_MANIFEST_UNAVAILABLE' });
      }

      res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.send(rewriteLiveHlsManifest(manifestBuffer.toString('utf8'), payload));
      return;
    }

    const signedUrl = await getSignedPrivateVideoUrl({
      storagePath: payload.storagePath,
      mimeType: payload.mimeType,
    });

    if (!signedUrl) {
      throw new ApiError(404, 'Protected live replay asset could not be delivered', { code: 'LIVE_HLS_ASSET_UNAVAILABLE' });
    }

    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.redirect(307, signedUrl);
    return;
  }

  throw new ApiError(404, 'Protected live asset could not be delivered', { code: 'LIVE_ASSET_UNAVAILABLE' });
});

const streamEvents = asyncHandler(async (req, res) => {
  const liveClass = await findLiveClassOrThrow(req.params.liveClassId);
  await liveClassesRepository.getAccess({
    liveClassId: req.params.liveClassId,
    userId: req.user?.id,
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  sessionService.registerStream(liveClass._id, res);
  res.write(`event: session.snapshot\n`);
  res.write(`data: ${JSON.stringify({
    event: 'session.snapshot',
    liveClassId: String(liveClass._id),
    timestamp: new Date().toISOString(),
    session: sessionService.getSessionSnapshot(liveClass),
  })}\n\n`);

  const heartbeatTimer = setInterval(() => {
    res.write(`event: ping\n`);
    res.write(`data: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeatTimer);
    sessionService.unregisterStream(liveClass._id, res);
    res.end();
  });
});

module.exports = {
  listLiveClasses,
  listAdminLiveClasses,
  createLiveClass,
  updateLiveClass,
  deleteLiveClass,
  startLiveClass,
  endLiveClass,
  getLiveClassAccess,
  getLiveClassChat,
  postLiveClassChat,
  getSessionState,
  joinSession,
  leaveSession,
  heartbeat,
  updateMedia,
  updateRaisedHand,
  updateSpeakerApproval,
  updateParticipantMute,
  removeParticipant,
  validateIngestPublish,
  streamProtectedLiveAsset,
  streamEvents,
};
