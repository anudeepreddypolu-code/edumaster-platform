const fs = require('fs');
const path = require('path');
const readline = require('readline');
const dotenv = require('dotenv');

const envPath = path.join(__dirname, '.env');
dotenv.config({ path: envPath });

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
const redirectUri = 'http://localhost';
const scope = 'https://www.googleapis.com/auth/youtube.upload';

if (!clientId || !clientSecret) {
  console.error('Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET in backend/.env');
  process.exit(1);
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', redirectUri);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');
authUrl.searchParams.set('scope', scope);

console.log('\nOpen this URL in your browser and approve access:\n');
console.log(authUrl.toString());
console.log('\nAfter approval, Google will redirect to http://localhost/?code=...');
console.log('Copy the full redirected URL from the browser address bar and paste it below.\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('Paste redirected URL or code: ', async (answer) => {
  rl.close();

  let code = String(answer || '').trim();
  if (!code) {
    console.error('No code provided.');
    process.exit(1);
  }

  try {
    if (code.startsWith('http://') || code.startsWith('https://')) {
      const parsed = new URL(code);
      code = parsed.searchParams.get('code') || '';
    }

    if (!code) {
      throw new Error('Authorization code not found.');
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenPayload = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenPayload.refresh_token) {
      throw new Error(tokenPayload.error_description || tokenPayload.error || 'Failed to obtain refresh token.');
    }

    const currentEnv = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const nextLine = `YOUTUBE_UPLOAD_REFRESH_TOKEN=${tokenPayload.refresh_token}`;
    const updatedEnv = currentEnv.match(/^YOUTUBE_UPLOAD_REFRESH_TOKEN=.*$/m)
      ? currentEnv.replace(/^YOUTUBE_UPLOAD_REFRESH_TOKEN=.*$/m, nextLine)
      : `${currentEnv.trim()}\n${nextLine}\n`;

    fs.writeFileSync(envPath, updatedEnv.endsWith('\n') ? updatedEnv : `${updatedEnv}\n`);
    console.log('\nRefresh token saved to backend/.env');
    console.log('You can now upload session recordings from the admin UI to YouTube.\n');
  } catch (error) {
    console.error(`Failed to generate refresh token: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
});
