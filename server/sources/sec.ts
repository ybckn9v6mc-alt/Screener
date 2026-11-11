import { fetchJson } from '../lib/http.ts';

/**
 * SEC EDGAR XBRL APIs (data.sec.gov). Free, no key; the SEC asks automated
 * clients to stay under 10 requests/second and to identify themselves.
 */
const BASE = 'https://data.sec.gov';

export interface FrameFact {
  cik: number;
  entityName: string;
  loc: string;
  start?: string;
  end: string;
  val: number;
  accn: string;
}

/**
 * One concept for one calendar-aligned period across every filer.
 * period: CY2025 (annual duration), CY2025Q2 (quarterly duration), CY2025Q2I (instant).
 */
export async function frame(taxonomy: 'us-gaap' | 'dei', tag: string, unit: string, period: string): Promise<FrameFact[]> {
  const j = await fetchJson<{ data: FrameFact[] }>(`${BASE}/api/xbrl/frames/${taxonomy}/${tag}/${unit}/${period}.json`, { nullOn: [404], timeoutMs: 60_000 });
  return j?.data ?? [];
}

export interface CompanyFact {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy: number | null;
  fp: string | null;
  form: string;
  filed: string;
  frame?: string;
}

export interface CompanyFacts {
  cik: number;
  entityName: string;
  facts: Record<string, Record<string, { label: string | null; description: string | null; units: Record<string, CompanyFact[]> }>>;
}

/**
 * A company that reorganizes under a new holding company keeps its ticker but becomes a new SEC
 * registrant with no filing history of its own. The SEC does not publish the link between the two
 * in machine-readable form, so known cases are listed here: successor CIK -> predecessor CIK.
 */
export const PREDECESSOR: Record<number, number> = {
  2115436: 34088, // ExxonMobil Holdings Corp <- Exxon Mobil Corp
};

async function rawCompanyFacts(cik: number, background: boolean): Promise<CompanyFacts | null> {
  return fetchJson<CompanyFacts>(`${BASE}/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`, { nullOn: [404], timeoutMs: 90_000, background });
}

/** A company's full XBRL history, joined with its predecessor registrant's where there is one. */
export async function companyFacts(cik: number, background = false): Promise<CompanyFacts | null> {
  const own = await rawCompanyFacts(cik, background);
  const pred = PREDECESSOR[cik];
  if (pred == null) return own;
  const old = await rawCompanyFacts(pred, background).catch(() => null);
  if (!old) return own;
  if (!own) return { ...old, cik };
  for (const [taxonomy, tags] of Object.entries(old.facts ?? {})) {
    const into = (own.facts[taxonomy] ??= {});
    for (const [tag, def] of Object.entries(tags)) {
      const target = (into[tag] ??= { label: def.label, description: def.description, units: {} });
      for (const [unit, list] of Object.entries(def.units ?? {})) target.units[unit] = [...list, ...(target.units[unit] ?? [])];
    }
  }
  return own;
}

export interface Submission {
  cik: number;
  name: string;
  tickers: string[];
  exchanges: string[];
  sic: string | null;
  sicDescription: string | null;
  fiscalYearEnd: string | null; // MMDD
  stateOfIncorporation: string | null;
  state: string | null;
  category: string | null;
  entityType: string | null;
  website: string | null;
  description: string | null;
  filings: { form: string; filed: string; accn: string; doc: string; reportDate: string }[];
}

export async function submission(cik: number, maxFilings = 400): Promise<Submission | null> {
  const j = await fetchJson<any>(`${BASE}/submissions/CIK${String(cik).padStart(10, '0')}.json`, { nullOn: [404], timeoutMs: 60_000 });
  if (!j) return null;
  const r = j.filings?.recent ?? {};
  const n = Math.min(maxFilings, r.form?.length ?? 0);
  const filings: Submission['filings'] = [];
  for (let i = 0; i < n; i++) {
    filings.push({ form: r.form[i], filed: r.filingDate[i], accn: r.accessionNumber[i], doc: r.primaryDocument?.[i] ?? '', reportDate: r.reportDate?.[i] ?? '' });
  }
  return {
    cik: Number(j.cik),
    name: String(j.name ?? ''),
    tickers: (j.tickers ?? []).map((t: string) => String(t).toUpperCase().replace('-', '.')),
    exchanges: j.exchanges ?? [],
    sic: j.sic || null,
    sicDescription: j.sicDescription || null,
    fiscalYearEnd: j.fiscalYearEnd || null,
    stateOfIncorporation: j.stateOfIncorporation || null,
    state: j.addresses?.business?.stateOrCountry || null,
    category: j.category || null,
    entityType: j.entityType || null,
    website: j.website || null,
    description: j.description || null,
    filings,
  };
}

export function filingUrl(cik: number, accn: string, doc: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replace(/-/g, '')}/${doc}`;
}

export function filingIndexUrl(cik: number): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K&dateb=&owner=include&count=40`;
}
