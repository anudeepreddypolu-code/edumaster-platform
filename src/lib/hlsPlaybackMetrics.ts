import Hls from 'hls.js';

type HlsPlaybackMetricOptions = {
  video: HTMLVideoElement;
  hls?: Hls | null;
  src: string;
  title: string;
  trackVideoId?: string | null;
};

const getConnectionStrength = () => {
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number } }).connection;
  if (!connection) {
    return 'unknown';
  }

  const effectiveType = String(connection.effectiveType || '').toLowerCase();
  const downlink = Number(connection.downlink || 0);
  if (effectiveType === '4g' && downlink >= 4) {
    return 'strong';
  }
  if (effectiveType === '3g' || downlink >= 1.5) {
    return 'moderate';
  }
  return 'weak';
};

export const wireHlsPlaybackMetrics = ({
  video,
  hls,
  src,
  title,
  trackVideoId = null,
}: HlsPlaybackMetricOptions) => {
  let startupStartedAt = performance.now();
  let startupReported = false;
  let bufferingStartedAt: number | null = null;
  let totalBufferMs = 0;

  const emit = (type: string, detail: Record<string, unknown> = {}) => {
    const performanceWithMemory = performance as Performance & {
      memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number };
    };

    window.dispatchEvent(new CustomEvent('edumaster:hls-metric', {
      detail: {
        type,
        src,
        title,
        trackVideoId,
        at: Date.now(),
        currentTimeSeconds: Math.max(Number(video.currentTime || 0), 0),
        durationSeconds: Math.max(Number(video.duration || 0), 0),
        totalBufferMs,
        connectionStrength: getConnectionStrength(),
        usedJSHeapSize: performanceWithMemory.memory?.usedJSHeapSize || null,
        totalJSHeapSize: performanceWithMemory.memory?.totalJSHeapSize || null,
        jsHeapSizeLimit: performanceWithMemory.memory?.jsHeapSizeLimit || null,
        ...detail,
      },
    }));
  };

  const handleReady = () => {
    if (startupReported) {
      return;
    }

    startupReported = true;
    emit('startup_ready', {
      startupDelayMs: Math.round(performance.now() - startupStartedAt),
      readyState: video.readyState,
    });
  };

  const handleWaiting = () => {
    if (bufferingStartedAt !== null) {
      return;
    }

    bufferingStartedAt = performance.now();
    emit('buffering_start');
  };

  const handlePlaying = () => {
    if (bufferingStartedAt === null) {
      emit('play');
      return;
    }

    const bufferMs = Math.round(performance.now() - bufferingStartedAt);
    bufferingStartedAt = null;
    totalBufferMs += bufferMs;
    emit('buffering_end', { bufferMs });
  };

  const handlePause = () => emit('pause');
  const handleEnded = () => emit('ended');
  const handleError = () => emit('media_error', {
    code: video.error?.code || null,
    message: video.error?.message || null,
  });

  video.addEventListener('loadeddata', handleReady);
  video.addEventListener('canplay', handleReady);
  video.addEventListener('waiting', handleWaiting);
  video.addEventListener('playing', handlePlaying);
  video.addEventListener('pause', handlePause);
  video.addEventListener('ended', handleEnded);
  video.addEventListener('error', handleError);

  const handleManifestParsed = (_event: string, data: { levels?: Array<{ height?: number; bitrate?: number }> }) => {
    startupStartedAt = performance.now();
    emit('manifest_parsed', {
      levelCount: data.levels?.length || 0,
      levels: (data.levels || []).map((level) => ({
        height: level.height || null,
        bitrate: level.bitrate || null,
      })),
    });
  };

  const handleLevelSwitched = (_event: string, data: { level: number }) => {
    const level = hls?.levels?.[data.level];
    emit('level_switched', {
      level: data.level,
      height: level?.height || null,
      bitrate: level?.bitrate || null,
    });
  };

  const handleFragLoaded = (_event: string, data: any) => {
    const stats = data.frag?.stats || data.stats;
    const loading = stats?.loading;
    const start = Number(loading?.start || 0);
    const end = Number(loading?.end || 0);
    emit('segment_loaded', {
      url: data.frag?.url || null,
      level: data.frag?.level ?? null,
      durationSeconds: data.frag?.duration || null,
      loadMs: start > 0 && end >= start ? Math.round(end - start) : null,
      sizeBytes: Number(stats?.loaded || 0) || null,
    });
  };

  const handleHlsError = (_event: string, data: { fatal?: boolean; type?: string; details?: string }) => {
    emit('hls_error', {
      fatal: Boolean(data?.fatal),
      type: data?.type || null,
      details: data?.details || null,
    });
  };

  hls?.on(Hls.Events.MANIFEST_PARSED, handleManifestParsed);
  hls?.on(Hls.Events.LEVEL_SWITCHED, handleLevelSwitched);
  hls?.on(Hls.Events.FRAG_LOADED, handleFragLoaded);
  hls?.on(Hls.Events.ERROR, handleHlsError);

  const handleQaLevelChange = (event: Event) => {
    if (!hls) {
      return;
    }

    const requestedLevel = Number((event as CustomEvent<{ level?: number }>).detail?.level);
    if (!Number.isFinite(requestedLevel)) {
      hls.currentLevel = -1;
      hls.nextLevel = -1;
      emit('qa_auto_bitrate');
      return;
    }

    const safeLevel = Math.max(-1, Math.min(Math.floor(requestedLevel), Math.max((hls.levels?.length || 1) - 1, -1)));
    hls.currentLevel = safeLevel;
    hls.nextLevel = safeLevel;
    emit('qa_forced_bitrate', { level: safeLevel });
  };

  window.addEventListener('edumaster:hls-set-level', handleQaLevelChange);

  return () => {
    video.removeEventListener('loadeddata', handleReady);
    video.removeEventListener('canplay', handleReady);
    video.removeEventListener('waiting', handleWaiting);
    video.removeEventListener('playing', handlePlaying);
    video.removeEventListener('pause', handlePause);
    video.removeEventListener('ended', handleEnded);
    video.removeEventListener('error', handleError);
    hls?.off(Hls.Events.MANIFEST_PARSED, handleManifestParsed);
    hls?.off(Hls.Events.LEVEL_SWITCHED, handleLevelSwitched);
    hls?.off(Hls.Events.FRAG_LOADED, handleFragLoaded);
    hls?.off(Hls.Events.ERROR, handleHlsError);
    window.removeEventListener('edumaster:hls-set-level', handleQaLevelChange);
  };
};
