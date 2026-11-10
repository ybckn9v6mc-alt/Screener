import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* keep the default message */
    }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** True while a newer request is in flight and the previous data is still shown. */
  stale: boolean;
  reload: () => void;
}

/**
 * Fetch JSON for a path. While a new path loads, the previous result stays on
 * screen (marked stale) so charts keep their frame instead of flashing empty.
 */
export function useApi<T>(path: string | null, refreshMs?: number): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(path != null);
  const [stale, setStale] = useState(false);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (path == null) {
      setData(null);
      setLoading(false);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    setStale(true);
    api<T>(path).then(
      (d) => {
        if (id !== seq.current) return;
        setData(d);
        setError(null);
        setLoading(false);
        setStale(false);
      },
      (e: Error) => {
        if (id !== seq.current) return;
        setError(e.message);
        setLoading(false);
        setStale(false);
      },
    );
  }, [path, tick]);

  useEffect(() => {
    if (!refreshMs || path == null) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') setTick((n) => n + 1);
    }, refreshMs);
    return () => clearInterval(t);
  }, [refreshMs, path]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, loading, stale: stale && data != null, reload };
}
