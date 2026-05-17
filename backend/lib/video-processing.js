const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { appConfig } = require('./config.js');
const {
  buildPrivateHlsAssetKey,
  resolvePrivateVideoPath,
  resolvePrivateHlsPath,
  ensureStorageDirectory,
} = require('./private-video.js');
const {
  getPrivateVideoStorageProvider,
  getPrivateStorageObjectBuffer,
  uploadPrivateStorageFile,
  deleteStoredPrivateVideoPrefix,
} = require('./private-video-storage.js');
const {
  buildManifestBundleStorageKey,
  createManifestBundleFromDirectory,
  writeManifestBundleToDirectory,
} = require('./manifest-bundle.js');

const activeJobs = new Set();

const getTargetQualities = () => {
  const configured = Array.isArray(appConfig.videoTargetRenditions) ? appConfig.videoTargetRenditions : [];
  const supported = ['480p', '720p'];
  const result = configured.filter((entry) => supported.includes(entry));
  return result.length > 0 ? result : ['480p', '720p'];
};

const createInitialVideoDeliveryState = () => ({
  deliveryProfile: appConfig.videoDeliveryProfile,
  deliveryStrategy: appConfig.enableVideoTranscoding ? 'hls' : 'source',
  sourceFallbackAllowed: Boolean(appConfig.sourcePlaybackFallbackEnabled),
  targetQualities: getTargetQualities(),
  hlsStorageProvider: null,
  hlsProcessingStatus: appConfig.enableVideoTranscoding ? 'queued' : 'ready',
  hlsProcessingQueuedAt: appConfig.enableVideoTranscoding ? new Date().toISOString() : null,
  hlsProcessingStartedAt: null,
  hlsProcessingCompletedAt: null,
  hlsProcessingError: null,
  hlsManifestPath: null,
  hlsPlaybackPath: null,
  hlsManifestBundlePath: null,
  hlsManifestRootPath: null,
  hlsManifestVersion: null,
});

const cleanupDirectory = (directoryPath) => {
  if (directoryPath && fs.existsSync(directoryPath)) {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
};

const deleteProcessedHlsAssets = async (manifestPath) => {
  const resolvedManifest = resolvePrivateHlsPath(manifestPath);
  if (resolvedManifest && fs.existsSync(path.dirname(resolvedManifest))) {
    cleanupDirectory(path.dirname(resolvedManifest));
    return;
  }

  await deleteStoredPrivateVideoPrefix({
    storageProvider: getPrivateVideoStorageProvider(),
    storagePathPrefix: path.posix.dirname(String(manifestPath)),
  });
};

const waitForFfmpeg = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });

const writeMasterManifest = ({ outputDirectory, variants }) => {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
  variants.forEach((variant) => {
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},RESOLUTION=${variant.resolution}`);
    lines.push(`${variant.name}/index.m3u8`);
  });
  fs.writeFileSync(path.join(outputDirectory, 'master.m3u8'), `${lines.join('\n')}\n`);
};

const renditionProfiles = {
  '480p': { width: 854, height: 480, videoBitrate: '900k', maxRate: '963k', bufferSize: '1350k', bandwidth: 1000000, resolution: '854x480' },
  '720p': { width: 1280, height: 720, videoBitrate: '2200k', maxRate: '2354k', bufferSize: '3300k', bandwidth: 2500000, resolution: '1280x720' },
};

const hlsAssetMimeTypeByExtension = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
};

const createTemporaryWorkspace = (jobId) => fs.mkdtempSync(path.join(os.tmpdir(), `edumaster-video-${jobId.replace(/[^a-zA-Z0-9_-]/g, '_')}-`));

const downloadStorageSourceToLocal = async ({ lesson, workspaceDirectory }) => {
  const localSourcePath = resolvePrivateVideoPath(lesson.storagePath);
  if (localSourcePath && fs.existsSync(localSourcePath)) {
    return {
      sourcePath: localSourcePath,
      cleanup: () => {},
    };
  }

  if ((lesson.storageProvider || 'local') !== 's3') {
    throw new Error('Source video file not found for HLS processing.');
  }

  const sourceBuffer = await getPrivateStorageObjectBuffer({
    storageProvider: lesson.storageProvider,
    storagePath: lesson.storagePath,
  });
  if (!sourceBuffer) {
    throw new Error('Source video file could not be downloaded from object storage.');
  }

  const extension = path.extname(String(lesson.originalFilename || lesson.storagePath || 'video.mp4')) || '.mp4';
  const downloadedSourcePath = path.join(workspaceDirectory, `source${extension}`);
  fs.writeFileSync(downloadedSourcePath, sourceBuffer);

  return {
    sourcePath: downloadedSourcePath,
    cleanup: () => {
      if (fs.existsSync(downloadedSourcePath)) {
        fs.unlinkSync(downloadedSourcePath);
      }
    },
  };
};

const uploadProcessedHlsDirectory = async ({ outputDirectory, manifestKey }) => {
  const prefix = path.posix.dirname(manifestKey);
  const uploadTasks = [];

  const walk = (directoryPath) => {
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    entries.forEach((entry) => {
      const fullPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        return;
      }

      const relativePath = path.relative(outputDirectory, fullPath).split(path.sep).join(path.posix.sep);
      const extension = path.extname(entry.name).toLowerCase();
      uploadTasks.push(uploadPrivateStorageFile({
        storageProvider: 's3',
        storagePath: path.posix.join(prefix, relativePath),
        localFilePath: fullPath,
        contentType: hlsAssetMimeTypeByExtension[extension] || 'application/octet-stream',
      }));
    });
  };

  walk(outputDirectory);
  await Promise.all(uploadTasks);
};

const transcodeToHls = async ({ sourcePath, outputDirectory, qualities }) => {
  cleanupDirectory(outputDirectory);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const variants = [];

  for (const quality of qualities) {
    const profile = renditionProfiles[quality];
    if (!profile) {
      continue;
    }

    const variantDir = path.join(outputDirectory, quality);
    fs.mkdirSync(variantDir, { recursive: true });
    const playlistPath = path.join(variantDir, 'index.m3u8');
    const segmentPattern = path.join(variantDir, 'segment_%03d.ts');

    const args = [
      '-y',
      '-i', sourcePath,
      '-vf', `scale=w=${profile.width}:h=${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2`,
      '-ac', '2',
      '-c:a', 'aac',
      '-ar', '48000',
      '-b:a', '128k',
      '-c:v', 'libx264',
      '-profile:v', 'main',
      '-crf', '23',
      '-sc_threshold', '0',
      '-g', '48',
      '-keyint_min', '48',
      '-b:v', profile.videoBitrate,
      '-maxrate', profile.maxRate,
      '-bufsize', profile.bufferSize,
      '-hls_time', String(appConfig.videoHlsSegmentDurationSeconds),
      '-hls_playlist_type', 'vod',
      '-hls_segment_filename', segmentPattern,
      playlistPath,
    ];

    await waitForFfmpeg(args);
    variants.push({
      name: quality,
      bandwidth: profile.bandwidth,
      resolution: profile.resolution,
    });
  }

  writeMasterManifest({ outputDirectory, variants });
};

const scheduleVideoProcessing = ({ courseId, lessonId }) => {
  if (!appConfig.enableVideoTranscoding) {
    return;
  }

  const jobId = `${courseId}:${lessonId}`;
  if (activeJobs.has(jobId)) {
    return;
  }
  activeJobs.add(jobId);

  setTimeout(async () => {
    const { coursesRepository } = require('./repositories.js');
    try {
      const course = await coursesRepository.findById(courseId);
      const lesson = course ? course.modules.flatMap((module) => ([
        ...(module.lessons || []),
        ...((module.chapters || []).flatMap((chapter) => chapter.lessons || [])),
      ])).find((entry) => entry.id === String(lessonId)) : null;

      if (!lesson || !lesson.storagePath) {
        await coursesRepository.updateLesson(courseId, lessonId, (current) => ({
          ...current,
          hlsProcessingStatus: 'failed',
          hlsProcessingCompletedAt: new Date().toISOString(),
          hlsProcessingError: 'Source video file is missing for HLS processing.',
        }));
        return;
      }

      await coursesRepository.updateLesson(courseId, lessonId, (current) => ({
        ...current,
        hlsProcessingStatus: 'processing',
        hlsProcessingStartedAt: new Date().toISOString(),
        hlsProcessingError: null,
      }));

      if (!ffmpegPath) {
        throw new Error('ffmpeg runtime is unavailable.');
      }

      const workspaceDirectory = createTemporaryWorkspace(jobId);
      const outputKey = buildPrivateHlsAssetKey({ courseId, moduleId: lesson.moduleId || 'module', lessonId, assetName: 'master.m3u8' });
      const outputRootPath = path.posix.dirname(outputKey);
      const manifestBundleKey = buildManifestBundleStorageKey(outputKey);
      const localOutputDirectory = path.join(workspaceDirectory, 'hls');
      const { sourcePath, cleanup } = await downloadStorageSourceToLocal({
        lesson,
        workspaceDirectory,
      });
      const manifestVersion = Date.now().toString(36);

      try {
        await transcodeToHls({
          sourcePath,
          outputDirectory: localOutputDirectory,
          qualities: Array.isArray(lesson.targetQualities) && lesson.targetQualities.length > 0 ? lesson.targetQualities : getTargetQualities(),
        });
        const manifestBundle = createManifestBundleFromDirectory({
          outputDirectory: localOutputDirectory,
          manifestKey: outputKey,
          storageProvider: lesson.storageProvider || 'local',
          version: manifestVersion,
        });
        writeManifestBundleToDirectory({
          outputDirectory: localOutputDirectory,
          bundle: manifestBundle,
        });

        if ((lesson.storageProvider || 'local') === 's3') {
          await deleteStoredPrivateVideoPrefix({
            storageProvider: 's3',
            storagePathPrefix: path.posix.dirname(outputKey),
          });
          await uploadProcessedHlsDirectory({
            outputDirectory: localOutputDirectory,
            manifestKey: outputKey,
          });
        } else {
          const resolvedOutputDirectory = path.dirname(resolvePrivateHlsPath(outputKey));
          cleanupDirectory(resolvedOutputDirectory);
          fs.mkdirSync(path.dirname(resolvedOutputDirectory), { recursive: true });
          fs.renameSync(localOutputDirectory, resolvedOutputDirectory);
        }
      } finally {
        cleanup();
        cleanupDirectory(workspaceDirectory);
      }

      if (!appConfig.videoKeepSourceAfterProcessing && lesson.storagePath) {
        if ((lesson.storageProvider || 'local') === 's3') {
          const { deleteStoredPrivateVideo } = require('./private-video-storage.js');
          await deleteStoredPrivateVideo({
            storageProvider: lesson.storageProvider,
            storagePath: lesson.storagePath,
          });
        } else if (sourcePath && fs.existsSync(sourcePath)) {
          fs.unlinkSync(sourcePath);
        }
      }

      await coursesRepository.updateLesson(courseId, lessonId, (current) => ({
        ...current,
        storagePath: appConfig.videoKeepSourceAfterProcessing ? current.storagePath : null,
        deliveryStrategy: 'hls',
        hlsStorageProvider: lesson.storageProvider || 'local',
        hlsProcessingStatus: 'ready',
        hlsProcessingCompletedAt: new Date().toISOString(),
        hlsManifestPath: outputKey,
        hlsPlaybackPath: outputKey,
        hlsManifestBundlePath: manifestBundleKey,
        hlsManifestRootPath: outputRootPath,
        hlsManifestVersion: manifestVersion,
        hlsProcessingError: null,
      }));
    } catch (error) {
      const { coursesRepository } = require('./repositories.js');
      await coursesRepository.updateLesson(courseId, lessonId, (current) => ({
        ...current,
        hlsProcessingStatus: 'failed',
        hlsProcessingCompletedAt: new Date().toISOString(),
        hlsProcessingError: error instanceof Error ? error.message : 'Video processing failed.',
      }));
    } finally {
      activeJobs.delete(jobId);
    }
  }, 25);
};

module.exports = {
  createInitialVideoDeliveryState,
  scheduleVideoProcessing,
  deleteProcessedHlsAssets,
};
