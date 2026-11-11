/**
 * How capital spending and borrowings are read from XBRL captions.
 *
 * Companies describe both with dozens of different captions, and the same amount
 * often appears under two of them. Two rules keep the readings honest:
 *
 *  1. Captions are only ever combined when they come from the same filing. A later
 *     filing frequently re-presents an earlier year under different captions
 *     (one "capital expenditures" line becomes "drilling" plus "acquisitions");
 *     adding the old presentation to the new one counts the year twice. The
 *     per-company statements call these functions once per filing.
 *  2. Missing is never zero. Each function returns null when nothing usable is
 *     tagged, and the caller treats that as unknown.
 *
 * Used by the per-company statements (server/company/financials.ts) and by the
 * bulk screener data (server/universe/fundamentals.ts).
 */

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export type Get = (tag: string) => number | null | undefined;

/** Adds parts; two captions carrying exactly the same non-zero amount are one item tagged twice. */
function sumDistinct(parts: (number | null)[]): number | null {
  const seen = new Set<number>();
  let total = 0;
  let any = false;
  for (const x of parts) {
    if (x == null) continue;
    any = true;
    if (x > 0 && seen.has(x)) continue;
    seen.add(x);
    total += x;
  }
  return any ? total : null;
}

// ---------------------------------------------------------------------------------
// Capital spending
// ---------------------------------------------------------------------------------

/** The all-in "payments to acquire productive assets" total. */
export const CAPEX_TOTAL = 'PaymentsToAcquireProductiveAssets';
/** Purchases net of disposal proceeds: a floor, used when it exceeds the purchases tagged elsewhere. */
export const CAPEX_NET = 'PaymentsForProceedsFromProductiveAssets';
/** Oil and gas: the two detail captions are components of the property-and-equipment caption. */
const OIL_GAS = 'PaymentsToAcquireOilAndGasPropertyAndEquipment';
const OIL_GAS_PARTS = ['PaymentsToAcquireOilAndGasProperty', 'PaymentsToAcquireOilAndGasEquipment'];
/** Separate cash-flow lines; within one filing they are added together. */
const CAPEX_LINES = [
  'PaymentsToAcquirePropertyPlantAndEquipment',
  'PaymentsForCapitalImprovements',
  'PaymentsToExploreAndDevelopOilAndGasProperties',
  'PaymentsToAcquireOtherPropertyPlantAndEquipment',
  'PaymentsToAcquireMachineryAndEquipment',
  'PaymentsToAcquireBuildings',
  'PaymentsToAcquireLand',
  'PaymentsToAcquireFurnitureAndFixtures',
  'PaymentsForConstructionInProcess',
  'PaymentsToAcquireMiningAssets',
  'PaymentsToAcquireTimberlands',
  'PaymentsToAcquireWaterAndWasteWaterSystems',
  'PaymentsToAcquireEquipmentOnLease',
  'PaymentsToDevelopSoftware',
  'PaymentsForSoftware',
  'PaymentsToAcquireSoftware',
  'PaymentsToAcquireIntangibleAssets',
  'PaymentsToAcquireOtherProductiveAssets',
];
export const CAPEX_TAGS = [CAPEX_TOTAL, CAPEX_NET, OIL_GAS, ...OIL_GAS_PARTS, ...CAPEX_LINES];

/**
 * Capital spending for one period from one filing's captions: purchases of property and
 * equipment, oil and gas properties, rental equipment, capitalized software and other
 * intangible assets. Null when none is tagged, or when the only figure is zero (an
 * operating company that spends nothing is far less likely than a caption this cannot read).
 */
export function combineCapex(get: Get): number | null {
  const abs = (tag: string) => {
    const x = get(tag);
    return isNum(x) ? Math.abs(x) : null;
  };
  const parts = sumDistinct(OIL_GAS_PARTS.map(abs));
  const whole = abs(OIL_GAS);
  const oilGas = whole == null ? parts : parts == null ? whole : Math.max(whole, parts);
  const lines = sumDistinct([...CAPEX_LINES.map(abs), oilGas]);
  const total = abs(CAPEX_TOTAL);
  // The stated total and the lines are two readings of the same spending, never added together.
  // Where the "total" is the smaller, it is one of the lines again or the lines net of grants.
  let capex = lines == null ? total : total == null ? lines : Math.max(lines, total);
  // Purchases net of disposal proceeds understate spending, so the figure is a floor at most.
  const net = get(CAPEX_NET);
  if (isNum(net) && net > (capex ?? 0)) capex = net;
  return capex != null && capex > 0 ? capex : null;
}

// ---------------------------------------------------------------------------------
// Borrowings
// ---------------------------------------------------------------------------------

const MATURITY = ['InNextTwelveMonths', 'InYearTwo', 'InYearThree', 'InYearFour', 'InYearFive', 'AfterYearFive'].map((s) => `LongTermDebtMaturitiesRepaymentsOfPrincipal${s}`);
const MATURITY_ROLLING = ['InNextRollingTwelveMonths', 'InRollingYearTwo', 'InRollingYearThree', 'InRollingYearFour', 'InRollingYearFive', 'InRollingAfterYearFive'].map((s) => `LongTermDebtMaturitiesRepaymentsOfPrincipal${s}`);

export const DEBT_TAGS = [
  // balance-sheet captions, non-current
  'LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations', 'LongTermNotesAndLoans',
  'LongTermNotesPayable', 'SeniorLongTermNotes', 'NotesPayableNoncurrent',
  'ConvertibleNotesPayableNoncurrent', 'ConvertibleDebtNoncurrent', 'ConvertibleLongTermNotesPayable',
  'LongTermLineOfCredit', 'LongTermLoansFromBank', 'LongTermLoansPayable', 'NotesPayableToBankNoncurrent',
  'OtherLongTermDebtNoncurrent', 'SubordinatedLongTermDebt', 'SecuredLongTermDebt', 'UnsecuredLongTermDebt',
  // balance-sheet captions, current
  'DebtCurrent', 'LongTermDebtCurrent', 'LongTermDebtAndCapitalLeaseObligationsCurrent',
  'SeniorNotesCurrent', 'NotesPayableCurrent', 'NotesAndLoansPayableCurrent', 'ConvertibleNotesPayableCurrent', 'ConvertibleDebtCurrent',
  'LinesOfCreditCurrent', 'LoansPayableCurrent', 'LoansPayableToBankCurrent', 'NotesPayableToBankCurrent', 'OtherLongTermDebtCurrent',
  'ShortTermBorrowings', 'CommercialPaper', 'ShortTermBankLoansAndNotesPayable',
  // stated totals
  'DebtLongtermAndShorttermCombinedAmount', 'DebtAndCapitalLeaseObligations', 'LongTermDebt', 'LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities',
  // by instrument
  'SeniorNotes', 'ConvertibleNotesPayable', 'ConvertibleDebt', 'NotesPayable', 'NotesAndLoansPayable', 'LoansPayable', 'LoansPayableToBank',
  'OtherLongTermDebt', 'OtherBorrowings', 'MediumTermNotes', 'LineOfCredit',
  // by security
  'SecuredDebt', 'UnsecuredDebt',
  // corroboration only
  'DebtInstrumentCarryingAmount', ...MATURITY, ...MATURITY_ROLLING,
];

export interface DebtReading {
  /** Null when captions are tagged but none gives a credible figure (every reading exceeds total liabilities). */
  value: number | null;
  /** How many independent readings of the captions agree on this figure (1 = uncorroborated). */
  support: number;
}

/**
 * Total borrowings at one balance-sheet date from one filing's captions.
 *
 * A company's debt can be read several ways from what it tags: the balance-sheet
 * captions (non-current plus current), a stated total, the instruments (senior
 * notes, convertibles, loans), the secured/unsecured split, the carrying amount in
 * the debt note, and the schedule of maturities. Each reading is built so that it
 * cannot count a borrowing twice, and readings are never added to each other.
 *
 * A reading counts when it is complete by construction or when a reading on a
 * different basis agrees with it (within 3%); the largest of those is used, because
 * an agreed figure smaller than a complete one covers only part of the debt. No
 * reading above total liabilities is accepted (`cap`).
 *
 * Returns null when no debt caption is tagged at all.
 */
export function combineDebt(get: Get, cap?: number | null): DebtReading | null {
  const d = (tag: string) => {
    const x = get(tag);
    return isNum(x) && x >= 0 ? x : null;
  };
  const first = (...tags: string[]) => {
    for (const t of tags) {
      const x = d(t);
      if (x != null) return x;
    }
    return null;
  };
  const larger = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));

  const shortTerm = first('ShortTermBorrowings', 'CommercialPaper', 'ShortTermBankLoansAndNotesPayable');
  const currentPortion =
    first('LongTermDebtCurrent', 'LongTermDebtAndCapitalLeaseObligationsCurrent') ??
    sumDistinct([
      first('SeniorNotesCurrent', 'NotesPayableCurrent', 'NotesAndLoansPayableCurrent'),
      first('ConvertibleNotesPayableCurrent', 'ConvertibleDebtCurrent'),
      d('LinesOfCreditCurrent'),
      first('LoansPayableCurrent', 'LoansPayableToBankCurrent', 'NotesPayableToBankCurrent'),
      d('OtherLongTermDebtCurrent'),
    ]);
  // "Debt, current" is already short-term borrowings plus the current portion of long-term debt.
  const current = d('DebtCurrent') ?? sumDistinct([currentPortion, shortTerm]);
  const nonCurrentCaption = first('LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations', 'LongTermNotesAndLoans');
  const nonCurrentInstruments = [
    first('LongTermNotesPayable', 'SeniorLongTermNotes', 'NotesPayableNoncurrent'),
    first('ConvertibleNotesPayableNoncurrent', 'ConvertibleDebtNoncurrent', 'ConvertibleLongTermNotesPayable'),
    d('LongTermLineOfCredit'),
    first('LongTermLoansFromBank', 'LongTermLoansPayable', 'NotesPayableToBankNoncurrent'),
    d('OtherLongTermDebtNoncurrent'),
    d('SubordinatedLongTermDebt'),
  ];
  // The same non-current debt split by instrument or by security: two views of one amount.
  const nonCurrentDetail = larger(sumDistinct(nonCurrentInstruments), sumDistinct([d('SecuredLongTermDebt'), d('UnsecuredLongTermDebt')]));
  const nonCurrent = nonCurrentCaption ?? nonCurrentDetail;

  const longTermTotal = first('LongTermDebt', 'LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities');
  const notes = larger(d('NotesPayable'), sumDistinct([d('SeniorNotes'), first('ConvertibleNotesPayable', 'ConvertibleDebt'), d('MediumTermNotes')]));
  const loans = first('LoansPayable', 'LoansPayableToBank');
  const instruments = sumDistinct([larger(d('NotesAndLoansPayable'), sumDistinct([notes, loans])), d('OtherLongTermDebt'), d('OtherBorrowings')]);
  const lineOfCredit = d('LineOfCredit');
  const maturities = (tags: string[]) => {
    const vals = tags.map(d);
    return vals.filter((x) => x != null).length >= 3 ? vals.reduce((s: number, x) => s + (x ?? 0), 0) : null;
  };

  // Each reading has a basis (the captions it rests on) and a kind:
  //  - sure: complete by construction;
  //  - unsure: rests on an assumption or can be partial, so it only counts when a reading on a
  //    different basis agrees with it;
  //  - witness: a face-value figure from the debt note (carrying amount, maturity schedule).
  type Kind = 'sure' | 'unsure' | 'witness';
  type Basis = 'captions' | 'combined' | 'longTerm' | 'instruments' | 'security' | 'carrying' | 'maturities';
  const readings: { value: number; kind: Kind; basis: Basis }[] = [];
  const add = (value: number | null, kind: Kind, basis: Basis) => {
    if (value != null) readings.push({ value, kind, basis });
  };
  add(nonCurrent != null || current != null ? sumDistinct([nonCurrent, current]) : null, 'sure', 'captions');
  // The face caption plus instrument captions shown as separate balance-sheet lines.
  add(nonCurrentCaption != null && nonCurrentDetail != null ? sumDistinct([nonCurrentCaption, ...nonCurrentInstruments, current]) : null, 'unsure', 'captions');
  add(first('DebtLongtermAndShorttermCombinedAmount', 'DebtAndCapitalLeaseObligations'), 'sure', 'combined');
  // "Long-term debt" normally includes its current portion and excludes short-term borrowings...
  add(longTermTotal != null ? sumDistinct([longTermTotal, shortTerm]) : null, 'sure', 'longTerm');
  // ...but some companies mean all debt by it, and some only the non-current line.
  add(longTermTotal, 'unsure', 'longTerm');
  add(longTermTotal != null && current != null && current > 0 ? longTermTotal + current : null, 'unsure', 'longTerm');
  add(instruments ?? lineOfCredit, 'sure', 'instruments');
  // "Line of credit" is as often the size of the facility as the amount drawn.
  add(instruments != null && lineOfCredit != null ? sumDistinct([instruments, lineOfCredit]) : null, 'unsure', 'instruments');
  add(sumDistinct([d('SecuredDebt'), d('UnsecuredDebt')]), 'unsure', 'security');
  add(d('DebtInstrumentCarryingAmount'), 'witness', 'carrying');
  add(maturities(MATURITY) ?? maturities(MATURITY_ROLLING), 'witness', 'maturities');
  if (!readings.length) return null;

  const allowed = isNum(cap) && cap > 0 ? readings.filter((r) => r.value <= cap * 1.02) : readings;
  // Every reading exceeds total liabilities: none of them can be the company's debt.
  if (!allowed.length) return { value: null, support: 0 };
  const agree = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e6, 0.03 * Math.max(a, b));
  // Agreement only counts between readings on different bases: two readings built on the same
  // caption agreeing with each other proves nothing.
  const scored = allowed.map((r) => ({ ...r, support: new Set(allowed.filter((o) => agree(o.value, r.value)).map((o) => o.basis)).size }));
  // Once one reading of a caption is corroborated, the other readings of the same caption (the
  // same figure under a different assumption) are wrong by construction. Where the assumptions
  // differ by less than the tolerance and several are "corroborated", the best-supported stands.
  const byBasis = new Map<Basis, (typeof scored)[number]>();
  for (const r of scored) {
    if (r.support < 2) continue;
    const cur = byBasis.get(r.basis);
    if (!cur || r.support > cur.support || (r.support === cur.support && ((r.kind === 'sure' && cur.kind !== 'sure') || (r.kind === cur.kind && r.value > cur.value)))) byBasis.set(r.basis, r);
  }
  const corroborated = [...byBasis.values()];
  const settled = new Set(byBasis.keys());
  const standing = scored.filter((r) => r.support < 2 && r.kind === 'sure' && !settled.has(r.basis));
  const candidates = [...corroborated, ...standing];
  // The largest candidate: an agreed figure that is smaller than a complete reading on another
  // basis covers only part of the debt (the notes, say, but not the bank line).
  let best = candidates.sort((x, y) => y.value - x.value)[0];
  if (!best) {
    // Nothing complete and nothing agreed: the largest partial reading, a witness only as a last resort.
    const rest = scored.filter((r) => r.kind === 'unsure');
    best = (rest.length ? rest : scored).sort((x, y) => y.value - x.value)[0];
  } else if (best.kind === 'witness') {
    // Prefer the carrying amount on the balance sheet to the face amount in the note when both agree.
    const same = corroborated.filter((r) => r.kind !== 'witness' && agree(r.value, best.value)).sort((x, y) => (x.kind === y.kind ? y.value - x.value : x.kind === 'sure' ? -1 : 1))[0];
    if (same) best = same;
  }
  return { value: best.value, support: best.support };
}
