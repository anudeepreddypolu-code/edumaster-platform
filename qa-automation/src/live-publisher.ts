import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const buildRemoteDockerPublishCommand = (containerName: string, publishUrl: string) => [
  'docker',
  'rm',
  '-f',
  containerName,
  '>/dev/null',
  '2>&1',
  '||',
  'true;',
  'docker',
  'run',
  '-d',
  '--name',
  containerName,
  'jrottenberg/ffmpeg:6.0-alpine',
  '-re',
  '-f',
  'lavfi',
  '-i',
  'testsrc=size=1280x720:rate=30',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=1000:sample_rate=48000',
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-pix_fmt',
  'yuv420p',
  '-g',
  '60',
  '-b:v',
  '2500k',
  '-c:a',
  'aac',
  '-b:a',
  '128k',
  '-ar',
  '48000',
  '-f',
  'flv',
  `'${publishUrl.replace(/'/g, `'\\''`)}'`,
].join(' ');

const stopRemotePublisherCommand = (containerName: string) => `docker rm -f ${containerName} >/dev/null 2>&1 || true`;

const runSshCommand = async (target: string, command: string) => {
  await execFileAsync('ssh', ['-o', 'StrictHostKeyChecking=no', target, command], {
    maxBuffer: 1024 * 1024 * 16,
  });
};

export const maybeStartLiveTestPublisher = async ({
  ingestServerUrl,
  ingestStreamKey,
  envPrefix,
  runId,
}: {
  ingestServerUrl?: string | null;
  ingestStreamKey?: string | null;
  envPrefix: 'QA' | 'LIVE_LOAD';
  runId: string;
}) => {
  const sshTarget = process.env[`${envPrefix}_LIVE_PUBLISHER_SSH_TARGET`] || process.env.QA_LIVE_PUBLISHER_SSH_TARGET || '';
  const mode = String(process.env[`${envPrefix}_LIVE_PUBLISHER_MODE`] || process.env.QA_LIVE_PUBLISHER_MODE || '').trim().toLowerCase();
  if (!sshTarget || mode !== 'remote-docker') {
    return async () => undefined;
  }

  if (!ingestServerUrl || !ingestStreamKey) {
    return async () => undefined;
  }

  const baseUrl = String(ingestServerUrl || '').replace(/\/+$/, '');
  const streamKey = String(ingestStreamKey || '').replace(/^\/+/, '');
  const publishUrl = `${baseUrl}/${streamKey}`;
  const containerName = `qa-live-publisher-${runId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  await runSshCommand(sshTarget, buildRemoteDockerPublishCommand(containerName, publishUrl));
  await new Promise((resolve) => setTimeout(resolve, 4000));

  return async () => {
    await runSshCommand(sshTarget, stopRemotePublisherCommand(containerName)).catch(() => undefined);
  };
};
