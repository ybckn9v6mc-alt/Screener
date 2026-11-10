/** One daily price bar. */
export interface Bar {
  d: string; // YYYY-MM-DD
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/**
 * One row of the screener universe. Ratios are plain numbers (0.15 = 15%) unless
 * the name says otherwise; null always means "not available", never zero.
 */
export interface StockRow {
  symbol: string;
  name: string;
  exchange: string;
  sector: string;
  industry: string;
  country: string;
  type: 'stock' | 'adr' | 'other';
  indexes: string[]; // 'sp500' | 'ndx' | 'djia' | 'r2000'
  cik?: number | null;
  sic?: string | null;
  ipoYear: number | null;
  ipoDate?: string | null;

  // quote
  price: number | null;
  change: number | null; // today's % change as a ratio
  volume: number | null;
  marketCap: number | null;
  sharesOut: number | null;
  float?: number | null;

  // valuation
  pe?: number | null;
  fpe?: number | null;
  peg?: number | null;
  ps?: number | null;
  pb?: number | null;
  pc?: number | null;
  pfcf?: number | null;
  evEbitda?: number | null;
  evSales?: number | null;
  ev?: number | null;

  // per share / income
  eps?: number | null;
  revenue?: number | null;
  netIncome?: number | null;
  fcf?: number | null;
  ebitda?: number | null;
  bookPerShare?: number | null;
  cashPerShare?: number | null;
  dividend?: number | null;
  dividendYield?: number | null;
  payout?: number | null;
  dividendGrowth?: number | null;

  // growth
  epsGrowthThisYear?: number | null;
  epsGrowthNextYear?: number | null;
  epsGrowthNext5y?: number | null;
  epsGrowthQoq?: number | null;
  epsGrowthTtm?: number | null;
  epsGrowth3y?: number | null;
  epsGrowth5y?: number | null;
  salesGrowthQoq?: number | null;
  salesGrowthTtm?: number | null;
  salesGrowth3y?: number | null;
  salesGrowth5y?: number | null;

  // profitability & health
  roa?: number | null;
  roe?: number | null;
  roic?: number | null;
  grossMargin?: number | null;
  operMargin?: number | null;
  netMargin?: number | null;
  currentRatio?: number | null;
  quickRatio?: number | null;
  ltDebtEq?: number | null;
  debtEq?: number | null;
  fundamentalsAsOf?: string | null;

  // ownership / analysts (slow enrichment crawl)
  insiderOwn?: number | null;
  insiderTrans?: number | null;
  instOwn?: number | null;
  instTrans?: number | null;
  shortFloat?: number | null;
  shortRatio?: number | null;
  recom?: number | null; // 1 = strong buy ... 5 = strong sell
  targetPrice?: number | null;
  earningsDate?: string | null;
  earningsTime?: string | null;
  optionable?: boolean | null;
  enrichedAt?: number | null;

  // technicals (as of the last completed daily bar)
  open?: number | null;
  high?: number | null;
  low?: number | null;
  prevClose?: number | null;
  gap?: number | null;
  changeFromOpen?: number | null;
  perfWeek?: number | null;
  perfMonth?: number | null;
  perfQuarter?: number | null;
  perfHalf?: number | null;
  perfYear?: number | null;
  perfYtd?: number | null;
  volatilityWeek?: number | null;
  volatilityMonth?: number | null;
  rsi?: number | null;
  sma20?: number | null; // price relative to the average, as a ratio (0.05 = 5% above)
  sma50?: number | null;
  sma200?: number | null;
  sma20v?: number | null; // the averages themselves
  sma50v?: number | null;
  sma200v?: number | null;
  high20?: number | null; // distance from the 20-day high, as a ratio (<= 0)
  low20?: number | null;
  high50?: number | null;
  low50?: number | null;
  high52w?: number | null;
  low52w?: number | null;
  beta?: number | null;
  atr?: number | null;
  avgVolume?: number | null;
  relVolume?: number | null;
  pattern?: string | null;
  candle?: string | null;
  barsAsOf?: string | null;
  spark?: number[];
}

export interface BuildStatus {
  stage: string;
  universe: { count: number; updatedAt: number | null };
  fundamentals: { done: boolean; covered: number; updatedAt: number | null; progress?: string };
  technicals: { done: number; total: number; updatedAt: number | null };
  enrichment: { done: number; total: number; enabled: boolean };
  /** Rolling delayed-quote sweep; `behind` means the end-of-day listing predates the current session. */
  live?: { behind: boolean; done: number; total: number };
  errors: string[];
}
