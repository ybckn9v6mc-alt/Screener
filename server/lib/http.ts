import { config } from '../config.ts';

/**
 * Small polite HTTP client: identifies itself honestly, limits concurrency and
 * request rate per host, backs off when a host says "slow down" (429/503), and
 * lets interactive requests go ahead of background crawls.
 */
interface HostPolicy {
  concurrency: number;
  minIntervalMs: number;
}

const POLICIES: Record<string, HostPolicy> = {
  'api.nasdaq.com': { concurrency: 5, minIntervalMs: 70 },
  'data.sec.gov': { concurrency: 4, minIntervalMs: 125 }, // SEC fair access: stay under 10 req/s
  'cdn-api.cboe.com': { concurrency: 2, minIntervalMs: 650 }, // Cboe throttles above roughly 1-2 requests a second
  'www.federalreserve.gov': { concurrency: 2, minIntervalMs: 250 },
  'en.wikipedia.org': { concurrency: 1, minIntervalMs: 1000 },
};
const DEFAULT_POLICY: HostPolicy = { concurrency: 2, minIntervalMs: 250 };

class HostQueue {
  private active = 0;
  private lastStart = 0;
  private pausedUntil = 0;
  private strikes = 0;
  private high: Array<() => void> = [];
  private low: Array<() => void> = [];
  constructor(private policy: HostPolicy) {}

  /** Called when the host throttles us: hold every request to it for a while. */
  backoff(retryAfterMs?: number) {
    this.strikes = Math.min(this.strikes + 1, 5);
    const wait = retryAfterMs ?? 5_000 * 2 ** (this.strikes - 1);
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + Math.min(wait, 120_000));
  }

  ok() {
    if (this.strikes > 0 && Date.now() > this.pausedUntil + 30_000) this.strikes = 0;
  }

  get busy(): boolean {
    return Date.now() < this.pausedUntil;
  }

  async run<T>(fn: () => Promise<T>, background: boolean): Promise<T> {
    if (this.active >= this.policy.concurrency) {
      await new Promise<void>((resolve) => (background ? this.low : this.high).push(resolve));
    } else {
      this.active++;
    }
    try {
      const earliest = Math.max(this.lastStart + this.policy.minIntervalMs, this.pausedUntil);
      const wait = earliest - Date.now();
      this.lastStart = Math.max(Date.now(), earliest);
      if (wait > 0) await sleep(wait);
      return await fn();
    } finally {
      const next = this.high.shift() ?? this.low.shift();
      if (next) next();
      else this.active--;
    }
  }
}

const queues = new Map<string, HostQueue>();
function queueFor(host: string): HostQueue {
  let q = queues.get(host);
  if (!q) {
    q = new HostQueue(POLICIES[host] ?? DEFAULT_POLICY);
    queues.set(host, q);
  }
  return q;
}

export const hostIsThrottled = (host: string) => queueFor(host).busy;
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(public status: number, public url: string, message?: string) {
    super(message ?? `HTTP ${status} for ${url}`);
  }
}

export interface FetchOpts {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  /** Treat these statuses as "no data" and return null instead of throwing. */
  nullOn?: number[];
  /** Background crawl: yields to interactive requests queued for the same host. */
  background?: boolean;
}

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string | null> {
  const u = new URL(url);
  const isSec = u.hostname.endsWith('sec.gov');
  const headers: Record<string, string> = {
    'User-Agent': isSec ? config.secUserAgent : config.userAgent,
    Accept: 'application/json, text/csv, text/plain, */*',
    'Accept-Encoding': 'gzip, deflate',
    ...opts.headers,
  };
  const retries = opts.retries ?? 3;
  const nullOn = opts.nullOn ?? [404];
  const queue = queueFor(u.hostname);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await queue.run(async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
        try {
          const res = await fetch(url, { headers, signal: ctrl.signal, redirect: 'follow' });
          if (res.status === 429 || res.status === 503) {
            const ra = Number(res.headers.get('retry-after'));
            queue.backoff(Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
            await res.arrayBuffer().catch(() => undefined);
            throw new HttpError(res.status, url);
          }
          if (nullOn.includes(res.status)) {
            await res.arrayBuffer().catch(() => undefined);
            return null;
          }
          if (!res.ok) {
            await res.arrayBuffer().catch(() => undefined);
            throw new HttpError(res.status, url);
          }
          queue.ok();
          return await res.text();
        } finally {
          clearTimeout(timer);
        }
      }, opts.background === true);
    } catch (err) {
      lastErr = err;
      // A refusal (401/403) is a policy answer, not a transient fault: do not hammer it.
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) break;
      // After a throttle the queue itself holds the next attempt; other errors get a short pause.
      if (attempt < retries && !(err instanceof HttpError && (err.status === 429 || err.status === 503))) await sleep(400 * 2 ** attempt + Math.random() * 200);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchJson<T = any>(url: string, opts: FetchOpts = {}): Promise<T | null> {
  const text = await fetchText(url, opts);
  if (text == null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 120)}`);
  }
}

/** Run an async mapper over items with bounded parallelism. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
