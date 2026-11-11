import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.ts';
import type { Bar, BuildStatus, StockRow } from '../../shared/types.ts';
import type { Levels } from './technicals.ts';
import type { Fundamentals } from './fundamentals.ts';

/** In-memory screener universe, persisted as one snapshot file between restarts. */
/** The latest delayed quote for the current session, taken from Cboe. */
export interface LiveQuote {
  date: string;
  price: number;
  pct: number | null;
  volume: number | null;
  o: number | null;
  h: number | null;
  l: number | null;
  final: boolean; // taken after the closing bell
  t: number;
}

export interface LevelsMeta extends Levels {
  fetchedAt: number;
  lastBar: string;
}

export const state = {
  rows: new Map<string, StockRow>(),
  levels: new Map<string, LevelsMeta>(),
  live: new Map<string, LiveQuote>(),
  /** Session the bulk end-of-day listing reflects; behind session.date until its evening refresh. */
  screenerSession: '',
  funds: new Map<number, Fundamentals>(),
  optionableAt: new Map<string, number>(),
  session: { date: '', open: false, status: '' },
  quotesAt: 0,
  fundamentalsAt: 0,
  status: {
    stage: 'starting',
    universe: { count: 0, updatedAt: null },
    fundamentals: { done: false, covered: 0, updatedAt: null },
    technicals: { done: 0, total: 0, updatedAt: null },
    enrichment: { done: 0, total: 0, enabled: config.enrich },
    errors: [],
  } as BuildStatus,
};

export function noteError(msg: string) {
  const line = `${new Date().toISOString().slice(11, 19)} ${msg}`;
  state.status.errors = [line, ...state.status.errors].slice(0, 8);
  console.warn(`[universe] ${msg}`);
}

const SNAP = () => path.join(config.dataDir, 'universe', 'snapshot.json');
/** Bump when the rules that derive stored fundamentals change. */
const SNAPSHOT_VERSION = 4;

let dirty = false;
export const markDirty = () => {
  dirty = true;
};

export async function saveSnapshot(force = false): Promise<void> {
  if (!dirty && !force) return;
  dirty = false;
  const file = SNAP();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const payload = {
    v: SNAPSHOT_VERSION,
    savedAt: Date.now(),
    session: state.session,
    quotesAt: state.quotesAt,
    fundamentalsAt: state.fundamentalsAt,
    rows: [...state.rows.values()],
    levels: [...state.levels.entries()],
    funds: [...state.funds.values()],
    optionableAt: [...state.optionableAt.entries()],
    live: [...state.live.entries()],
    screenerSession: state.screenerSession,
  };
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload));
  await fs.rename(tmp, file);
}

export async function loadSnapshot(): Promise<boolean> {
  try {
    const p = JSON.parse(await fs.readFile(SNAP(), 'utf8'));
    state.rows = new Map((p.rows as StockRow[]).map((r) => [r.symbol, r]));
    state.levels = new Map(p.levels ?? []);
    // Levels saved by an older build may lack newer fields; flag them so they are
    // re-derived from the bars already on disk (no network needed).
    for (const lv of state.levels.values()) if (!('prev2Close' in lv)) (lv as LevelsMeta & { forSession?: string }).forSession = '';
    state.funds = new Map(((p.funds ?? []) as Fundamentals[]).map((f) => [f.cik, f]));
    state.optionableAt = new Map(p.optionableAt ?? []);
    state.live = new Map(p.live ?? []);
    state.screenerSession = p.screenerSession ?? '';
    state.session = p.session ?? state.session;
    state.quotesAt = p.quotesAt ?? 0;
    // An older snapshot's fundamentals were computed by older rules: refresh them at startup.
    state.fundamentalsAt = p.v === SNAPSHOT_VERSION ? (p.fundamentalsAt ?? 0) : 0;
    state.status.universe = { count: state.rows.size, updatedAt: state.quotesAt || null };
    state.status.fundamentals = { done: state.funds.size > 0, covered: [...state.rows.values()].filter((r) => r.cik != null && r.fundamentalsAsOf).length, updatedAt: state.fundamentalsAt || null };
    return true;
  } catch {
    return false;
  }
}

// ---- compact per-symbol bar files -------------------------------------------------

const barFile = (sym: string) => path.join(config.dataDir, 'bars', `${sym.replace(/[^A-Z0-9.]/g, '_')}.json`);

export async function readBars(sym: string): Promise<Bar[]> {
  try {
    const p = JSON.parse(await fs.readFile(barFile(sym), 'utf8'));
    const out: Bar[] = [];
    for (let i = 0; i < p.d.length; i++) out.push({ d: p.d[i], o: p.o[i], h: p.h[i], l: p.l[i], c: p.c[i], v: p.v[i] });
    return out;
  } catch {
    return [];
  }
}

export async function writeBars(sym: string, bars: Bar[]): Promise<void> {
  const file = barFile(sym);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const p = { d: bars.map((b) => b.d), o: bars.map((b) => b.o), h: bars.map((b) => b.h), l: bars.map((b) => b.l), c: bars.map((b) => b.c), v: bars.map((b) => b.v) };
  await fs.writeFile(file, JSON.stringify(p));
}
