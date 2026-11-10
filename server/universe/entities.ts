import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.ts';
import * as sec from '../sources/sec.ts';
import { mapLimit } from '../lib/http.ts';

/** What we keep about each SEC filer: enough to map tickers to CIKs and classify the business. */
export interface Entity {
  cik: number;
  name: string;
  tickers: string[];
  sic: string | null;
  sicDesc: string | null;
  fye: string | null;
  state: string | null;
  t: number;
}

const FILE = () => path.join(config.dataDir, 'sec', 'entities.json');
const SEED = () => path.join(config.seedDir, 'sec-entities.json');
const MAX_AGE = 60 * 86_400_000;

let entities = new Map<number, Entity>();
let loaded = false;

async function readFile(file: string): Promise<Entity[] | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as Entity[];
  } catch {
    return null;
  }
}

export async function loadEntities(): Promise<Map<number, Entity>> {
  if (loaded) return entities;
  const list = (await readFile(FILE())) ?? (await readFile(SEED())) ?? [];
  entities = new Map(list.map((e) => [e.cik, e]));
  loaded = true;
  return entities;
}

async function save(): Promise<void> {
  const file = FILE();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify([...entities.values()]));
  await fs.rename(tmp, file);
}

async function fetchEntity(cik: number, now: number): Promise<void> {
  const s = await sec.submission(cik, 1);
  entities.set(cik, s ? { cik, name: s.name, tickers: s.tickers, sic: s.sic, sicDesc: s.sicDescription, fye: s.fiscalYearEnd, state: s.state, t: now } : { cik, name: '', tickers: [], sic: null, sicDesc: null, fye: null, state: null, t: now });
}

let refreshing = false;

/**
 * Make sure every CIK has an entity record. Only filers we have never seen are
 * fetched before returning (one request each to data.sec.gov/submissions, rate
 * limited); records that have merely aged are refreshed a few hundred at a time
 * in the background, so a stale seed file never delays the first load.
 */
export async function ensureEntities(ciks: number[], onProgress?: (done: number, total: number) => void): Promise<void> {
  await loadEntities();
  const now = Date.now();
  const missing = ciks.filter((c) => !entities.has(c));
  let done = 0;
  let sinceSave = 0;
  await mapLimit(missing, 4, async (cik) => {
    try {
      await fetchEntity(cik, now);
    } catch {
      /* try again on the next run */
    }
    done++;
    if (++sinceSave >= 500) {
      sinceSave = 0;
      await save().catch(() => undefined);
    }
    onProgress?.(done, missing.length);
  });
  if (missing.length) await save().catch(() => undefined);

  const stale = ciks.filter((c) => {
    const e = entities.get(c);
    return e != null && now - e.t > MAX_AGE;
  });
  if (stale.length && !refreshing) {
    refreshing = true;
    void mapLimit(stale.slice(0, 300), 2, (cik) => fetchEntity(cik, Date.now()).catch(() => undefined))
      .then(() => save().catch(() => undefined))
      .finally(() => {
        refreshing = false;
      });
  }
}

export function tickerIndex(): Map<string, Entity[]> {
  const m = new Map<string, Entity[]>();
  for (const e of entities.values()) {
    for (const t of e.tickers) {
      const arr = m.get(t);
      if (arr) arr.push(e);
      else m.set(t, [e]);
    }
  }
  return m;
}

export const getEntity = (cik: number) => entities.get(cik) ?? null;

const US_STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA PR RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));
// EDGAR's own two-character codes for the countries that show up most among US listings.
const EDGAR_COUNTRY: Record<string, string> = {
  A0: 'Canada', A1: 'Canada', A2: 'Canada', A6: 'Canada', A8: 'Canada', B0: 'Canada', Z4: 'Canada',
  F4: 'China', K3: 'Hong Kong', L3: 'Israel', X0: 'United Kingdom', U0: 'Singapore', M0: 'Japan', M5: 'South Korea',
  F5: 'Taiwan', L2: 'Ireland', P7: 'Netherlands', '2M': 'Germany', I0: 'France', V8: 'Switzerland', C3: 'Australia',
  D5: 'Brazil', O5: 'Mexico', K7: 'India', J1: 'Greece', E9: 'Cayman Islands', D0: 'Bermuda', N4: 'Luxembourg',
  V7: 'Sweden', G7: 'Denmark', Q8: 'Norway', C1: 'Argentina', Y3: 'United Arab Emirates', N8: 'Malaysia', D8: 'British Virgin Islands',
};

export function countryFromState(code: string | null): string {
  if (!code) return '';
  if (US_STATES.has(code)) return 'United States';
  return EDGAR_COUNTRY[code] ?? '';
}

/** Map a SIC code onto the sector names Nasdaq uses, for stocks Nasdaq leaves unclassified. */
export function sectorFromSic(sicStr: string | null): string {
  const sic = Number(sicStr);
  if (!sic) return '';
  const inR = (a: number, b: number) => sic >= a && sic <= b;
  if (inR(2833, 2836) || inR(3841, 3851) || inR(8000, 8099) || sic === 8731 || sic === 8734) return 'Health Care';
  if (inR(6500, 6599) || sic === 6798) return 'Real Estate';
  if (inR(6000, 6799)) return 'Finance';
  if (inR(4900, 4999)) return 'Utilities';
  if (inR(4800, 4899)) return 'Telecommunications';
  if (inR(1300, 1399) || inR(1200, 1299) || inR(2900, 2999) || inR(4600, 4699) || sic === 5172) return 'Energy';
  if (inR(3570, 3579) || inR(3600, 3629) || inR(3640, 3699) || inR(7370, 7379) || inR(3810, 3829)) return 'Technology';
  if (inR(100, 999) || inR(2000, 2199) || inR(2840, 2844) || inR(5140, 5159) || inR(5400, 5499) || sic === 5912) return 'Consumer Staples';
  if (inR(1000, 1199) || inR(1400, 1499) || inR(2600, 2699) || inR(2800, 2899) || inR(3300, 3399)) return 'Basic Materials';
  if (inR(1500, 1799) || inR(3000, 3099) || inR(3400, 3569) || inR(3580, 3599) || inR(3720, 3799) || inR(4000, 4799) || inR(7380, 7389) || inR(8700, 8799) || inR(3200, 3299)) return 'Industrials';
  if (inR(2200, 2599) || inR(2700, 2799) || inR(3100, 3199) || inR(3630, 3639) || inR(3700, 3719) || inR(3900, 3999) || inR(5000, 5999) || inR(7000, 7999) || inR(8200, 8299)) return 'Consumer Discretionary';
  return 'Miscellaneous';
}
