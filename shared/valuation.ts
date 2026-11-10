import type { ValuationStatus } from './checklist.ts';

/**
 * Intrinsic value: the workbook's 10-year, two-stage owner-earnings model
 * ("Valuation" sheet). Everything is per share and on an equity basis, so net
 * debt is NOT subtracted again.
 */
export interface DcfInputs {
  price: number | null;
  ownerEarnings: number | null; // normalized owner earnings per share
  marginOfSafety: number; // 0.25 = 25%
  discountRate: number; // 0.10
  growth1to5: number; // 0.05
  growth6to10: number; // 0.03
  terminalGrowth: number; // 0.02
}

export interface DcfYear {
  year: number;
  ownerEarnings: number;
  growth: number;
  discountFactor: number;
  presentValue: number;
}

export interface DcfResult {
  valid: boolean;
  safetyCheck: 'OK' | 'INVALID: DISCOUNT ≤ TERMINAL' | 'CHECK INPUTS';
  years: DcfYear[];
  pvYears: number | null;
  terminalValue: number | null;
  pvTerminal: number | null;
  intrinsicValue: number | null;
  buyBelow: number | null;
  discountToValue: number | null; // 1 - price / value
  upside: number | null; // value / price - 1
  terminalShare: number | null; // share of value from the terminal period
  status: ValuationStatus;
}

export function dcf(i: DcfInputs): DcfResult {
  const empty: DcfResult = { valid: false, safetyCheck: 'CHECK INPUTS', years: [], pvYears: null, terminalValue: null, pvTerminal: null, intrinsicValue: null, buyBelow: null, discountToValue: null, upside: null, terminalShare: null, status: 'NEEDS INPUT / FIX' };
  const nums = [i.marginOfSafety, i.discountRate, i.growth1to5, i.growth6to10, i.terminalGrowth];
  if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return empty;
  if (i.discountRate <= i.terminalGrowth) return { ...empty, safetyCheck: 'INVALID: DISCOUNT ≤ TERMINAL' };
  if (i.ownerEarnings == null || !(i.ownerEarnings > 0)) return { ...empty, safetyCheck: 'OK' };

  const years: DcfYear[] = [];
  let oe = i.ownerEarnings;
  for (let t = 1; t <= 10; t++) {
    const g = t <= 5 ? i.growth1to5 : i.growth6to10;
    oe *= 1 + g;
    const df = 1 / (1 + i.discountRate) ** t;
    years.push({ year: t, ownerEarnings: oe, growth: g, discountFactor: df, presentValue: oe * df });
  }
  const pvYears = years.reduce((s, y) => s + y.presentValue, 0);
  const terminalValue = (years[9].ownerEarnings * (1 + i.terminalGrowth)) / (i.discountRate - i.terminalGrowth);
  const pvTerminal = terminalValue / (1 + i.discountRate) ** 10;
  const intrinsicValue = pvYears + pvTerminal;
  const buyBelow = intrinsicValue * (1 - i.marginOfSafety);
  const priceOk = i.price != null && i.price > 0;
  const mosOk = i.marginOfSafety >= 0 && i.marginOfSafety < 1;
  const status: ValuationStatus = !priceOk || !mosOk ? 'NEEDS INPUT / FIX' : (i.price as number) <= buyBelow ? 'AT / BELOW BUY ZONE' : 'ABOVE BUY ZONE';
  return {
    valid: true,
    safetyCheck: 'OK',
    years,
    pvYears,
    terminalValue,
    pvTerminal,
    intrinsicValue,
    buyBelow,
    discountToValue: priceOk ? 1 - (i.price as number) / intrinsicValue : null,
    upside: priceOk ? intrinsicValue / (i.price as number) - 1 : null,
    terminalShare: pvTerminal / intrinsicValue,
    status,
  };
}

/** The workbook's three suggested stress tests, alone and combined. */
export function stressTests(i: DcfInputs): { label: string; detail: string; value: number | null; holds: boolean | null }[] {
  const run = (label: string, detail: string, patch: Partial<DcfInputs>) => {
    const r = dcf({ ...i, ...patch });
    return { label, detail, value: r.intrinsicValue, holds: r.intrinsicValue != null && i.price != null ? r.intrinsicValue >= i.price : null };
  };
  const half = { growth1to5: i.growth1to5 / 2 };
  const rate = { discountRate: i.discountRate + 0.02 };
  const cut = { ownerEarnings: i.ownerEarnings != null ? i.ownerEarnings * 0.8 : null };
  return [
    run('Near-term growth cut in half', `Years 1-5 growth ${(i.growth1to5 * 100).toFixed(1)}% → ${((i.growth1to5 / 2) * 100).toFixed(1)}%`, half),
    run('Discount rate +2 points', `${(i.discountRate * 100).toFixed(1)}% → ${((i.discountRate + 0.02) * 100).toFixed(1)}%`, rate),
    run('Normalized earnings −20%', 'Owner earnings per share reduced by a fifth', cut),
    run('All three together', 'A deliberately harsh downside case', { ...half, ...rate, ...cut }),
  ];
}

/** Growth rate (years 1-5, with years 6-10 fading halfway to terminal) that makes value equal today's price. */
export function impliedGrowth(i: DcfInputs): number | null {
  if (i.price == null || !(i.price > 0) || i.ownerEarnings == null || !(i.ownerEarnings > 0) || i.discountRate <= i.terminalGrowth) return null;
  const valueAt = (g: number) => dcf({ ...i, growth1to5: g, growth6to10: (g + i.terminalGrowth) / 2 }).intrinsicValue ?? 0;
  let lo = -0.5;
  let hi = 1;
  if (valueAt(lo) > i.price) return lo;
  if (valueAt(hi) < i.price) return hi;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (valueAt(mid) < i.price) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Benjamin Graham's revised formula: V = EPS x (8.5 + 2g) x 4.4 / Y, g in percent, Y = AAA-type bond yield in percent. */
export function grahamValue(eps: number | null, growthPct: number, bondYieldPct: number): number | null {
  if (eps == null || !(eps > 0) || !(bondYieldPct > 0)) return null;
  return (eps * (8.5 + 2 * Math.min(Math.max(growthPct, 0), 15)) * 4.4) / bondYieldPct;
}

/** Earnings power value: today's owner earnings capitalized with no growth at all. */
export function earningsPowerValue(ownerEarnings: number | null, discountRate: number): number | null {
  if (ownerEarnings == null || !(ownerEarnings > 0) || !(discountRate > 0)) return null;
  return ownerEarnings / discountRate;
}

export function sensitivity(i: DcfInputs, rates: number[], growths: number[]): { rates: number[]; growths: number[]; values: (number | null)[][] } {
  return {
    rates,
    growths,
    values: growths.map((g) => rates.map((r) => dcf({ ...i, discountRate: r, growth1to5: g, growth6to10: Math.max(i.terminalGrowth, Math.min(i.growth6to10, g)) }).intrinsicValue)),
  };
}
