/** Column registry for the screener table and the stock snapshot. */
export type Fmt = 'text' | 'price' | 'pct' | 'pct1' | 'x' | 'x1' | 'num' | 'int' | 'cap' | 'bigmoney' | 'vol' | 'date' | 'signedPct' | 'recom' | 'bool' | 'list';

export interface ColumnDef {
  key: string;
  label: string;
  title?: string;
  fmt: Fmt;
  /** Colour the value by sign (gains green, losses red). */
  signed?: boolean;
  align?: 'left' | 'right';
}

const c = (key: string, label: string, fmt: Fmt, extra: Partial<ColumnDef> = {}): ColumnDef => ({ key, label, fmt, align: fmt === 'text' || fmt === 'list' ? 'left' : 'right', ...extra });

export const COLUMNS: ColumnDef[] = [
  c('symbol', 'Ticker', 'text'),
  c('name', 'Company', 'text'),
  c('sector', 'Sector', 'text'),
  c('industry', 'Industry', 'text'),
  c('country', 'Country', 'text'),
  c('exchange', 'Exchange', 'text'),
  c('indexes', 'Index', 'list'),
  c('marketCap', 'Market Cap', 'cap'),
  c('price', 'Price', 'price'),
  c('change', 'Change', 'signedPct', { signed: true }),
  c('volume', 'Volume', 'vol'),
  c('pe', 'P/E', 'x', { title: 'Price to trailing twelve-month earnings' }),
  c('fpe', 'Fwd P/E', 'x', { title: 'Price to the current fiscal year consensus EPS estimate' }),
  c('peg', 'PEG', 'x'),
  c('ps', 'P/S', 'x'),
  c('pb', 'P/B', 'x'),
  c('pc', 'P/C', 'x', { title: 'Price to cash and short-term investments' }),
  c('pfcf', 'P/FCF', 'x', { title: 'Price to free cash flow (latest fiscal year)' }),
  c('evEbitda', 'EV/EBITDA', 'x'),
  c('evSales', 'EV/Sales', 'x'),
  c('eps', 'EPS (ttm)', 'num'),
  c('epsGrowthThisYear', 'EPS this Y', 'pct', { signed: true }),
  c('epsGrowthNextYear', 'EPS next Y', 'pct', { signed: true }),
  c('epsGrowthQoq', 'EPS Q/Q', 'pct', { signed: true, title: 'Latest quarter vs the same quarter a year earlier' }),
  c('epsGrowthTtm', 'EPS TTM', 'pct', { signed: true }),
  c('epsGrowth3y', 'EPS past 3Y', 'pct', { signed: true }),
  c('epsGrowth5y', 'EPS past 5Y', 'pct', { signed: true }),
  c('salesGrowthQoq', 'Sales Q/Q', 'pct', { signed: true }),
  c('salesGrowthTtm', 'Sales TTM', 'pct', { signed: true }),
  c('salesGrowth3y', 'Sales past 3Y', 'pct', { signed: true }),
  c('salesGrowth5y', 'Sales past 5Y', 'pct', { signed: true }),
  c('revenue', 'Sales', 'bigmoney'),
  c('netIncome', 'Income', 'bigmoney'),
  c('fcf', 'FCF', 'bigmoney'),
  c('dividend', 'Dividend', 'num'),
  c('dividendYield', 'Dividend %', 'pct'),
  c('payout', 'Payout', 'pct'),
  c('dividendGrowth', 'Div. growth', 'pct', { signed: true }),
  c('roa', 'ROA', 'pct', { signed: true }),
  c('roe', 'ROE', 'pct', { signed: true }),
  c('roic', 'ROIC', 'pct', { signed: true }),
  c('currentRatio', 'Curr R', 'x'),
  c('quickRatio', 'Quick R', 'x'),
  c('ltDebtEq', 'LTDebt/Eq', 'x'),
  c('debtEq', 'Debt/Eq', 'x'),
  c('grossMargin', 'Gross M', 'pct', { signed: true }),
  c('operMargin', 'Oper M', 'pct', { signed: true }),
  c('netMargin', 'Profit M', 'pct', { signed: true }),
  c('sharesOut', 'Outstanding', 'vol'),
  c('float', 'Float', 'vol'),
  c('insiderOwn', 'Insider Own', 'pct'),
  c('insiderTrans', 'Insider Trans', 'pct', { signed: true }),
  c('instOwn', 'Inst Own', 'pct'),
  c('instTrans', 'Inst Trans', 'pct', { signed: true }),
  c('shortFloat', 'Short Float', 'pct'),
  c('shortRatio', 'Short Ratio', 'x'),
  c('avgVolume', 'Avg Volume', 'vol'),
  c('relVolume', 'Rel Volume', 'x'),
  c('perfWeek', 'Perf Week', 'pct', { signed: true }),
  c('perfMonth', 'Perf Month', 'pct', { signed: true }),
  c('perfQuarter', 'Perf Quart', 'pct', { signed: true }),
  c('perfHalf', 'Perf Half', 'pct', { signed: true }),
  c('perfYear', 'Perf Year', 'pct', { signed: true }),
  c('perfYtd', 'Perf YTD', 'pct', { signed: true }),
  c('volatilityWeek', 'Volatility W', 'pct'),
  c('volatilityMonth', 'Volatility M', 'pct'),
  c('recom', 'Recom', 'recom'),
  c('targetPrice', 'Target Price', 'price'),
  c('beta', 'Beta', 'x'),
  c('atr', 'ATR', 'x'),
  c('sma20', 'SMA20', 'pct', { signed: true }),
  c('sma50', 'SMA50', 'pct', { signed: true }),
  c('sma200', 'SMA200', 'pct', { signed: true }),
  c('high52w', '52W High', 'pct', { signed: true }),
  c('low52w', '52W Low', 'pct', { signed: true }),
  c('rsi', 'RSI', 'x1'),
  c('changeFromOpen', 'from Open', 'pct', { signed: true }),
  c('gap', 'Gap', 'pct', { signed: true }),
  c('pattern', 'Pattern', 'text'),
  c('candle', 'Candle', 'text'),
  c('earningsDate', 'Earnings', 'date'),
  c('ipoYear', 'IPO Year', 'int'),
  c('optionable', 'Optionable', 'bool'),
];

export const COLUMN_BY_KEY = new Map(COLUMNS.map((col) => [col.key, col]));

export const VIEWS: Record<string, { label: string; columns: string[] }> = {
  overview: { label: 'Overview', columns: ['symbol', 'name', 'sector', 'industry', 'country', 'marketCap', 'pe', 'price', 'change', 'volume'] },
  valuation: { label: 'Valuation', columns: ['symbol', 'marketCap', 'pe', 'fpe', 'peg', 'ps', 'pb', 'pc', 'pfcf', 'evEbitda', 'epsGrowthQoq', 'epsGrowth5y', 'salesGrowth5y', 'price', 'change', 'volume'] },
  financial: { label: 'Financial', columns: ['symbol', 'marketCap', 'dividendYield', 'roa', 'roe', 'roic', 'currentRatio', 'quickRatio', 'ltDebtEq', 'debtEq', 'grossMargin', 'operMargin', 'netMargin', 'earningsDate', 'price', 'change', 'volume'] },
  ownership: { label: 'Ownership', columns: ['symbol', 'marketCap', 'sharesOut', 'float', 'insiderOwn', 'insiderTrans', 'instOwn', 'instTrans', 'shortFloat', 'shortRatio', 'avgVolume', 'price', 'change', 'volume'] },
  performance: { label: 'Performance', columns: ['symbol', 'perfWeek', 'perfMonth', 'perfQuarter', 'perfHalf', 'perfYear', 'perfYtd', 'volatilityWeek', 'volatilityMonth', 'recom', 'avgVolume', 'relVolume', 'price', 'change', 'volume'] },
  technical: { label: 'Technical', columns: ['symbol', 'beta', 'atr', 'sma20', 'sma50', 'sma200', 'high52w', 'low52w', 'rsi', 'pattern', 'candle', 'price', 'change', 'changeFromOpen', 'gap', 'volume'] },
};

export const DEFAULT_CUSTOM = ['symbol', 'name', 'sector', 'marketCap', 'pe', 'roe', 'debtEq', 'salesGrowth5y', 'dividendYield', 'perfYear', 'price', 'change'];
