import { fetchText } from '../lib/http.ts';
import { num, parseCsv } from '../lib/util.ts';

/**
 * Federal Reserve Board Data Download Program (public CSV, no key).
 * Z.1 = Financial Accounts of the United States (quarterly); H.15 = selected interest rates (daily).
 */
const DDP = 'https://www.federalreserve.gov/datadownload/Output.aspx';

// Preformatted DDP packages (the hash identifies the package on the Fed's "Choose" page).
const PKG = {
  z1CorporateEquities: { rel: 'Z1', series: 'a8524445ed461a8257eab6a06d84c9b6' }, // F51.1.s (Q) Corporate equities, levels
  z1TotalEconomy: { rel: 'Z1', series: '9169e8753f1a61f92206714c7f037ff5' }, // S1.1.i.q (Q) Total economy - current account
  h15Treasury: { rel: 'H15', series: 'bf17364827e38702b42a58cf8eaa3f78' }, // Treasury constant maturities, daily
};

export interface FedTable {
  ids: string[];
  descriptions: Record<string, string>;
  multipliers: Record<string, number>;
  /** period -> id -> value (already multiplied out) */
  rows: { period: string; values: Record<string, number | null> }[];
}

async function download(pkg: { rel: string; series: string }): Promise<FedTable> {
  const url = `${DDP}?rel=${pkg.rel}&series=${pkg.series}&lastobs=&from=&to=&filetype=csv&label=include&layout=seriescolumn`;
  const text = await fetchText(url, { timeoutMs: 90_000 });
  if (!text) throw new Error(`Fed download ${pkg.rel} returned no data`);
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const find = (prefix: string) => rows.find((r) => (r[0] ?? '').trim().startsWith(prefix));
  const desc = find('Series Description') ?? [];
  const mult = find('Multiplier') ?? [];
  const idRow = find('Unique Identifier') ?? [];
  const headIdx = rows.findIndex((r) => (r[0] ?? '').trim() === 'Time Period');
  if (headIdx < 0) throw new Error(`Unexpected Fed CSV layout for ${pkg.rel}`);
  const ids = rows[headIdx].slice(1).map((s) => s.trim());
  const descriptions: Record<string, string> = {};
  const multipliers: Record<string, number> = {};
  ids.forEach((id, i) => {
    descriptions[id] = (desc[i + 1] ?? '').replace(/\s+/g, ' ').trim();
    multipliers[id] = num(mult[i + 1]) ?? 1;
  });
  const out: FedTable['rows'] = [];
  for (const r of rows.slice(headIdx + 1)) {
    const period = (r[0] ?? '').trim();
    if (!period) continue;
    const values: Record<string, number | null> = {};
    ids.forEach((id, i) => {
      const v = num(r[i + 1]);
      values[id] = v == null ? null : v * multipliers[id];
    });
    out.push({ period, values });
  }
  void idRow;
  return { ids, descriptions, multipliers, rows: out };
}

/** "2026Q2" -> "2026-06-30" */
export function quarterEnd(period: string): string {
  const m = /^(\d{4})Q([1-4])$/.exec(period);
  if (!m) return period;
  return `${m[1]}-${['03-31', '06-30', '09-30', '12-31'][Number(m[2]) - 1]}`;
}

export const z1CorporateEquities = () => download(PKG.z1CorporateEquities);
export const z1TotalEconomy = () => download(PKG.z1TotalEconomy);
export const h15Treasury = () => download(PKG.h15Treasury);
