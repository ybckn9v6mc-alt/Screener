import express, { type Request, type Response, type NextFunction } from 'express';
import compression from 'compression';
import path from 'node:path';
import fs from 'node:fs';
import { config, ROOT } from './config.ts';
import { cached, MIN } from './lib/cache.ts';
import * as cboe from './sources/cboe.ts';
import { indexBoard, RANGES, type Range } from './market/indexes.ts';
import { fearGreed } from './market/feargreed.ts';
import { buffettIndicator } from './market/buffett.ts';
import { loadSeries, seriesCatalog, cboeBars, type Point } from './market/series.ts';
import * as fed from './sources/fed.ts';
import { startUniverse, enrichSymbol, enrichment, noteCboeQuote } from './universe/build.ts';
import { state } from './universe/store.ts';
import { runScreener, screenerMeta, searchSymbols, peersOf, marketOverview } from './screener.ts';
import { companyFinancials } from './company/financials.ts';
import { stockDetail } from './company/detail.ts';
import { getEntity } from './universe/entities.ts';

const app = express();
app.disable('x-powered-by');
app.use(compression());

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((body) => {
    if (!res.headersSent) res.json(body);
  }, next);
};

const normSymbol = (s: string) => decodeURIComponent(s).trim().toUpperCase().replace(/[^A-Z0-9.]/g, '').slice(0, 10);

/**
 * Reduce a series to about `max` points by keeping the last point in each equal
 * slice of time. Slicing by time (not by position) keeps the sparse quarterly
 * stretch of a series intact next to decades of daily data.
 */
function thin(points: Point[], max: number): Point[] {
  if (points.length <= max) return points;
  const t0 = Date.parse(points[0][0]);
  const t1 = Date.parse(points[points.length - 1][0]);
  const width = Math.max(1, (t1 - t0) / max);
  const out: Point[] = [];
  let bucket = -1;
  for (const p of points) {
    const b = Math.floor((Date.parse(p[0]) - t0) / width);
    if (b === bucket) out[out.length - 1] = p;
    else {
      out.push(p);
      bucket = b;
    }
  }
  return out;
}

// ---- status -----------------------------------------------------------------------
app.get('/api/status', (_req, res) => {
  res.json({ ...state.status, session: state.session, now: Date.now() });
});

// ---- market dashboard ---------------------------------------------------------------
app.get('/api/market/indexes', wrap(async (req) => {
  const range = (RANGES as string[]).includes(String(req.query.range)) ? (req.query.range as Range) : '1d';
  return { range, session: state.session, cards: await indexBoard(range) };
}));

app.get('/api/market/overview', wrap(async () => marketOverview()));

app.get('/api/market/feargreed', wrap(async () => {
  const fg = await fearGreed();
  return { ...fg, history: fg.history, componentHistory: Object.fromEntries(Object.entries(fg.componentHistory).map(([k, v]) => [k, thin(v, 1200)])) };
}));

app.get('/api/market/buffett', wrap(async () => {
  const b = await buffettIndicator();
  return { ...b, history: thin(b.history, 2500) };
}));

app.get('/api/market/yields', wrap(async () => {
  const t = await cached('fed', 'h15-treasury', 6 * 60 * MIN, () => fed.h15Treasury(), { noMemory: true });
  const labels: Record<string, string> = { 'RIFLGFCM01_N.B': '1M', 'RIFLGFCM03_N.B': '3M', 'RIFLGFCM06_N.B': '6M', 'RIFLGFCY01_N.B': '1Y', 'RIFLGFCY02_N.B': '2Y', 'RIFLGFCY03_N.B': '3Y', 'RIFLGFCY05_N.B': '5Y', 'RIFLGFCY07_N.B': '7Y', 'RIFLGFCY10_N.B': '10Y', 'RIFLGFCY20_N.B': '20Y', 'RIFLGFCY30_N.B': '30Y' };
  const rows = t.rows.filter((r) => Object.values(r.values).some((v) => v != null));
  const pick = (back: number) => {
    const r = rows[Math.max(0, rows.length - 1 - back)];
    return { date: r.period, points: t.ids.map((id) => ({ tenor: labels[id] ?? id, value: r.values[id] })) };
  };
  return { latest: pick(0), monthAgo: pick(21), yearAgo: pick(252), source: 'Federal Reserve H.15' };
}));

app.get('/api/market/series/catalog', (_req, res) => {
  res.json(seriesCatalog());
});

app.get('/api/market/series', wrap(async (req) => {
  const ids = String(req.query.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8);
  const max = Math.min(6000, Math.max(200, Number(req.query.max) || 2500));
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const out = [];
  for (const id of ids) {
    try {
      const s = await loadSeries(id);
      if (!s) continue;
      const data = from ? s.data.filter((p) => p[0] >= from) : s.data;
      out.push({ ...s, data: thin(data, max) });
    } catch (err) {
      out.push({ id, name: id, short: id, unit: 'index', source: '', data: [], error: (err as Error).message });
    }
  }
  return { series: out };
}));

// ---- screener -----------------------------------------------------------------------
const RESERVED = new Set(['sort', 'dir', 'page', 'size', 'view', 'signal', 'columns', 'q', 'symbols', 'format']);

app.get('/api/screener', wrap(async (req, res) => {
  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.query)) if (!RESERVED.has(k) && typeof v === 'string' && v) filters[k] = v;
  const q = req.query;
  const result = runScreener({
    filters,
    signal: typeof q.signal === 'string' ? q.signal : undefined,
    sort: typeof q.sort === 'string' ? q.sort : undefined,
    dir: q.dir === 'asc' || q.dir === 'desc' ? q.dir : undefined,
    page: Number(q.page) || 1,
    size: q.format === 'csv' ? 500 : Number(q.size) || 20,
    view: typeof q.view === 'string' ? q.view : 'overview',
    columns: typeof q.columns === 'string' ? q.columns.split(',') : undefined,
    q: typeof q.q === 'string' ? q.q : undefined,
    symbols: typeof q.symbols === 'string' ? q.symbols.split(',').map(normSymbol) : undefined,
  });
  if (q.format === 'csv') {
    const cols = [...new Set(['symbol', 'name', ...result.columns])];
    const esc = (v: unknown) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const lines = [cols.join(','), ...result.rows.map((r) => cols.map((c) => esc(Array.isArray(r[c]) ? (r[c] as string[]).join(' ') : r[c])).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="screener.csv"');
    res.send(lines.join('\n'));
    return undefined;
  }
  return { ...result, status: { stage: state.status.stage, technicals: state.status.technicals, fundamentals: state.status.fundamentals.done, session: state.session } };
}));

app.get('/api/screener/meta', (_req, res) => {
  res.json({ ...screenerMeta(), status: state.status });
});

app.get('/api/search', (req, res) => {
  res.json(searchSymbols(String(req.query.q ?? ''), 10));
});

// ---- stock --------------------------------------------------------------------------
app.get('/api/stock/:symbol', wrap(async (req, res) => {
  const symbol = normSymbol(req.params.symbol);
  const row = state.rows.get(symbol);
  if (!row) {
    res.status(404).json({ error: `${symbol} is not in the US-listed stock universe` });
    return undefined;
  }
  // Opening a stock page refreshes its analyst / ownership data if the slow crawl has not reached it.
  const e = enrichment.get(symbol);
  if (config.background && (!e || Date.now() - e.t > 24 * 60 * MIN)) await enrichSymbol(symbol).catch(() => undefined);
  const [detail, quote] = await Promise.all([
    stockDetail(symbol).catch(() => null),
    cached('quote-cboe', symbol, MIN, () => cboe.quote(symbol)).catch(() => null),
  ]);
  if (quote) noteCboeQuote(row, quote);
  const entity = row.cik != null ? getEntity(row.cik) : null;
  return {
    row,
    quote,
    detail,
    entity: entity ? { cik: entity.cik, name: entity.name, sic: entity.sic, sicDesc: entity.sicDesc, fiscalYearEnd: entity.fye } : null,
    peers: peersOf(symbol, 8).map((p) => ({ symbol: p.symbol, name: p.name, marketCap: p.marketCap, industry: p.industry })),
    session: state.session,
  };
}));

app.get('/api/stock/:symbol/chart', wrap(async (req) => {
  const symbol = normSymbol(req.params.symbol);
  if (req.query.range === '1d') {
    const bars = await cached('intraday-cboe', symbol, MIN, () => cboe.intraday(symbol));
    return { symbol, intraday: true, bars: bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v]) };
  }
  const bars = await cboeBars(symbol);
  return { symbol, intraday: false, bars: bars.map((b) => [b.d, b.o, b.h, b.l, b.c, b.v]) };
}));

app.get('/api/stock/:symbol/financials', wrap(async (req, res) => {
  const symbol = normSymbol(req.params.symbol);
  const row = state.rows.get(symbol);
  if (!row?.cik) {
    res.status(404).json({ error: 'No SEC XBRL financial statements are available for this symbol (typical for foreign filers reporting under IFRS).' });
    return undefined;
  }
  const fin = await companyFinancials(row.cik);
  if (!fin) {
    res.status(404).json({ error: 'No SEC XBRL financial statements are available for this symbol (typical for foreign filers reporting under IFRS).' });
    return undefined;
  }
  return fin;
}));

app.get('/api/compare', wrap(async (req) => {
  const symbols = [...new Set(String(req.query.symbols ?? '').split(',').map(normSymbol).filter(Boolean))].slice(0, 8);
  const rows = symbols.map((s) => state.rows.get(s)).filter((r): r is NonNullable<typeof r> => r != null);
  const keys = ['revenue', 'netIncome', 'fcf', 'eps', 'grossMargin', 'operMargin', 'netMargin', 'roe', 'roic', 'debtEq', 'revenueGrowth', 'fcfPerShare', 'dps'];
  const financials: Record<string, { labels: string[]; ends: string[]; values: Record<string, (number | null)[]> } | null> = {};
  const prices: Record<string, Point[]> = {};
  await Promise.all(rows.map(async (r) => {
    try {
      const fin = r.cik ? await companyFinancials(r.cik) : null;
      financials[r.symbol] = fin ? { labels: fin.annual.periods.map((p) => p.label), ends: fin.annual.periods.map((p) => p.end), values: Object.fromEntries(keys.map((k) => [k, fin.annual.values[k] ?? []])) } : null;
    } catch {
      financials[r.symbol] = null;
    }
    try {
      const bars = await cboeBars(r.symbol);
      prices[r.symbol] = thin(bars.slice(-2520).map((b) => [b.d, b.c] as Point), 1300);
    } catch {
      prices[r.symbol] = [];
    }
  }));
  return { rows, financials, prices, missing: symbols.filter((s) => !state.rows.has(s)) };
}));

app.get('/api/peers/:symbol', (req, res) => {
  res.json(peersOf(normSymbol(req.params.symbol), 12).map((p) => ({ symbol: p.symbol, name: p.name, marketCap: p.marketCap, industry: p.industry, sector: p.sector })));
});

// ---- static client ------------------------------------------------------------------
const dist = path.join(ROOT, 'dist');
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Unknown API route' });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[api]', err.message);
  if (!res.headersSent) res.status(502).json({ error: err.message || 'Upstream data source failed' });
});

app.listen(config.port, () => {
  console.log(`Stock screener API listening on http://localhost:${config.port}`);
  void startUniverse();
  if (config.background) {
    // Warm the dashboard so the first visitor does not wait on cold upstream requests.
    const warm = () => {
      indexBoard('1d').catch(() => undefined);
      fearGreed().catch(() => undefined);
      buffettIndicator().catch(() => undefined);
    };
    warm();
    setInterval(warm, 2 * MIN).unref();
  }
});
