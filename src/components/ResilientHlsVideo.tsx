import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { LoaderCircle } from 'lucide-react';
import { EduService } from '../EduService';
import { cn } from '../lib/utils';

type ResilientHlsVideoProps = {
  src: string;
  title: string;
  watermarkText?: string | null;
  trackVideoId?: string | null;
  className?: string;
  autoPlay?: boolean;
  resumeSeconds?: number;
  playbackSpeed?: number;
  onProgress?: (progressSeconds: number, durationSeconds: number, completed: boolean) => void;
  onReady?: () => void;
};

const RETRY_DELAY_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const WATCHDOG_INTERVAL_MS = 5_000;
const STALL_THRESHOLD_MS = 12_000;

const getConnectionStrength = () => {
  if (typeof navigator === 'undefined') {
    return 'unknown';
  }

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

const getPreferredLevelIndex = (levels: Array<{ height?: number }>) => {
  if (!levels.length) {
    return -1;
  }

  const lowToHigh = [...levels].sort((left, right) => {
    const leftHeight = Number(left.height || 0);
    const rightHeight = Number(right.height || 0);
    return leftHeight - rightHeight;
  });

  const preferred = lowToHigh.find((level) => Number(level.height || 0) <= 480) || lowToHigh[0];
  return levels.indexOf(preferred);
};

const isDirectVideoSource = (value: string) => {
  const normalized = String(value || '').toLowerCase();
  return /\.(mp4|webm|mov)(\?|$)/.test(normalized);
};

export const ResilientHlsVideo = ({
  src,
  title,
  watermarkText,
  trackVideoId = null,
  className,
  autoPlay = false,
  resumeSeconds = 0,
  playbackSpeed = 1,
  onProgress,
  onReady,
}: ResilientHlsVideoProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mediaCleanupRef = useRef<(() => void) | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const watchdogTimerRef = useRef<number | null>(null);
  const isMountedRef = useRef(false);
  const isPlayingRef = useRef(false);
  const startupStartedAtRef = useRef(0);
  const startupReportedRef = useRef(false);
  const bufferingStartedAtRef = useRef<number | null>(null);
  const totalBufferMsRef = useRef(0);
  const lastProgressAtRef = useRef<number>(0);
  const lastCurrentTimeRef = useRef<number>(0);
  const onProgressRef = useRef(onProgress);
  const onReadyRef = useRef(onReady);
  const [isReconnecting, setIsReconnecting] = useState(true);
  const [loadMessage, setLoadMessage] = useState<string>('Connecting to stream…');

  const emitPlaybackMetric = (type: string, detail: Record<string, unknown> = {}) => {
    if (typeof window === 'undefined') {
      return;
    }

    const video = videoRef.current;
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
        currentTimeSeconds: video ? Math.max(Number(video.currentTime || 0), 0) : 0,
        durationSeconds: video ? Math.max(Number(video.duration || 0), 0) : 0,
        totalBufferMs: totalBufferMsRef.current,
        connectionStrength: getConnectionStrength(),
        usedJSHeapSize: performanceWithMemory.memory?.usedJSHeapSize || null,
        totalJSHeapSize: performanceWithMemory.memory?.totalJSHeapSize || null,
        jsHeapSizeLimit: performanceWithMemory.memory?.jsHeapSizeLimit || null,
        ...detail,
      },
    }));
  };

  const clearTimer = (timerRef: React.MutableRefObject<number | null>) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopHeartbeat = () => {
    if (heartbeatTimerRef.current !== null) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  };

  const stopWatchdog = () => {
    if (watchdogTimerRef.current !== null) {
      window.clearInterval(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
  };

  const destroyPlayer = () => {
    stopHeartbeat();
    stopWatchdog();
    clearTimer(retryTimerRef);
    mediaCleanupRef.current?.();
    mediaCleanupRef.current = null;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  };

  const sendHeartbeat = async (currentTimeSeconds: number, durationSeconds: number, completed: boolean) => {
    if (!trackVideoId) {
      return;
    }

    try {
      await EduService.trackPlaybackHeartbeat({
        videoId: trackVideoId,
        currentTimeSeconds,
        durationSeconds,
        isPlaying: isPlayingRef.current,
        completed,
      });
    } catch {
      // Heartbeats should never interrupt playback.
    }
  };

  const scheduleRetry = (reason: string) => {
    if (!isMountedRef.current) {
      return;
    }

    clearTimer(retryTimerRef);
    destroyPlayer();
    emitPlaybackMetric('reconnect_scheduled', { reason, retryDelayMs: RETRY_DELAY_MS });
    setLoadMessage(reason);
    setIsReconnecting(true);
    retryTimerRef.current = window.setTimeout(() => {
      if (!isMountedRef.current) {
        return;
      }

      setLoadMessage('Reconnecting…');
      attachPlayer();
    }, RETRY_DELAY_MS);
  };

  const attachPlayer = () => {
    const video = videoRef.current;
    if (!video || !src) {
      return;
    }

    destroyPlayer();
    startupStartedAtRef.current = performance.now();
    startupReportedRef.current = false;
    bufferingStartedAtRef.current = null;
    totalBufferMsRef.current = 0;
    setIsReconnecting(true);
    setLoadMessage('Connecting to stream…');

    const setupMediaEvents = () => {
      const handlePlay = () => {
        isPlayingRef.current = true;
        lastProgressAtRef.current = Date.now();
        setIsReconnecting(false);
        emitPlaybackMetric('play');
        stopHeartbeat();
        heartbeatTimerRef.current = window.setInterval(() => {
          if (!videoRef.current || !isPlayingRef.current) {
            return;
          }

          const currentTimeSeconds = Math.max(Number(videoRef.current.currentTime || 0), 0);
          const durationSeconds = Math.max(Number(videoRef.current.duration || 0), 0);
          const completed = videoRef.current.ended || currentTimeSeconds >= Math.max(durationSeconds - 1, 1);
          void sendHeartbeat(currentTimeSeconds, durationSeconds, completed);
        }, HEARTBEAT_INTERVAL_MS);
      };

      const handlePause = () => {
        isPlayingRef.current = false;
        stopHeartbeat();
        emitPlaybackMetric('pause');
        void sendHeartbeat(
          Math.max(Number(video.currentTime || 0), 0),
          Math.max(Number(video.duration || 0), 0),
          Boolean(video.ended),
        );
      };

      const handleTimeUpdate = () => {
        lastCurrentTimeRef.current = Number(video.currentTime || 0);
        lastProgressAtRef.current = Date.now();
        onProgressRef.current?.(
          Math.max(Number(video.currentTime || 0), 0),
          Math.max(Number(video.duration || 0), 0),
          Boolean(video.ended || video.currentTime >= Math.max(Number(video.duration || 0) - 1, 1)),
        );
      };

      const handleEnded = () => {
        isPlayingRef.current = false;
        stopHeartbeat();
        stopWatchdog();
        emitPlaybackMetric('ended');
        void sendHeartbeat(
          Math.max(Number(video.currentTime || 0), 0),
          Math.max(Number(video.duration || 0), 0),
          true,
        );
      };

      const handleError = () => {
        emitPlaybackMetric('media_error', {
          code: video.error?.code || null,
          message: video.error?.message || null,
        });
        scheduleRetry('Stream interrupted. Reconnecting…');
      };

      const handleReady = () => {
        setIsReconnecting(false);
        setLoadMessage('Stream ready');
        if (!startupReportedRef.current && startupStartedAtRef.current > 0) {
          startupReportedRef.current = true;
          emitPlaybackMetric('startup_ready', {
            startupDelayMs: Math.round(performance.now() - startupStartedAtRef.current),
            readyState: video.readyState,
          });
        }
        onReadyRef.current?.();
      };

      const handleWaiting = () => {
        if (bufferingStartedAtRef.current === null) {
          bufferingStartedAtRef.current = performance.now();
          emitPlaybackMetric('buffering_start');
        }
      };

      const handlePlaying = () => {
        if (bufferingStartedAtRef.current !== null) {
          const bufferMs = Math.round(performance.now() - bufferingStartedAtRef.current);
          bufferingStartedAtRef.current = null;
          totalBufferMsRef.current += bufferMs;
          emitPlaybackMetric('buffering_end', { bufferMs });
        }
      };

      video.addEventListener('play', handlePlay);
      video.addEventListener('pause', handlePause);
      video.addEventListener('timeupdate', handleTimeUpdate);
      video.addEventListener('ended', handleEnded);
      video.addEventListener('error', handleError);
      video.addEventListener('loadeddata', handleReady);
      video.addEventListener('canplay', handleReady);
      video.addEventListener('waiting', handleWaiting);
      video.addEventListener('playing', handlePlaying);

      watchdogTimerRef.current = window.setInterval(() => {
        if (!isPlayingRef.current || video.paused || video.ended) {
          return;
        }

        const currentTime = Number(video.currentTime || 0);
        const durationSeconds = Number(video.duration || 0);
        const stalledFor = Date.now() - lastProgressAtRef.current;

        if (stalledFor >= STALL_THRESHOLD_MS && currentTime === lastCurrentTimeRef.current && durationSeconds > 0) {
          emitPlaybackMetric('watchdog_stall', { stalledForMs: stalledFor });
          scheduleRetry('Playback stalled. Reconnecting…');
        }
      }, WATCHDOG_INTERVAL_MS);

      return () => {
        video.removeEventListener('play', handlePlay);
        video.removeEventListener('pause', handlePause);
        video.removeEventListener('timeupdate', handleTimeUpdate);
        video.removeEventListener('ended', handleEnded);
        video.removeEventListener('error', handleError);
        video.removeEventListener('loadeddata', handleReady);
        video.removeEventListener('canplay', handleReady);
        video.removeEventListener('waiting', handleWaiting);
        video.removeEventListener('playing', handlePlaying);
      };
    };

    if (isDirectVideoSource(src)) {
      mediaCleanupRef.current = setupMediaEvents();
      video.src = src;
      video.load();
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        maxBufferLength: 20,
        backBufferLength: 30,
        maxBufferSize: 40 * 1000 * 1000,
        fragLoadingMaxRetry: 3,
        manifestLoadingMaxRetry: 3,
        levelLoadingMaxRetry: 3,
        startLevel: -1,
        autoStartLoad: true,
        capLevelToPlayerSize: true,
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        const preferredLevel = getPreferredLevelIndex(data.levels || []);
        const connectionStrength = getConnectionStrength();
        hls.startLevel = preferredLevel >= 0 ? preferredLevel : -1;
        hls.nextLevel = preferredLevel >= 0 ? preferredLevel : -1;
        hls.autoLevelCapping = connectionStrength === 'strong' ? -1 : preferredLevel;
        setLoadMessage(connectionStrength === 'weak' ? 'Saving mobile data with lower bitrate…' : 'Stream ready');
        setIsReconnecting(false);
        emitPlaybackMetric('manifest_parsed', {
          levelCount: data.levels?.length || 0,
          preferredLevel,
          levels: (data.levels || []).map((level) => ({
            height: level.height || null,
            bitrate: level.bitrate || null,
          })),
        });
        onReadyRef.current?.();
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        const level = hls.levels?.[data.level];
        emitPlaybackMetric('level_switched', {
          level: data.level,
          height: level?.height || null,
          bitrate: level?.bitrate || null,
        });
      });

      hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
        const stats = data.frag?.stats || data.stats;
        const loading = stats?.loading;
        const start = Number(loading?.start || 0);
        const end = Number(loading?.end || 0);
        emitPlaybackMetric('segment_loaded', {
          url: data.frag?.url || null,
          level: data.frag?.level ?? null,
          durationSeconds: data.frag?.duration || null,
          loadMs: start > 0 && end >= start ? Math.round(end - start) : null,
          sizeBytes: Number(stats?.loaded || 0) || null,
        });
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        emitPlaybackMetric('hls_error', {
          fatal: Boolean(data?.fatal),
          type: data?.type || null,
          details: data?.details || null,
        });
        const fatalOrRecoverableNetworkError = Boolean(
          data?.fatal
          || data?.type === Hls.ErrorTypes.NETWORK_ERROR
          || data?.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR
          || data?.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR
          || data?.details === Hls.ErrorDetails.FRAG_LOAD_ERROR
          || data?.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR,
        );

        if (fatalOrRecoverableNetworkError) {
          scheduleRetry('Reconnecting…');
        }
      });

      mediaCleanupRef.current = setupMediaEvents();
      hls.loadSource(src);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      mediaCleanupRef.current = setupMediaEvents();
      video.src = src;
      video.load();
    } else {
      setLoadMessage('This browser cannot play the stream.');
    }

    if (autoPlay) {
      void video.play().catch(() => undefined);
    }

    try {
      video.playbackRate = playbackSpeed;
      if (resumeSeconds > 0 && Number.isFinite(resumeSeconds)) {
        video.currentTime = Math.max(Number(resumeSeconds || 0), 0);
      }
    } catch {
      // Ignore seeking/playback rate races while the video initializes.
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    attachPlayer();

    return () => {
      isMountedRef.current = false;
      destroyPlayer();
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, autoPlay]);

  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    try {
      video.playbackRate = playbackSpeed;
    } catch {
      // Ignore unsupported playback rate updates.
    }
  }, [playbackSpeed]);

  useEffect(() => {
    return () => {
      stopHeartbeat();
      stopWatchdog();
      clearTimer(retryTimerRef);
    };
  }, []);

  return (
    <div className={cn('relative overflow-hidden rounded-[28px] border border-[var(--line)] bg-black', className)}>
      {watermarkText && (
        <div className="pointer-events-none absolute left-4 top-4 z-20 rounded-full bg-black/55 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/80">
          {watermarkText}
        </div>
      )}
      {(isReconnecting || !src) && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/80 text-white">
          <div className="flex flex-col items-center gap-3 text-center">
            <LoaderCircle className="h-7 w-7 animate-spin" />
            <p className="text-sm font-semibold">{loadMessage}</p>
          </div>
        </div>
      )}
      <video
        ref={videoRef}
        data-testid="resilient-hls-video"
        className="h-[420px] w-full bg-black"
        controls
        playsInline
        preload="metadata"
        controlsList="nodownload noplaybackrate noremoteplayback"
        disablePictureInPicture
        onContextMenu={(event) => event.preventDefault()}
        aria-label={title}
      />
    </div>
  );
};
