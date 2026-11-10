/**
 * Screener filter definitions, shared by the server (which evaluates them) and
 * the client (which renders them). The layout mirrors Finviz: Descriptive,
 * Fundamental and Technical tabs, each filter a dropdown of presets plus an
 * optional custom range.
 */

export type Cond =
  | { op: 'lt' | 'le' | 'gt' | 'ge' | 'eq' | 'ne'; field: string; value: number | string | boolean }
  | { op: 'between'; field: string; min: number; max: number }
  | { op: 'in'; field: string; values: string[] }
  | { op: 'has'; field: string; value: string }
  | { op: 'null' | 'notnull'; field: string }
  | { op: 'startsWith'; field: string; value: string }
  | { op: 'cmp'; a: string; cmp: 'lt' | 'gt'; b: string; mult?: number }
  | { op: 'date'; field: string; fromDays?: number; toDays?: number }
  | { op: 'and' | 'or'; conds: Cond[] };

export interface FilterOption {
  v: string;
  label: string;
  cond: Cond;
}

export type FilterTab = 'descriptive' | 'fundamental' | 'technical';

export interface FilterDef {
  id: string;
  label: string;
  tab: FilterTab;
  options: FilterOption[];
  /** Options are filled in at runtime from the data (sectors, industries, countries). */
  dynamic?: 'sector' | 'industry' | 'country';
  /** Allows "min/max" entry. scale converts what the user types into the stored unit. */
  custom?: { field: string; scale: number; unit: string };
  help?: string;
  /** Depends on the slow analyst/ownership crawl, so coverage grows over time. */
  enriched?: boolean;
}

const pctLabel = (n: number) => `${n > 0 ? '+' : ''}${n}%`;
const opt = (v: string, label: string, cond: Cond): FilterOption => ({ v, label, cond });
const under = (field: string, vals: number[], fmt: (n: number) => string, scale = 1): FilterOption[] => vals.map((n) => opt(`u${n}`, `Under ${fmt(n)}`, { op: 'lt', field, value: n * scale }));
const over = (field: string, vals: number[], fmt: (n: number) => string, scale = 1): FilterOption[] => vals.map((n) => opt(`o${n}`, `Over ${fmt(n)}`, { op: 'gt', field, value: n * scale }));
const range = (field: string, pairs: [number, number][], fmt: (n: number) => string, scale = 1): FilterOption[] => pairs.map(([a, b]) => opt(`${a}to${b}`, `${fmt(a)} to ${fmt(b)}`, { op: 'between', field, min: a * scale, max: b * scale }));
const x = (n: number) => String(n);
const pct = (n: number) => `${n}%`;
const usd = (n: number) => `$${n}`;
const vol = (n: number) => (n >= 1000 ? `${n / 1000}M` : `${n}K`);
const shares = (n: number) => `${n}M`;

function valuation(id: string, label: string, low: number, high: number, steps: number[], extra: FilterOption[] = [], enriched = false): FilterDef {
  return {
    id,
    label,
    tab: 'fundamental',
    enriched,
    custom: { field: id, scale: 1, unit: 'x' },
    options: [opt('low', `Low (<${low})`, { op: 'lt', field: id, value: low }), ...extra, opt('high', `High (>${high})`, { op: 'gt', field: id, value: high }), ...under(id, steps, x), ...over(id, steps, x)],
  };
}

function growthFilter(id: string, label: string, enriched = false): FilterDef {
  const steps = [5, 10, 15, 20, 25, 30];
  return {
    id,
    label,
    tab: 'fundamental',
    enriched,
    custom: { field: id, scale: 0.01, unit: '%' },
    options: [
      opt('neg', 'Negative (<0%)', { op: 'lt', field: id, value: 0 }),
      opt('pos', 'Positive (>0%)', { op: 'gt', field: id, value: 0 }),
      opt('poslow', 'Positive Low (0-10%)', { op: 'between', field: id, min: 0, max: 0.1 }),
      opt('high', 'High (>25%)', { op: 'gt', field: id, value: 0.25 }),
      ...under(id, steps, pct, 0.01),
      ...over(id, steps, pct, 0.01),
    ],
  };
}

function returnFilter(id: string, label: string, veryPos: number): FilterDef {
  const neg = [-50, -45, -40, -35, -30, -25, -20, -15, -10, -5];
  const pos = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
  return {
    id,
    label,
    tab: 'fundamental',
    custom: { field: id, scale: 0.01, unit: '%' },
    options: [
      opt('pos', 'Positive (>0%)', { op: 'gt', field: id, value: 0 }),
      opt('neg', 'Negative (<0%)', { op: 'lt', field: id, value: 0 }),
      opt('verypos', `Very Positive (>${veryPos}%)`, { op: 'gt', field: id, value: veryPos / 100 }),
      opt('veryneg', 'Very Negative (<-15%)', { op: 'lt', field: id, value: -0.15 }),
      ...neg.map((n) => opt(`u${n}`, `Under ${n}%`, { op: 'lt', field: id, value: n / 100 })),
      ...pos.map((n) => opt(`o${n}`, `Over +${n}%`, { op: 'gt', field: id, value: n / 100 })),
    ],
  };
}

function marginFilter(id: string, label: string, high: number): FilterDef {
  const steps = [90, 80, 70, 60, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 0, -10, -20, -30, -50, -70, -100];
  return {
    id,
    label,
    tab: 'fundamental',
    custom: { field: id, scale: 0.01, unit: '%' },
    options: [
      opt('pos', 'Positive (>0%)', { op: 'gt', field: id, value: 0 }),
      opt('neg', 'Negative (<0%)', { op: 'lt', field: id, value: 0 }),
      opt('veryneg', 'Very Negative (<-20%)', { op: 'lt', field: id, value: -0.2 }),
      opt('high', `High (>${high}%)`, { op: 'gt', field: id, value: high / 100 }),
      ...steps.map((n) => opt(`u${n}`, `Under ${n}%`, { op: 'lt', field: id, value: n / 100 })),
      ...[...steps].reverse().filter((n) => n < 90 || n === 90).map((n) => opt(`o${n}`, `Over ${n}%`, { op: 'gt', field: id, value: n / 100 })),
    ],
  };
}

function ratioFilter(id: string, label: string, lowAt: number, highAt: number, unders: number[], overs: number[]): FilterDef {
  return {
    id,
    label,
    tab: 'fundamental',
    custom: { field: id, scale: 1, unit: 'x' },
    options: [opt('high', `High (>${highAt})`, { op: 'gt', field: id, value: highAt }), opt('low', `Low (<${lowAt})`, { op: 'lt', field: id, value: lowAt }), ...under(id, unders, x), ...over(id, overs, x)],
  };
}

function ownershipFilter(id: string, label: string, enriched: boolean, help?: string): FilterDef {
  const steps = [10, 20, 30, 40, 50, 60, 70, 80, 90];
  return {
    id,
    label,
    tab: 'fundamental',
    enriched,
    help,
    custom: { field: id, scale: 0.01, unit: '%' },
    options: [
      opt('low', 'Low (<5%)', { op: 'lt', field: id, value: 0.05 }),
      opt('high', id === 'instOwn' ? 'High (>90%)' : 'High (>30%)', { op: 'gt', field: id, value: id === 'instOwn' ? 0.9 : 0.3 }),
      ...(id === 'insiderOwn' ? [opt('veryhigh', 'Very High (>50%)', { op: 'gt', field: id, value: 0.5 } as Cond)] : []),
      ...[...steps].reverse().map((n) => opt(`u${n}`, `Under ${n}%`, { op: 'lt', field: id, value: n / 100 })),
      ...steps.map((n) => opt(`o${n}`, `Over ${n}%`, { op: 'gt', field: id, value: n / 100 })),
    ],
  };
}

function perfOptions(): FilterOption[] {
  const out: FilterOption[] = [];
  const add = (prefix: string, label: string, field: string, downs: number[], ups: number[]) => {
    for (const d of downs) out.push(opt(`${prefix}${d}`, `${label} ${d}%`, { op: 'lt', field, value: d / 100 }));
    out.push(opt(`${prefix}down`, `${label} Down`, { op: 'lt', field, value: 0 }));
    out.push(opt(`${prefix}up`, `${label} Up`, { op: 'gt', field, value: 0 }));
    for (const u of ups) out.push(opt(`${prefix}+${u}`, `${label} +${u}%`, { op: 'gt', field, value: u / 100 }));
  };
  add('d', 'Today', 'change', [-15, -10, -5], [5, 10, 15]);
  add('w', 'Week', 'perfWeek', [-30, -20, -10], [10, 20, 30]);
  add('m', 'Month', 'perfMonth', [-50, -30, -20, -10], [10, 20, 30, 50]);
  add('q', 'Quarter', 'perfQuarter', [-50, -30, -20, -10], [10, 20, 30, 50]);
  add('h', 'Half', 'perfHalf', [-75, -50, -30, -20, -10], [10, 20, 30, 50, 100]);
  add('y', 'Year', 'perfYear', [-75, -50, -30, -20, -10], [10, 20, 30, 50, 100, 200, 300, 500]);
  add('ytd', 'YTD', 'perfYtd', [-75, -50, -30, -20, -10, -5], [5, 10, 20, 30, 50, 100]);
  return out;
}

function smaFilter(n: 20 | 50 | 200): FilterDef {
  const field = `sma${n}`;
  const others = ([20, 50, 200] as const).filter((k) => k !== n);
  const steps = [10, 20, 30, 40, 50];
  return {
    id: field,
    label: `${n}-Day Simple Moving Average`,
    tab: 'technical',
    custom: { field, scale: 0.01, unit: '%' },
    options: [
      opt('pb', `Price below SMA${n}`, { op: 'lt', field, value: 0 }),
      ...steps.map((s) => opt(`pb${s}`, `Price ${s}% below SMA${n}`, { op: 'lt', field, value: -s / 100 })),
      opt('pa', `Price above SMA${n}`, { op: 'gt', field, value: 0 }),
      ...steps.map((s) => opt(`pa${s}`, `Price ${s}% above SMA${n}`, { op: 'gt', field, value: s / 100 })),
      ...others.flatMap((k) => [
        opt(`sa${k}`, `SMA${n} above SMA${k}`, { op: 'cmp', a: `sma${n}v`, cmp: 'gt', b: `sma${k}v` } as Cond),
        opt(`sb${k}`, `SMA${n} below SMA${k}`, { op: 'cmp', a: `sma${n}v`, cmp: 'lt', b: `sma${k}v` } as Cond),
      ]),
    ],
  };
}

function highLowFilter(id: string, label: string, hi: string, lo: string, wide: boolean): FilterDef {
  const below = wide ? [5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90] : [5, 10, 15, 20, 30, 40, 50];
  const above = wide ? [5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 150, 200, 300, 500] : [5, 10, 15, 20, 30, 40, 50];
  return {
    id,
    label,
    tab: 'technical',
    options: [
      opt('nh', 'New High', { op: 'ge', field: hi, value: -0.0005 }),
      opt('nl', 'New Low', { op: 'le', field: lo, value: 0.0005 }),
      ...below.map((n) => opt(`b${n}h`, `${n}% or more below High`, { op: 'le', field: hi, value: -n / 100 })),
      ...[3, 5, 10].map((n) => opt(`b0to${n}h`, `0-${n}% below High`, { op: 'ge', field: hi, value: -n / 100 })),
      ...above.map((n) => opt(`a${n}l`, `${n}% or more above Low`, { op: 'ge', field: lo, value: n / 100 })),
      ...[3, 5, 10].map((n) => opt(`a0to${n}l`, `0-${n}% above Low`, { op: 'le', field: lo, value: n / 100 })),
    ],
  };
}

function changeFilter(id: string, label: string, field: string): FilterDef {
  const steps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20];
  return {
    id,
    label,
    tab: 'technical',
    custom: { field, scale: 0.01, unit: '%' },
    options: [
      opt('u', 'Up', { op: 'gt', field, value: 0 }),
      ...steps.map((n) => opt(`u${n}`, `Up ${n}%`, { op: 'gt', field, value: n / 100 })),
      opt('d', 'Down', { op: 'lt', field, value: 0 }),
      ...steps.map((n) => opt(`d${n}`, `Down ${n}%`, { op: 'lt', field, value: -n / 100 })),
    ],
  };
}

const PATTERNS = ['Horizontal S/R', 'Trendline Resistance', 'Trendline Support', 'Wedge Up', 'Wedge Down', 'Wedge', 'Triangle Ascending', 'Triangle Descending', 'Channel Up', 'Channel Down', 'Double Top', 'Double Bottom', 'Multiple Top', 'Multiple Bottom', 'Head & Shoulders', 'Head & Shoulders Inverse'];
const STRONG = ['Wedge Up', 'Wedge Down', 'Wedge', 'Triangle Ascending', 'Triangle Descending', 'Channel Up', 'Channel Down'];
const CANDLES = ['Long Lower Shadow', 'Long Upper Shadow', 'Hammer', 'Inverted Hammer', 'Spinning Top White', 'Spinning Top Black', 'Doji', 'Dragonfly Doji', 'Gravestone Doji', 'Marubozu White', 'Marubozu Black'];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

const capB = (n: number) => n * 1e9;
const priceSteps = [1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 40, 50];
const volSteps = [50, 100, 500, 750, 1000];
const shareSteps = [1, 5, 10, 20, 50, 100];

export const FILTERS: FilterDef[] = [
  // ------------------------------------------------------------ Descriptive
  {
    id: 'exchange', label: 'Exchange', tab: 'descriptive',
    options: ['AMEX', 'NASDAQ', 'NYSE'].map((e) => opt(e.toLowerCase(), e, { op: 'eq', field: 'exchange', value: e })),
  },
  {
    id: 'index', label: 'Index', tab: 'descriptive', help: 'Russell 2000 membership is estimated: US companies ranked 1,001-3,000 by market value.',
    options: [
      opt('sp500', 'S&P 500', { op: 'has', field: 'indexes', value: 'sp500' }),
      opt('ndx', 'NASDAQ 100', { op: 'has', field: 'indexes', value: 'ndx' }),
      opt('djia', 'DJIA', { op: 'has', field: 'indexes', value: 'djia' }),
      opt('r2000', 'Russell 2000 (est.)', { op: 'has', field: 'indexes', value: 'r2000' }),
    ],
  },
  { id: 'sector', label: 'Sector', tab: 'descriptive', dynamic: 'sector', options: [] },
  { id: 'industry', label: 'Industry', tab: 'descriptive', dynamic: 'industry', options: [] },
  {
    id: 'country', label: 'Country', tab: 'descriptive', dynamic: 'country',
    options: [opt('usa', 'USA', { op: 'eq', field: 'country', value: 'United States' }), opt('foreign', 'Foreign (ex-USA)', { op: 'and', conds: [{ op: 'ne', field: 'country', value: 'United States' }, { op: 'ne', field: 'country', value: '' }] })],
  },
  {
    id: 'cap', label: 'Market Cap.', tab: 'descriptive', custom: { field: 'marketCap', scale: 1e9, unit: '$B' },
    options: [
      opt('mega', 'Mega ($200bln and more)', { op: 'ge', field: 'marketCap', value: capB(200) }),
      opt('large', 'Large ($10bln to $200bln)', { op: 'between', field: 'marketCap', min: capB(10), max: capB(200) }),
      opt('mid', 'Mid ($2bln to $10bln)', { op: 'between', field: 'marketCap', min: capB(2), max: capB(10) }),
      opt('small', 'Small ($300mln to $2bln)', { op: 'between', field: 'marketCap', min: capB(0.3), max: capB(2) }),
      opt('micro', 'Micro ($50mln to $300mln)', { op: 'between', field: 'marketCap', min: capB(0.05), max: capB(0.3) }),
      opt('nano', 'Nano (under $50mln)', { op: 'lt', field: 'marketCap', value: capB(0.05) }),
      opt('largeover', '+Large (over $10bln)', { op: 'ge', field: 'marketCap', value: capB(10) }),
      opt('midover', '+Mid (over $2bln)', { op: 'ge', field: 'marketCap', value: capB(2) }),
      opt('smallover', '+Small (over $300mln)', { op: 'ge', field: 'marketCap', value: capB(0.3) }),
      opt('microover', '+Micro (over $50mln)', { op: 'ge', field: 'marketCap', value: capB(0.05) }),
      opt('largeunder', '-Large (under $200bln)', { op: 'lt', field: 'marketCap', value: capB(200) }),
      opt('midunder', '-Mid (under $10bln)', { op: 'lt', field: 'marketCap', value: capB(10) }),
      opt('smallunder', '-Small (under $2bln)', { op: 'lt', field: 'marketCap', value: capB(2) }),
      opt('microunder', '-Micro (under $300mln)', { op: 'lt', field: 'marketCap', value: capB(0.3) }),
    ],
  },
  {
    id: 'dividendYield', label: 'Dividend Yield', tab: 'descriptive', custom: { field: 'dividendYield', scale: 0.01, unit: '%' },
    options: [
      opt('none', 'None (0%)', { op: 'or', conds: [{ op: 'null', field: 'dividendYield' }, { op: 'le', field: 'dividendYield', value: 0 }] }),
      opt('pos', 'Positive (>0%)', { op: 'gt', field: 'dividendYield', value: 0 }),
      opt('high', 'High (>5%)', { op: 'gt', field: 'dividendYield', value: 0.05 }),
      opt('veryhigh', 'Very High (>10%)', { op: 'gt', field: 'dividendYield', value: 0.1 }),
      ...over('dividendYield', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], pct, 0.01),
    ],
  },
  {
    id: 'shortFloat', label: 'Short Float', tab: 'descriptive', enriched: true, custom: { field: 'shortFloat', scale: 0.01, unit: '%' },
    options: [
      opt('low', 'Low (<5%)', { op: 'lt', field: 'shortFloat', value: 0.05 }),
      opt('high', 'High (>20%)', { op: 'gt', field: 'shortFloat', value: 0.2 }),
      ...under('shortFloat', [5, 10, 15, 20, 25, 30], pct, 0.01),
      ...over('shortFloat', [5, 10, 15, 20, 25, 30], pct, 0.01),
    ],
  },
  {
    id: 'recom', label: 'Analyst Recom.', tab: 'descriptive', enriched: true, help: 'Mean of analyst ratings on a 1 (strong buy) to 5 (strong sell) scale.',
    options: [
      opt('strongbuy', 'Strong Buy (1)', { op: 'le', field: 'recom', value: 1.5 }),
      opt('buybetter', 'Buy or better', { op: 'le', field: 'recom', value: 2.5 }),
      opt('buy', 'Buy', { op: 'between', field: 'recom', min: 1.5, max: 2.5 }),
      opt('holdbetter', 'Hold or better', { op: 'le', field: 'recom', value: 3.5 }),
      opt('hold', 'Hold', { op: 'between', field: 'recom', min: 2.5, max: 3.5 }),
      opt('holdworse', 'Hold or worse', { op: 'ge', field: 'recom', value: 2.5 }),
      opt('sell', 'Sell', { op: 'between', field: 'recom', min: 3.5, max: 4.5 }),
      opt('sellworse', 'Sell or worse', { op: 'ge', field: 'recom', value: 3.5 }),
      opt('strongsell', 'Strong Sell (5)', { op: 'ge', field: 'recom', value: 4.5 }),
    ],
  },
  {
    id: 'optionShort', label: 'Option/Short', tab: 'descriptive', help: 'Optionable means listed options trade on the stock (Cboe reports implied volatility for it). This is checked one stock at a time, largest first, so smaller companies fill in over several hours.',
    options: [opt('option', 'Optionable', { op: 'eq', field: 'optionable', value: true }), opt('notoption', 'Not optionable', { op: 'eq', field: 'optionable', value: false })],
  },
  {
    id: 'earningsDate', label: 'Earnings Date', tab: 'descriptive',
    options: [
      opt('today', 'Today', { op: 'date', field: 'earningsDate', fromDays: 0, toDays: 0 }),
      opt('tomorrow', 'Tomorrow', { op: 'date', field: 'earningsDate', fromDays: 1, toDays: 1 }),
      opt('yesterday', 'Yesterday', { op: 'date', field: 'earningsDate', fromDays: -1, toDays: -1 }),
      opt('nextdays5', 'Next 5 Days', { op: 'date', field: 'earningsDate', fromDays: 0, toDays: 5 }),
      opt('prevdays5', 'Previous 5 Days', { op: 'date', field: 'earningsDate', fromDays: -5, toDays: -1 }),
      opt('next2w', 'Next 2 Weeks', { op: 'date', field: 'earningsDate', fromDays: 0, toDays: 14 }),
      opt('nextmonth', 'Next 30 Days', { op: 'date', field: 'earningsDate', fromDays: 0, toDays: 30 }),
    ],
  },
  {
    id: 'avgVolume', label: 'Average Volume', tab: 'descriptive', custom: { field: 'avgVolume', scale: 1000, unit: 'K' },
    options: [...under('avgVolume', volSteps, vol, 1000), ...over('avgVolume', [50, 100, 200, 300, 400, 500, 750, 1000, 2000], vol, 1000), ...range('avgVolume', [[100, 500], [100, 1000], [500, 1000], [500, 10000]], vol, 1000)],
  },
  {
    id: 'relVolume', label: 'Relative Volume', tab: 'descriptive', custom: { field: 'relVolume', scale: 1, unit: 'x' },
    options: [...over('relVolume', [10, 5, 3, 2, 1.5, 1, 0.75, 0.5, 0.25], x), ...under('relVolume', [2, 1.5, 1, 0.75, 0.5, 0.25, 0.1], x)],
  },
  {
    id: 'curVolume', label: 'Current Volume', tab: 'descriptive', custom: { field: 'volume', scale: 1000, unit: 'K' },
    options: [...under('volume', volSteps, vol, 1000), ...over('volume', [0, 50, 100, 200, 300, 400, 500, 750, 1000, 2000, 5000, 10000, 20000], vol, 1000)],
  },
  {
    id: 'price', label: 'Price $', tab: 'descriptive', custom: { field: 'price', scale: 1, unit: '$' },
    options: [...under('price', priceSteps, usd), ...over('price', [...priceSteps, 70, 80, 90, 100], usd), ...range('price', [[1, 5], [1, 10], [1, 20], [5, 10], [5, 20], [5, 50], [10, 20], [10, 50], [20, 50], [50, 100]], usd)],
  },
  {
    id: 'targetPrice', label: 'Target Price', tab: 'descriptive', enriched: true, help: 'Mean analyst price target relative to the current price.',
    options: [
      ...[50, 40, 30, 20, 10, 5].map((n) => opt(`a${n}`, `${n}% Above Price`, { op: 'cmp', a: 'targetPrice', cmp: 'gt', b: 'price', mult: 1 + n / 100 } as Cond)),
      opt('above', 'Above Price', { op: 'cmp', a: 'targetPrice', cmp: 'gt', b: 'price' }),
      opt('below', 'Below Price', { op: 'cmp', a: 'targetPrice', cmp: 'lt', b: 'price' }),
      ...[5, 10, 20, 30, 40, 50].map((n) => opt(`b${n}`, `${n}% Below Price`, { op: 'cmp', a: 'targetPrice', cmp: 'lt', b: 'price', mult: 1 - n / 100 } as Cond)),
    ],
  },
  {
    id: 'ipoDate', label: 'IPO Date', tab: 'descriptive', help: 'Exact listing dates are known for the last two years; older listings use the IPO year.',
    options: [
      opt('prevweek', 'In the last week', { op: 'date', field: 'ipoDate', fromDays: -7, toDays: 0 }),
      opt('prevmonth', 'In the last month', { op: 'date', field: 'ipoDate', fromDays: -31, toDays: 0 }),
      opt('prevquarter', 'In the last quarter', { op: 'date', field: 'ipoDate', fromDays: -92, toDays: 0 }),
      opt('prevyear', 'In the last year', { op: 'date', field: 'ipoDate', fromDays: -366, toDays: 0 }),
      ...[2, 3, 5].map((n) => opt(`prev${n}yrs`, `In the last ${n} years`, { op: 'ge', field: 'ipoYear', value: new Date().getFullYear() - n } as Cond)),
      ...[1, 5, 10, 15, 20, 25].map((n) => opt(`more${n}`, `More than ${n === 1 ? 'a year' : `${n} years`} ago`, { op: 'lt', field: 'ipoYear', value: new Date().getFullYear() - n } as Cond)),
    ],
  },
  {
    id: 'sharesOut', label: 'Shares Outstanding', tab: 'descriptive', custom: { field: 'sharesOut', scale: 1e6, unit: 'M' },
    options: [...under('sharesOut', shareSteps, shares, 1e6), ...over('sharesOut', [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000], shares, 1e6)],
  },
  {
    id: 'float', label: 'Float', tab: 'descriptive', custom: { field: 'float', scale: 1e6, unit: 'M' }, help: 'Estimated from the public (non-affiliate) float each company reports on its annual report cover page.',
    options: [...under('float', shareSteps, shares, 1e6), ...over('float', [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000], shares, 1e6)],
  },

  // ------------------------------------------------------------ Fundamental
  valuation('pe', 'P/E', 15, 50, [5, 10, 15, 20, 25, 30, 35, 40, 45, 50], [opt('profitable', 'Profitable (>0)', { op: 'gt', field: 'pe', value: 0 })]),
  valuation('fpe', 'Forward P/E', 15, 50, [5, 10, 15, 20, 25, 30, 35, 40, 45, 50], [opt('profitable', 'Profitable (>0)', { op: 'gt', field: 'fpe', value: 0 })], true),
  { ...valuation('peg', 'PEG', 1, 2, [1, 2, 3], [], true), help: 'P/E divided by expected EPS growth (average of this and next fiscal year estimates).' },
  valuation('ps', 'P/S', 1, 10, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
  valuation('pb', 'P/B', 1, 5, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
  valuation('pc', 'Price/Cash', 3, 50, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50]),
  valuation('pfcf', 'Price/Free Cash Flow', 15, 50, [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100]),
  valuation('evEbitda', 'EV/EBITDA', 15, 50, [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]),
  valuation('evSales', 'EV/Sales', 1, 10, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
  {
    id: 'dividendGrowth', label: 'Dividend Growth', tab: 'fundamental', custom: { field: 'dividendGrowth', scale: 0.01, unit: '%' }, help: 'Change in dividends per share, latest fiscal year vs the one before.',
    options: [opt('pos', 'Positive (>0%)', { op: 'gt', field: 'dividendGrowth', value: 0 }), ...over('dividendGrowth', [5, 10, 15, 20, 25, 30], pct, 0.01), opt('neg', 'Negative (cut)', { op: 'lt', field: 'dividendGrowth', value: 0 })],
  },
  growthFilter('epsGrowthThisYear', 'EPS Growth This Year', true),
  growthFilter('epsGrowthNextYear', 'EPS Growth Next Year', true),
  growthFilter('epsGrowthQoq', 'EPS Growth Qtr Over Qtr'),
  growthFilter('epsGrowthTtm', 'EPS Growth TTM'),
  growthFilter('epsGrowth3y', 'EPS Growth Past 3 Years'),
  growthFilter('epsGrowth5y', 'EPS Growth Past 5 Years'),
  growthFilter('salesGrowthQoq', 'Sales Growth Qtr Over Qtr'),
  growthFilter('salesGrowthTtm', 'Sales Growth TTM'),
  growthFilter('salesGrowth3y', 'Sales Growth Past 3 Years'),
  growthFilter('salesGrowth5y', 'Sales Growth Past 5 Years'),
  returnFilter('roa', 'Return on Assets', 15),
  returnFilter('roe', 'Return on Equity', 30),
  returnFilter('roic', 'Return on Invested Capital', 25),
  ratioFilter('currentRatio', 'Current Ratio', 1, 3, [1, 0.5], [0.5, 1, 1.5, 2, 3, 4, 5, 10]),
  ratioFilter('quickRatio', 'Quick Ratio', 0.5, 3, [1, 0.5], [0.5, 1, 1.5, 2, 3, 4, 5, 10]),
  ratioFilter('ltDebtEq', 'LT Debt/Equity', 0.1, 0.5, [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1], [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]),
  ratioFilter('debtEq', 'Debt/Equity', 0.1, 0.5, [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1], [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]),
  marginFilter('grossMargin', 'Gross Margin', 50),
  marginFilter('operMargin', 'Operating Margin', 25),
  marginFilter('netMargin', 'Net Profit Margin', 20),
  {
    id: 'payout', label: 'Payout Ratio', tab: 'fundamental', custom: { field: 'payout', scale: 0.01, unit: '%' },
    options: [
      opt('none', 'None (0%)', { op: 'or', conds: [{ op: 'null', field: 'payout' }, { op: 'le', field: 'payout', value: 0 }] }),
      opt('pos', 'Positive (>0%)', { op: 'gt', field: 'payout', value: 0 }),
      opt('low', 'Low (<20%)', { op: 'between', field: 'payout', min: 0.0001, max: 0.2 }),
      opt('high', 'High (>50%)', { op: 'gt', field: 'payout', value: 0.5 }),
      ...over('payout', [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], pct, 0.01),
      ...under('payout', [10, 20, 30, 40, 50, 60, 70, 80, 90, 100], pct, 0.01),
    ],
  },
  ownershipFilter('insiderOwn', 'Insider Ownership', false, 'Estimated as 1 minus public float / shares outstanding, so it also counts other affiliates.'),
  {
    id: 'insiderTrans', label: 'Insider Transactions', tab: 'fundamental', enriched: true, help: 'Net shares bought minus sold by insiders over 12 months, as a share of shares outstanding.',
    options: [
      opt('pos', 'Net buying', { op: 'gt', field: 'insiderTrans', value: 0 }),
      opt('verypos', 'Heavy buying (>0.5% of shares)', { op: 'gt', field: 'insiderTrans', value: 0.005 }),
      opt('neg', 'Net selling', { op: 'lt', field: 'insiderTrans', value: 0 }),
      opt('veryneg', 'Heavy selling (>0.5% of shares)', { op: 'lt', field: 'insiderTrans', value: -0.005 }),
      opt('none', 'No net activity', { op: 'eq', field: 'insiderTrans', value: 0 }),
    ],
  },
  ownershipFilter('instOwn', 'Institutional Ownership', true),
  {
    id: 'instTrans', label: 'Institutional Transactions', tab: 'fundamental', enriched: true, custom: { field: 'instTrans', scale: 0.01, unit: '%' }, help: 'Shares added minus shares cut by institutions last quarter, relative to all institutional holdings.',
    options: [
      opt('veryneg', 'Very Negative (<-20%)', { op: 'lt', field: 'instTrans', value: -0.2 }),
      opt('neg', 'Negative (<0%)', { op: 'lt', field: 'instTrans', value: 0 }),
      opt('pos', 'Positive (>0%)', { op: 'gt', field: 'instTrans', value: 0 }),
      opt('verypos', 'Very Positive (>20%)', { op: 'gt', field: 'instTrans', value: 0.2 }),
      ...[-50, -40, -30, -20, -10, -5].map((n) => opt(`u${n}`, `Under ${n}%`, { op: 'lt', field: 'instTrans', value: n / 100 } as Cond)),
      ...[5, 10, 20, 30, 40, 50].map((n) => opt(`o${n}`, `Over +${n}%`, { op: 'gt', field: 'instTrans', value: n / 100 } as Cond)),
    ],
  },

  {
    id: 'buffettScore', label: 'Buffett Checklist Score', tab: 'fundamental', custom: { field: 'buffettScore', scale: 0.01, unit: '%' },
    help: 'Share of the points earned on the 14 checklist questions that financial data can answer. Calculated for non-financial companies above about $1.6 billion in market value.',
    options: [
      opt('full', 'Full marks (100%)', { op: 'ge', field: 'buffettScore', value: 0.9999 }),
      ...[90, 85, 80, 70, 60, 50].map((n) => opt(`o${n}`, `${n}% or more`, { op: 'ge', field: 'buffettScore', value: n / 100 } as Cond)),
      opt('u50', 'Under 50%', { op: 'lt', field: 'buffettScore', value: 0.5 }),
    ],
  },
  {
    id: 'buffettGates', label: 'Checklist Gates (data)', tab: 'fundamental',
    help: 'Whether the data answers No to any required gate it can judge: recurring owner cash, conservative leverage, an estimable owner-earnings figure.',
    options: [opt('pass', 'No gate failed', { op: 'eq', field: 'buffettGates', value: 'pass' }), opt('fail', 'A gate failed', { op: 'eq', field: 'buffettGates', value: 'fail' })],
  },
  {
    id: 'valueZone', label: 'Price vs Intrinsic Value', tab: 'fundamental', custom: { field: 'valueDiscount', scale: 0.01, unit: '% below' },
    help: 'Price against the automatic owner-earnings valuation. The buy zone is intrinsic value less a 25% margin of safety.',
    options: [
      opt('buyzone', 'In the buy zone (25%+ below value)', { op: 'cmp', a: 'price', cmp: 'lt', b: 'buyBelow' }),
      opt('below', 'Below intrinsic value', { op: 'gt', field: 'valueDiscount', value: 0 }),
      ...[10, 20, 30, 40, 50].map((n) => opt(`b${n}`, `${n}% or more below value`, { op: 'ge', field: 'valueDiscount', value: n / 100 } as Cond)),
      opt('above', 'Above intrinsic value', { op: 'lt', field: 'valueDiscount', value: 0 }),
      opt('above50', '50% or more above value', { op: 'le', field: 'valueDiscount', value: -0.5 }),
    ],
  },

  // ------------------------------------------------------------ Technical
  { id: 'perf', label: 'Performance', tab: 'technical', options: perfOptions() },
  { id: 'perf2', label: 'Performance 2', tab: 'technical', options: perfOptions() },
  {
    id: 'volatility', label: 'Volatility', tab: 'technical', help: 'Average daily high-low range as a percent of price.',
    options: [
      ...[3, 4, 5, 6, 7, 8, 9, 10, 12, 15].map((n) => opt(`wo${n}`, `Week - Over ${n}%`, { op: 'gt', field: 'volatilityWeek', value: n / 100 } as Cond)),
      ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15].map((n) => opt(`mo${n}`, `Month - Over ${n}%`, { op: 'gt', field: 'volatilityMonth', value: n / 100 } as Cond)),
    ],
  },
  {
    id: 'rsi', label: 'RSI (14)', tab: 'technical', custom: { field: 'rsi', scale: 1, unit: '' },
    options: [
      ...[90, 80, 70, 60].map((n) => opt(`ob${n}`, `Overbought (${n})`, { op: 'gt', field: 'rsi', value: n } as Cond)),
      ...[40, 30, 20, 10].map((n) => opt(`os${n}`, `Oversold (${n})`, { op: 'lt', field: 'rsi', value: n } as Cond)),
      opt('nob60', 'Not Overbought (<60)', { op: 'lt', field: 'rsi', value: 60 }),
      opt('nob50', 'Not Overbought (<50)', { op: 'lt', field: 'rsi', value: 50 }),
      opt('nos50', 'Not Oversold (>50)', { op: 'gt', field: 'rsi', value: 50 }),
      opt('nos40', 'Not Oversold (>40)', { op: 'gt', field: 'rsi', value: 40 }),
    ],
  },
  {
    id: 'gap', label: 'Gap', tab: 'technical', help: 'Open versus the prior close, for the latest completed daily bar.', custom: { field: 'gap', scale: 0.01, unit: '%' },
    options: [
      opt('u', 'Up', { op: 'gt', field: 'gap', value: 0 }),
      ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20].map((n) => opt(`u${n}`, `Up ${n}%`, { op: 'gt', field: 'gap', value: n / 100 } as Cond)),
      opt('d', 'Down', { op: 'lt', field: 'gap', value: 0 }),
      ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20].map((n) => opt(`d${n}`, `Down ${n}%`, { op: 'lt', field: 'gap', value: -n / 100 } as Cond)),
    ],
  },
  smaFilter(20),
  smaFilter(50),
  smaFilter(200),
  changeFilter('change', 'Change', 'change'),
  changeFilter('changeOpen', 'Change from Open', 'changeFromOpen'),
  highLowFilter('highLow20', '20-Day High/Low', 'high20', 'low20', false),
  highLowFilter('highLow50', '50-Day High/Low', 'high50', 'low50', false),
  highLowFilter('highLow52w', '52-Week High/Low', 'high52w', 'low52w', true),
  {
    id: 'pattern', label: 'Pattern', tab: 'technical', help: 'Detected automatically from swing highs and lows over roughly the last six months.',
    options: [
      ...PATTERNS.map((p) => opt(slug(p), p, { op: 'startsWith', field: 'pattern', value: p } as Cond)),
      ...STRONG.map((p) => opt(`${slug(p)}strong`, `${p} (Strong)`, { op: 'eq', field: 'pattern', value: `${p} (Strong)` } as Cond)),
      opt('channel', 'Channel (any)', { op: 'startsWith', field: 'pattern', value: 'Channel' }),
    ],
  },
  { id: 'candle', label: 'Candlestick', tab: 'technical', options: CANDLES.map((c) => opt(slug(c), c, { op: 'eq', field: 'candle', value: c } as Cond)) },
  {
    id: 'beta', label: 'Beta', tab: 'technical', custom: { field: 'beta', scale: 1, unit: '' }, help: 'Against the S&P 500 (SPY), one year of daily returns.',
    options: [...under('beta', [0, 0.5, 1, 1.5, 2], x), ...over('beta', [0, 0.5, 1, 1.5, 2, 2.5, 3, 4], x), ...range('beta', [[0, 0.5], [0, 1], [0.5, 1], [0.5, 1.5], [1, 1.5], [1, 2]], x)],
  },
  {
    id: 'atr', label: 'Average True Range', tab: 'technical', custom: { field: 'atr', scale: 1, unit: '$' },
    options: [...over('atr', [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5], x), ...under('atr', [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5], x)],
  },
];

export const FILTER_BY_ID = new Map(FILTERS.map((f) => [f.id, f]));

/** Preset "signals": a filter plus a sort order. */
export interface SignalDef {
  id: string;
  label: string;
  cond?: Cond;
  sort: string;
  dir: 'asc' | 'desc';
}

export const SIGNALS: SignalDef[] = [
  { id: 'gainers', label: 'Top Gainers', cond: { op: 'gt', field: 'change', value: 0 }, sort: 'change', dir: 'desc' },
  { id: 'losers', label: 'Top Losers', cond: { op: 'lt', field: 'change', value: 0 }, sort: 'change', dir: 'asc' },
  { id: 'newhigh', label: 'New High', cond: { op: 'ge', field: 'high52w', value: -0.0005 }, sort: 'change', dir: 'desc' },
  { id: 'newlow', label: 'New Low', cond: { op: 'le', field: 'low52w', value: 0.0005 }, sort: 'change', dir: 'asc' },
  { id: 'volatile', label: 'Most Volatile', cond: { op: 'notnull', field: 'volatilityWeek' }, sort: 'volatilityWeek', dir: 'desc' },
  { id: 'active', label: 'Most Active', cond: { op: 'gt', field: 'volume', value: 0 }, sort: 'volume', dir: 'desc' },
  { id: 'unusual', label: 'Unusual Volume', cond: { op: 'gt', field: 'relVolume', value: 1.5 }, sort: 'relVolume', dir: 'desc' },
  { id: 'overbought', label: 'Overbought', cond: { op: 'gt', field: 'rsi', value: 70 }, sort: 'rsi', dir: 'desc' },
  { id: 'oversold', label: 'Oversold', cond: { op: 'lt', field: 'rsi', value: 30 }, sort: 'rsi', dir: 'asc' },
  { id: 'earningsbefore', label: 'Earnings Today/Tomorrow', cond: { op: 'date', field: 'earningsDate', fromDays: 0, toDays: 1 }, sort: 'marketCap', dir: 'desc' },
  { id: 'insiderbuying', label: 'Insider Buying', cond: { op: 'gt', field: 'insiderTrans', value: 0 }, sort: 'insiderTrans', dir: 'desc' },
  { id: 'insiderselling', label: 'Insider Selling', cond: { op: 'lt', field: 'insiderTrans', value: 0 }, sort: 'insiderTrans', dir: 'asc' },
];

/** Custom range values are written "r:min:max" with either side optional. */
export function customCond(def: FilterDef, value: string): Cond | null {
  if (!def.custom || !value.startsWith('r:')) return null;
  const [, a, b] = value.split(':');
  const min = a === '' || a == null ? null : Number(a);
  const max = b === '' || b == null ? null : Number(b);
  if ((min != null && !Number.isFinite(min)) || (max != null && !Number.isFinite(max))) return null;
  const conds: Cond[] = [];
  if (min != null) conds.push({ op: 'ge', field: def.custom.field, value: min * def.custom.scale });
  if (max != null) conds.push({ op: 'le', field: def.custom.field, value: max * def.custom.scale });
  return conds.length ? { op: 'and', conds } : null;
}

export function evalCond(row: Record<string, any>, c: Cond, today: string): boolean {
  switch (c.op) {
    case 'and':
      return c.conds.every((k) => evalCond(row, k, today));
    case 'or':
      return c.conds.some((k) => evalCond(row, k, today));
    case 'null':
      return row[c.field] == null;
    case 'notnull':
      return row[c.field] != null;
    case 'has':
      return Array.isArray(row[c.field]) && row[c.field].includes(c.value);
    case 'in':
      return c.values.includes(row[c.field]);
    case 'startsWith':
      return typeof row[c.field] === 'string' && row[c.field].startsWith(c.value);
    case 'eq':
      return row[c.field] === c.value;
    case 'ne':
      return row[c.field] !== c.value;
    case 'cmp': {
      const a = row[c.a];
      const b = row[c.b];
      if (typeof a !== 'number' || typeof b !== 'number') return false;
      const rhs = b * (c.mult ?? 1);
      return c.cmp === 'gt' ? a > rhs : a < rhs;
    }
    case 'date': {
      const d = row[c.field];
      if (typeof d !== 'string' || !d) return false;
      const diff = Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000);
      return (c.fromDays == null || diff >= c.fromDays) && (c.toDays == null || diff <= c.toDays);
    }
    case 'between': {
      const v = row[c.field];
      return typeof v === 'number' && v >= c.min && v <= c.max;
    }
    default: {
      const v = row[c.field];
      if (typeof v !== 'number' || typeof c.value !== 'number') return false;
      if (c.op === 'lt') return v < c.value;
      if (c.op === 'le') return v <= c.value;
      if (c.op === 'gt') return v > c.value;
      return v >= c.value;
    }
  }
}
