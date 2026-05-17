import dns from 'node:dns';
import { Agent } from 'undici';
import { sleep } from './utils.js';

const dispatcherCache = new Map<string, Agent>();
const QA_FETCH_CONNECTIONS = Math.max(32, Number(process.env.QA_FETCH_CONNECTIONS || 2048));
const QA_FETCH_PIPLINING = Math.max(1, Number(process.env.QA_FETCH_PIPELINING || 1));

const derivePinnedIp = (hostname: string) => {
  const match = String(hostname || '').match(/^(?:app|live)\.(\d{1,3}(?:\.\d{1,3}){3})\.nip\.io$/i);
  return match ? match[1] : '';
};

const getDispatcherForHostname = (hostname: string) => {
  const pinnedIp = derivePinnedIp(hostname);
  if (!pinnedIp) {
    return undefined;
  }

  const cacheKey = `${hostname}:${pinnedIp}`;
  const cached = dispatcherCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const dispatcher = new Agent({
    connections: QA_FETCH_CONNECTIONS,
    pipelining: QA_FETCH_PIPLINING,
    connect: {
      lookup: (lookupHostname, options, callback) => {
        if (lookupHostname === hostname) {
          if (typeof options === 'object' && options && 'all' in options && options.all) {
            callback(null, [{ address: pinnedIp, family: 4 }]);
            return;
          }
          callback(null, pinnedIp, 4);
          return;
        }
        dns.lookup(lookupHostname, options, callback);
      },
    },
  });

  dispatcherCache.set(cacheKey, dispatcher);
  return dispatcher;
};

const resolveUrl = (input: RequestInfo | URL) => {
  if (typeof input === 'string') {
    return new URL(input);
  }
  if (input instanceof URL) {
    return input;
  }
  return new URL(input.url);
};

export const qaFetch = async (input: RequestInfo | URL, init: RequestInit = {}, attempts = 4) => {
  const url = resolveUrl(input);
  const dispatcher = getDispatcherForHostname(url.hostname);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, {
        ...init,
        ...(dispatcher ? { dispatcher } : {}),
      } as RequestInit & { dispatcher?: Agent });
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(message);
      if (!retryable || attempt === attempts) {
        throw error;
      }
      await sleep(1500 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'qaFetch failed'));
};

export const chromeHostResolverRule = (baseUrl: string) => {
  const hostname = new URL(baseUrl).hostname;
  const pinnedIp = derivePinnedIp(hostname);
  if (!pinnedIp) {
    return '';
  }

  const rules = [`MAP ${hostname} ${pinnedIp}`];
  if (hostname.startsWith('app.')) {
    rules.push(`MAP live.${hostname.slice(4)} ${pinnedIp}`);
  }

  return rules.join(',');
};
