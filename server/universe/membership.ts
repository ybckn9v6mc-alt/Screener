import { cached, DAY } from '../lib/cache.ts';
import { fetchJson } from '../lib/http.ts';
import * as nasdaq from '../sources/nasdaq.ts';

/** Index constituents: S&P 500 and Dow from Wikipedia's maintained tables, Nasdaq-100 from Nasdaq. */
async function wikiSymbols(page: string, min: number, max: number): Promise<string[]> {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json&formatversion=2`;
  const j = await fetchJson<any>(url, { timeoutMs: 45_000, retries: 2 });
  const text: string = j?.parse?.wikitext ?? '';
  const out = new Set<string>();
  // Constituent tables use exchange templates such as {{NyseSymbol|MMM}} or {{NASDAQ|AAPL}}.
  const re = /\{\{\s*(?:NyseSymbol|NasdaqSymbol|NYSE|NASDAQ|New York Stock Exchange|Nasdaq|BATS|CboeSymbol)\s*\|\s*([A-Za-z.\-]{1,6})\s*(?:\|[^}]*)?\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.add(m[1].toUpperCase().replace('-', '.'));
  if (out.size < min || out.size > max) throw new Error(`unexpected constituent count for ${page}: ${out.size}`);
  return [...out];
}

/**
 * Used only if Wikipedia cannot be reached. The Dow changes roughly once a
 * year, so this list (as of the last 2024 changes) can lag behind.
 */
const DJIA_FALLBACK = 'AAPL AMGN AMZN AXP BA CAT CRM CSCO CVX DIS GS HD HON IBM JNJ JPM KO MCD MMM MRK MSFT NKE NVDA PG SHW TRV UNH V VZ WMT'.split(' ');

export interface Membership {
  sp500: string[];
  djia: string[];
  ndx: string[];
  djiaIsFallback: boolean;
}

const list = (key: string, fn: () => Promise<string[]>) => cached('membership', key, 7 * DAY, fn).catch(() => [] as string[]);

export async function loadMembership(): Promise<Membership> {
  // Sequential on purpose: Wikipedia throttles bursts.
  const sp500 = await list('sp500', () => wikiSymbols('List of S&P 500 companies', 480, 520));
  const djia = await list('djia', () => wikiSymbols('Dow Jones Industrial Average', 28, 32));
  const ndx = await list('ndx', async () => {
    const s = await nasdaq.nasdaq100();
    if (s.length < 90) throw new Error('nasdaq-100 list unavailable');
    return s;
  });
  return { sp500, djia: djia.length ? djia : DJIA_FALLBACK, ndx, djiaIsFallback: !djia.length };
}
