import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';

interface Entry<T> {
  t: number;
  v: T;
}

const mem = new Map<string, Entry<any>>();
const inflight = new Map<string, Promise<any>>();
const MEM_MAX = 400;

function fileFor(ns: string, key: string): string {
  const safe = key.replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(config.dataDir, ns, `${safe}.json`);
}

export async function readCache<T>(ns: string, key: string): Promise<Entry<T> | null> {
  const id = `${ns}/${key}`;
  const m = mem.get(id);
  if (m) return m;
  try {
    const raw = await fs.readFile(fileFor(ns, key), 'utf8');
    const e = JSON.parse(raw) as Entry<T>;
    remember(id, e);
    return e;
  } catch {
    return null;
  }
}

function remember(id: string, e: Entry<any>) {
  mem.delete(id);
  mem.set(id, e);
  if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value as string);
}

export async function writeCache<T>(ns: string, key: string, v: T, keepInMemory = true): Promise<void> {
  const e: Entry<T> = { t: Date.now(), v };
  if (keepInMemory) remember(`${ns}/${key}`, e);
  const file = fileFor(ns, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(e));
  await fs.rename(tmp, file);
}

export interface CachedOpts {
  /** Do not hold the value in the in-process LRU (for very large payloads). */
  noMemory?: boolean;
}

/**
 * Return a cached value younger than ttlMs, otherwise compute it. If computing
 * fails and an older copy exists, the stale copy is served rather than an error.
 */
export async function cached<T>(ns: string, key: string, ttlMs: number, fn: () => Promise<T>, opts: CachedOpts = {}): Promise<T> {
  const id = `${ns}/${key}`;
  const hit = await readCache<T>(ns, key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const running = inflight.get(id);
  if (running) return running;
  const p = (async () => {
    try {
      const v = await fn();
      await writeCache(ns, key, v, !opts.noMemory);
      return v;
    } catch (err) {
      if (hit) return hit.v;
      throw err;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, p);
  return p;
}

/**
 * Stale-while-revalidate: once a value exists it is always returned immediately;
 * if it is older than ttlMs a refresh runs in the background for the next caller.
 */
export async function swr<T>(ns: string, key: string, ttlMs: number, fn: (prev: T | null) => Promise<T>): Promise<T> {
  const id = `${ns}/${key}`;
  const hit = await readCache<T>(ns, key);
  const refresh = () => {
    let p = inflight.get(id);
    if (!p) {
      p = (async () => {
        try {
          const v = await fn(hit ? hit.v : null);
          await writeCache(ns, key, v);
          return v;
        } finally {
          inflight.delete(id);
        }
      })();
      inflight.set(id, p);
    }
    return p as Promise<T>;
  };
  if (!hit) return refresh();
  if (Date.now() - hit.t >= ttlMs) refresh().catch(() => undefined);
  return hit.v;
}

export function cacheAgeMs(ns: string, key: string): number | null {
  try {
    const st = fssync.statSync(fileFor(ns, key));
    return Date.now() - st.mtimeMs;
  } catch {
    return null;
  }
}

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
