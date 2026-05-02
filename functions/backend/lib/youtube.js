const fs = require('fs');
const { appConfig } = require('./config.js');

const youtubeApiBase = 'https://www.googleapis.com/youtube/v3';
const youtubeUploadApiBase = 'https://www.googleapis.com/upload/youtube/v3';
const oauthTokenUrl = 'https://oauth2.googleapis.com/token';

const isYouTubeUploadConfigured = () => Boolean(
  appConfig.googleOauthClientId
  && appConfig.googleOauthClientSecret
  && appConfig.youtubeUploadRefreshToken,
);

const getOAuthAccessToken = async () => {
  if (!isYouTubeUploadConfigured()) {
    throw new Error('YouTube upload integration is not configured.');
  }

  const body = new URLSearchParams({
    client_id: appConfig.googleOauthClientId,
    client_secret: appConfig.googleOauthClientSecret,
    refresh_token: appConfig.youtubeUploadRefreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetch(oauthTokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || 'Unable to get Google OAuth access token.');
  }

  return payload.access_token;
};

const uploadVideoToYouTube = async ({
  filePath,
  fileSize,
  mimeType,
  title,
  description,
  tags = [],
}) => {
  const accessToken = await getOAuthAccessToken();

  const metadata = {
    snippet: {
      title,
      description,
      categoryId: '27',
      tags,
    },
    status: {
      privacyStatus: 'unlisted',
      selfDeclaredMadeForKids: false,
      embeddable: true,
      publicStatsViewable: false,
    },
  };

  const initResponse = await fetch(`${youtubeUploadApiBase}/videos?part=snippet,status&uploadType=resumable`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-length': String(fileSize),
      'x-upload-content-type': mimeType,
    },
    body: JSON.stringify(metadata),
  });

  if (!initResponse.ok) {
    const payload = await initResponse.text();
    throw new Error(`Failed to initialize YouTube upload: ${payload || initResponse.statusText}`);
  }

  const uploadUrl = initResponse.headers.get('location');
  if (!uploadUrl) {
    throw new Error('YouTube upload session URL was not returned.');
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'content-length': String(fileSize),
      'content-type': mimeType,
    },
    body: fs.createReadStream(filePath),
    duplex: 'half',
  });

  const uploadPayload = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok || !uploadPayload.id) {
    throw new Error(uploadPayload.error?.message || 'YouTube upload failed.');
  }

  return {
    videoId: uploadPayload.id,
    watchUrl: `https://www.youtube.com/watch?v=${uploadPayload.id}`,
  };
};

module.exports = {
  isYouTubeUploadConfigured,
  uploadVideoToYouTube,
};
