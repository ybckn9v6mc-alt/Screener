/**
 * The 34-question "Buffett quality checklist" and its scoring rules, transcribed
 * from the user's Buffett_Investment_Qualification_Checklist workbook
 * (sheets: Checklist, Dashboard, Quant Tests).
 */

export type Pillar = 'Understand' | 'Moat' | 'Management' | 'Financials' | 'Risk' | 'Valuation';
export type Answer = 'Yes' | 'No' | 'Uncertain' | '';

export interface Question {
  id: string;
  pillar: Pillar;
  question: string;
  yesLooksLike: string;
  gate: boolean;
  weight: number;
}

const q = (id: string, pillar: Pillar, question: string, yesLooksLike: string, gate: boolean, weight: number): Question => ({ id, pillar, question, yesLooksLike, gate, weight });

export const QUESTIONS: Question[] = [
  q('u1', 'Understand', 'Can you explain precisely how it makes money?', 'Revenue drivers, customer needs, key costs and unit economics are understandable.', true, 3),
  q('u2', 'Understand', 'Can you reasonably assess it 10 years out?', 'Understand durability and broad business outlook without heroic predictions.', true, 3),
  q('u3', 'Understand', 'Is the core industry reasonably stable?', 'Economics are not routinely wiped out by disruptive product change.', false, 2),
  q('u4', 'Understand', 'Are accounting and business model transparent?', 'Segment reporting, accounting policy and economics are comprehensible.', false, 2),
  q('u5', 'Understand', 'Do you know customers and demand drivers?', 'Can explain who buys, why they buy, and what might change demand.', false, 1),
  q('m1', 'Moat', 'Is there a durable competitive advantage?', 'Clear, lasting brand, low-cost position, network, scale or switching costs.', true, 3),
  q('m2', 'Moat', 'Does it have demonstrable pricing power?', 'Maintains or raises prices without destroying long-run volume/returns.', false, 3),
  q('m3', 'Moat', 'Is a high return on capital sustainable?', 'ROIC is strong relative to the cost of capital and durable through cycles.', false, 3),
  q('m4', 'Moat', 'Is the advantage observable in customer behavior?', 'Brand preference, retention, share stability or hard-to-replace service.', false, 2),
  q('m5', 'Moat', 'Are competitors unlikely to erode returns?', 'Competitors face structural barriers, not just temporary product leads.', false, 2),
  q('m6', 'Moat', 'Does the company retain/expand valuable customers?', 'Retention, repeat usage, penetration or relevant industry indicators support moat.', false, 1),
  q('g1', 'Management', 'Are leaders honest and trustworthy?', 'Candid disclosures; clean history; no value-destructive or self-serving conduct.', true, 3),
  q('g2', 'Management', 'Is capital allocation rational?', 'Management invests, buys back shares, acquires or distributes cash sensibly.', false, 3),
  q('g3', 'Management', 'Are buybacks made at attractive values?', 'Share repurchases create per-share value, not just offset large dilution.', false, 2),
  q('g4', 'Management', 'Is compensation aligned with owners?', 'Pay tied to lasting economic results rather than manipulated headline targets.', false, 1),
  q('g5', 'Management', 'Are shareholder letters forthright?', 'Explains mistakes, challenges, cash flows and tradeoffs clearly.', false, 1),
  q('f1', 'Financials', 'Does the business earn attractive returns on capital?', 'Sustained healthy ROIC (see Quant Tests; 12% is a screening illustration).', false, 3),
  q('f2', 'Financials', 'Does it generate recurring owner cash?', 'Mostly positive normalized owner earnings / FCF over a full cycle.', true, 3),
  q('f3', 'Financials', 'Do reported profits turn into cash?', 'Operating cash flow and FCF broadly substantiate net income.', false, 2),
  q('f4', 'Financials', 'Is leverage conservatively managed?', 'Can service and refinance debt in a serious downturn.', true, 3),
  q('f5', 'Financials', 'Are underlying profits resilient?', 'Reasonably steady cycle-normalized margins and earnings power.', false, 2),
  q('f6', 'Financials', 'Does it avoid consuming excessive maintenance capital?', 'Owner earnings remain attractive after required upkeep and working capital.', false, 2),
  q('f7', 'Financials', 'Is per-share economics improving without dilution?', 'Diluted share count stable/falling or growth more than offsets dilution.', false, 2),
  q('f8', 'Financials', 'Are margins sensible and relatively durable?', 'Consistent economics vs peers, with no unexplained deterioration.', false, 1),
  q('f9', 'Financials', 'Are liquidity and maturities manageable?', 'Adequate liquidity and no near-term debt wall threatening equity holders.', false, 2),
  q('r1', 'Risk', 'Can the business withstand major foreseeable risks?', 'Regulation, litigation and existential risks are tolerable.', false, 3),
  q('r2', 'Risk', 'Is cyclicality manageable under stress?', 'Survives downturns without permanent capital loss or dilutive rescue.', false, 2),
  q('r3', 'Risk', 'Are financial reporting and governance clean?', 'No material unresolved audit, fraud, related-party or cash flow red flags.', true, 3),
  q('r4', 'Risk', 'Is customer/product concentration acceptable?', 'No single failure point with outsized risk to profits/cash generation.', false, 1),
  q('r5', 'Risk', 'Is long-term displacement risk acceptably low?', 'Technology / business model shifts do not obviously erase the moat.', false, 2),
  q('v1', 'Valuation', 'Can you conservatively estimate owner earnings?', 'Normalize maintenance capex, working capital and cyclical variations.', true, 3),
  q('v2', 'Valuation', 'Is estimated intrinsic value based on sober inputs?', 'Cash flows and discount rates reflect risks; no heroic terminal assumptions.', false, 3),
  q('v3', 'Valuation', 'Does price meet your margin-of-safety hurdle?', 'Market price at or below Valuation buy-below price; same date/units.', false, 3),
  q('v4', 'Valuation', 'Does the investment work without a perfect outcome?', 'Stress lower growth/margins and rational downside assumptions.', false, 2),
];

export const PILLARS: Pillar[] = ['Understand', 'Moat', 'Management', 'Financials', 'Risk', 'Valuation'];

export interface QuantTestDef {
  id: string;
  label: string;
  compare: '>=' | '<=' | '>';
  threshold: number;
  unit: 'pct' | 'x' | 'count';
  context: string;
}

/** Thresholds are the workbook's editable analyst heuristics, not official Buffett rules. */
export const QUANT_TESTS: QuantTestDef[] = [
  { id: 'avgRoic', label: 'Avg 5-yr ROIC', compare: '>=', threshold: 0.12, unit: 'pct', context: 'A high return should persist through cycles; compare to WACC / peers.' },
  { id: 'positiveFcfYears', label: 'Positive FCF years (of 5)', compare: '>=', threshold: 4, unit: 'count', context: 'Missing historical years can make this misleading; examine at least 5 full years.' },
  { id: 'netDebtEbitda', label: 'Net debt / EBITDA', compare: '<=', threshold: 2.5, unit: 'x', context: 'A practical industrial-company leverage screen; sector leverage varies.' },
  { id: 'fcfToNi', label: 'Latest FCF / net income', compare: '>=', threshold: 0.8, unit: 'x', context: 'All-capex FCF proxy is affected by timing and investment cycle.' },
  { id: 'shareChange', label: '5-yr diluted shares change', compare: '<=', threshold: 0.05, unit: 'pct', context: 'Screen limits dilution to +5% over five years; buybacks must add value.' },
  { id: 'ebitToInterest', label: 'EBIT / cash interest', compare: '>=', threshold: 5, unit: 'x', context: 'Interest coverage heuristic for non-financials.' },
  { id: 'revCagr', label: 'Revenue CAGR', compare: '>', threshold: 0, unit: 'pct', context: 'Positive revenue trend; pricing/inflation may disguise real weakness.' },
  { id: 'avgRoe', label: 'Avg 5-yr ROE', compare: '>=', threshold: 0.15, unit: 'pct', context: 'Leverage and very low equity can inflate ROE; use alongside ROIC.' },
];

export type TestResult = 'PASS' | 'REVIEW' | 'NO DATA';

export function runTest(def: QuantTestDef, value: number | null | undefined, threshold = def.threshold): TestResult {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'NO DATA';
  if (def.compare === '>=') return value >= threshold ? 'PASS' : 'REVIEW';
  if (def.compare === '<=') return value <= threshold ? 'PASS' : 'REVIEW';
  return value > threshold ? 'PASS' : 'REVIEW';
}

export interface Scorecard {
  score: number | null; // weighted Yes points / total possible points
  completed: number;
  total: number;
  gates: 'PASS' | 'FAIL' | 'INCOMPLETE';
  gatesNo: number;
  uncertainOrBlank: number;
  byPillar: { pillar: Pillar; earned: number; max: number; rate: number | null }[];
}

export function scoreChecklist(answers: Record<string, Answer>): Scorecard {
  let earned = 0;
  let max = 0;
  let yes = 0;
  let no = 0;
  let gateNo = 0;
  let gateYes = 0;
  let gates = 0;
  for (const item of QUESTIONS) {
    const a = answers[item.id] ?? '';
    max += item.weight;
    if (a === 'Yes') {
      earned += item.weight;
      yes++;
    } else if (a === 'No') no++;
    if (item.gate) {
      gates++;
      if (a === 'No') gateNo++;
      if (a === 'Yes') gateYes++;
    }
  }
  const byPillar = PILLARS.map((pillar) => {
    const items = QUESTIONS.filter((x) => x.pillar === pillar);
    const m = items.reduce((s, x) => s + x.weight, 0);
    const e = items.reduce((s, x) => s + (answers[x.id] === 'Yes' ? x.weight : 0), 0);
    return { pillar, earned: e, max: m, rate: m ? e / m : null };
  });
  return {
    score: yes + no === 0 ? null : earned / max,
    completed: yes + no,
    total: QUESTIONS.length,
    gates: gateNo > 0 ? 'FAIL' : gateYes === gates ? 'PASS' : 'INCOMPLETE',
    gatesNo: gateNo,
    uncertainOrBlank: QUESTIONS.length - yes - no,
    byPillar,
  };
}

export type ValuationStatus = 'AT / BELOW BUY ZONE' | 'ABOVE BUY ZONE' | 'NEEDS INPUT / FIX';

/** The workbook's combined assessment (Dashboard!B18), in the same order of precedence. */
export function combinedAssessment(card: Scorecard, valuation: ValuationStatus, requiredScore: number, isOperatingBusiness: boolean): { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral'; explain: string } {
  if (!isOperatingBusiness) return { label: 'SPECIALIST SECTOR REVIEW', tone: 'warn', explain: 'Banks, insurers and REITs need sector-specific analysis; the generic cash-flow model and leverage screens do not apply as they stand.' };
  if (card.gates === 'FAIL') return { label: 'REJECT / REASSESS GATE', tone: 'bad', explain: `${card.gatesNo} required gate${card.gatesNo === 1 ? ' is' : 's are'} answered No. A critical No is a hard stop.` };
  if (card.completed < card.total) return { label: 'INCOMPLETE — FINISH CHECKLIST', tone: 'neutral', explain: `${card.total - card.completed} of ${card.total} questions still need a Yes or No. Uncertain and blank answers block qualification.` };
  if ((card.score ?? 0) < requiredScore) return { label: 'WATCHLIST / QUALITY BELOW TARGET', tone: 'warn', explain: `Weighted quality score is below the ${(requiredScore * 100).toFixed(0)}% screen.` };
  if (valuation === 'NEEDS INPUT / FIX') return { label: 'COMPLETE INTRINSIC VALUE', tone: 'neutral', explain: 'The valuation model needs valid inputs before price can be judged.' };
  if (valuation !== 'AT / BELOW BUY ZONE') return { label: 'WATCHLIST — PRICE TOO HIGH', tone: 'warn', explain: 'Quality passes, but the market price is above the buy-below price. A wonderful business above the buy zone stays on the watchlist.' };
  return { label: 'QUALIFIES FOR FURTHER REVIEW', tone: 'good', explain: 'Every gate passes, quality clears the screen and price is inside the buy zone. This is a prompt for deeper research, not a buy recommendation.' };
}
