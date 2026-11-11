/** Shapes for company financial statements built from SEC XBRL filings. */
export interface Period {
  start: string | null;
  end: string;
  label: string; // "FY2025", "Q3 FY2025", "TTM"
  fiscalYear: number;
  kind: 'annual' | 'quarter' | 'ttm';
}

export interface LineItem {
  key: string;
  label: string;
  section: 'income' | 'cashflow' | 'balance' | 'ratios' | 'pershare';
  fmt: 'money' | 'pct' | 'x' | 'pershare' | 'shares';
  /** Shown in bold as a subtotal. */
  strong?: boolean;
  note?: string;
}

export interface StatementSet {
  periods: Period[];
  /** key -> one value per period */
  values: Record<string, (number | null)[]>;
}

export interface Financials {
  cik: number;
  name: string;
  currency: string;
  fiscalYearEnd: string | null;
  lineItems: LineItem[];
  annual: StatementSet;
  quarterly: StatementSet;
  /** Latest trailing twelve months (flows summed over four quarters, balance sheet at the latest quarter end). */
  ttm: { period: Period; values: Record<string, number | null> } | null;
  filings: { form: string; filed: string; reportDate: string; url: string }[];
  /** Set when older years were converted to today's share basis after a stock split (the largest factor applied). */
  splitAdjusted?: number | null;
  /** The same, restricted to the last five fiscal years (the ones the checklist scores). */
  splitAdjustedRecent?: number | null;
  source: string;
}

export const LINE_ITEMS: LineItem[] = [
  { key: 'revenue', label: 'Revenue', section: 'income', fmt: 'money', strong: true },
  { key: 'costOfRevenue', label: 'Cost of revenue', section: 'income', fmt: 'money' },
  { key: 'grossProfit', label: 'Gross profit', section: 'income', fmt: 'money', strong: true },
  { key: 'rnd', label: 'Research & development', section: 'income', fmt: 'money' },
  { key: 'sga', label: 'Selling, general & admin', section: 'income', fmt: 'money' },
  { key: 'operatingIncome', label: 'Operating income (EBIT)', section: 'income', fmt: 'money', strong: true },
  { key: 'interestExpense', label: 'Interest expense', section: 'income', fmt: 'money' },
  { key: 'pretaxIncome', label: 'Pre-tax income', section: 'income', fmt: 'money' },
  { key: 'incomeTax', label: 'Income tax', section: 'income', fmt: 'money' },
  { key: 'netIncome', label: 'Net income', section: 'income', fmt: 'money', strong: true },
  { key: 'ebitda', label: 'EBITDA', section: 'income', fmt: 'money', note: 'Operating income + depreciation & amortization' },

  { key: 'cfo', label: 'Cash from operations', section: 'cashflow', fmt: 'money', strong: true },
  { key: 'capex', label: 'Capital expenditures', section: 'cashflow', fmt: 'money', note: 'Purchases of property and equipment, oil and gas properties, rental equipment, capitalized software and other intangible assets, as tagged in the filing' },
  { key: 'fcf', label: 'Free cash flow', section: 'cashflow', fmt: 'money', strong: true, note: 'Cash from operations − capital expenditures. Blank when capital spending is not tagged.' },
  { key: 'da', label: 'Depreciation & amortization', section: 'cashflow', fmt: 'money' },
  { key: 'sbc', label: 'Stock-based compensation', section: 'cashflow', fmt: 'money' },
  { key: 'ownerEarnings', label: 'Owner earnings (est.)', section: 'cashflow', fmt: 'money', strong: true, note: 'Net income + D&A − maintenance capex, where maintenance capex is taken as the lesser of capex and D&A' },
  { key: 'dividendsPaid', label: 'Dividends paid', section: 'cashflow', fmt: 'money' },
  { key: 'buybacks', label: 'Share repurchases', section: 'cashflow', fmt: 'money' },
  { key: 'acquisitions', label: 'Acquisitions', section: 'cashflow', fmt: 'money' },
  { key: 'interestPaid', label: 'Cash interest paid', section: 'cashflow', fmt: 'money' },

  { key: 'cash', label: 'Cash & short-term investments', section: 'balance', fmt: 'money' },
  { key: 'receivables', label: 'Receivables', section: 'balance', fmt: 'money' },
  { key: 'inventory', label: 'Inventory', section: 'balance', fmt: 'money' },
  { key: 'currentAssets', label: 'Current assets', section: 'balance', fmt: 'money' },
  { key: 'ppe', label: 'Property, plant & equipment', section: 'balance', fmt: 'money' },
  { key: 'goodwill', label: 'Goodwill & intangibles', section: 'balance', fmt: 'money' },
  { key: 'assets', label: 'Total assets', section: 'balance', fmt: 'money', strong: true },
  { key: 'currentLiabilities', label: 'Current liabilities', section: 'balance', fmt: 'money' },
  { key: 'totalDebt', label: 'Total debt', section: 'balance', fmt: 'money', note: 'Borrowings only. Blank when the company pays interest but describes its debt with captions this app cannot read.' },
  { key: 'operatingLeases', label: 'Operating lease liabilities', section: 'balance', fmt: 'money', note: 'Shown for reference; not counted as debt in the leverage ratios' },
  { key: 'liabilities', label: 'Total liabilities', section: 'balance', fmt: 'money', strong: true },
  { key: 'equity', label: 'Shareholders’ equity', section: 'balance', fmt: 'money', strong: true },
  { key: 'netDebt', label: 'Net debt', section: 'balance', fmt: 'money', note: 'Total debt − cash & short-term investments' },

  { key: 'eps', label: 'EPS (diluted)', section: 'pershare', fmt: 'pershare', strong: true },
  { key: 'fcfPerShare', label: 'Free cash flow / share', section: 'pershare', fmt: 'pershare' },
  { key: 'ownerEarningsPerShare', label: 'Owner earnings / share', section: 'pershare', fmt: 'pershare' },
  { key: 'bookPerShare', label: 'Book value / share', section: 'pershare', fmt: 'pershare' },
  { key: 'dps', label: 'Dividends / share', section: 'pershare', fmt: 'pershare' },
  { key: 'sharesDiluted', label: 'Diluted shares', section: 'pershare', fmt: 'shares' },

  { key: 'revenueGrowth', label: 'Revenue growth', section: 'ratios', fmt: 'pct' },
  { key: 'epsGrowth', label: 'EPS growth', section: 'ratios', fmt: 'pct' },
  { key: 'grossMargin', label: 'Gross margin', section: 'ratios', fmt: 'pct' },
  { key: 'operMargin', label: 'Operating margin', section: 'ratios', fmt: 'pct' },
  { key: 'netMargin', label: 'Net margin', section: 'ratios', fmt: 'pct' },
  { key: 'fcfMargin', label: 'FCF margin', section: 'ratios', fmt: 'pct' },
  { key: 'roe', label: 'Return on equity', section: 'ratios', fmt: 'pct', note: 'Net income / average shareholders’ equity' },
  { key: 'roic', label: 'Return on invested capital', section: 'ratios', fmt: 'pct', note: 'After-tax operating income / average (debt + equity), taxed at the year’s effective rate held within 15–35%. Capped at 100%.' },
  { key: 'roa', label: 'Return on assets', section: 'ratios', fmt: 'pct' },
  { key: 'debtEq', label: 'Debt / equity', section: 'ratios', fmt: 'x' },
  { key: 'netDebtEbitda', label: 'Net debt / EBITDA', section: 'ratios', fmt: 'x' },
  { key: 'interestCoverage', label: 'Interest coverage (EBIT / interest)', section: 'ratios', fmt: 'x' },
  { key: 'currentRatio', label: 'Current ratio', section: 'ratios', fmt: 'x' },
  { key: 'payout', label: 'Dividend payout ratio', section: 'ratios', fmt: 'pct' },
  { key: 'capexToCfo', label: 'Capex / operating cash flow', section: 'ratios', fmt: 'pct' },
];
