const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const { ApiError } = require('./http.js');
const { appConfig } = require('./config.js');

const assertLiveKitConfigured = () => {
  if (!appConfig.livekitUrl || !appConfig.livekitApiKey || !appConfig.livekitApiSecret) {
    throw new ApiError(503, 'Live classes are not configured yet. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.', {
      code: 'LIVEKIT_NOT_CONFIGURED',
    });
  }
};

const getRoomServiceClient = () => {
  assertLiveKitConfigured();
  return new RoomServiceClient(appConfig.livekitUrl, appConfig.livekitApiKey, appConfig.livekitApiSecret);
};

const getLiveKitRoomName = (liveClassId) => `${appConfig.livekitRoomPrefix}-${String(liveClassId)}`;
const getLiveKitParticipantIdentity = ({ userId, canPublish }) => `${canPublish ? 'host' : 'viewer'}-${String(userId)}`;

const createLiveKitRoom = async (liveClassId) => {
  const client = getRoomServiceClient();
  const roomName = getLiveKitRoomName(liveClassId);

  try {
    await client.createRoom({
      name: roomName,
      emptyTimeout: 60 * 10,
      maxParticipants: 1000,
    });
  } catch (error) {
    const message = String(error?.message || '');
    if (!message.toLowerCase().includes('already exists')) {
      throw error;
    }
  }

  return roomName;
};

const deleteLiveKitRoom = async (liveClassId) => {
  const client = getRoomServiceClient();
  const roomName = getLiveKitRoomName(liveClassId);
  try {
    await client.deleteRoom(roomName);
  } catch (error) {
    const message = String(error?.message || '');
    if (!message.toLowerCase().includes('not found')) {
      throw error;
    }
  }
};

const removeLiveKitParticipant = async ({ liveClassId, identity }) => {
  const client = getRoomServiceClient();
  const roomName = getLiveKitRoomName(liveClassId);

  try {
    await client.removeParticipant(roomName, identity);
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    if (!message.includes('not found') && !message.includes('does not exist') && !message.includes('participant')) {
      throw error;
    }
  }
};

const issueLiveKitToken = async ({ liveClassId, userId, name, canPublish }) => {
  assertLiveKitConfigured();
  const roomName = getLiveKitRoomName(liveClassId);
  const identity = getLiveKitParticipantIdentity({ userId, canPublish });
  const token = new AccessToken(appConfig.livekitApiKey, appConfig.livekitApiSecret, {
    identity,
    name,
    ttl: `${Math.max(appConfig.livekitTokenTtlSeconds || 600, 60)}s`,
  });

  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish,
    canSubscribe: true,
    canPublishData: canPublish,
  });

  return {
    identity,
    roomName,
    url: appConfig.livekitUrl,
    token: await token.toJwt(),
  };
};

module.exports = {
  assertLiveKitConfigured,
  createLiveKitRoom,
  deleteLiveKitRoom,
  getLiveKitParticipantIdentity,
  issueLiveKitToken,
  getLiveKitRoomName,
  removeLiveKitParticipant,
};
