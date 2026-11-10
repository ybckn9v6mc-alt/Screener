import { useMemo } from 'react';
import { useStored } from '../lib/store';
import type { Financials } from '../../shared/financials';
import type { StockRow } from '../../shared/types';
import { QUANT_TESTS, QUESTIONS, combinedAssessment, runTest, scoreChecklist, type Answer } from '../../shared/checklist';
import { buildWorksheet, isSpecialistSector, ratioSummary, suggestAnswers, valuationDefaults, type Suggestion } from '../../shared/analysis';
import { dcf, type DcfInputs } from '../../shared/valuation';

export interface ChecklistState {
  answers: Record<string, Answer>;
  notes: Record<string, string>;
  thresholds: Record<string, number>;
  requiredScore: number;
  thesis: string;
}

const EMPTY: ChecklistState = { answers: {}, notes: {}, thresholds: {}, requiredScore: 0.85, thesis: '' };

/**
 * Everything the Checklist and Valuation tabs share for one stock. The reader's
 * own inputs (answers, notes, valuation overrides) are kept in this browser's
 * storage per ticker; everything else is recomputed from the data.
 */
export function useAnalysis(symbol: string, row: StockRow | null, fin: Financials | null) {
  const [overrides, setOverrides] = useStored<Partial<DcfInputs>>(`valuation.${symbol}`, {});
  const [check, setCheck] = useStored<ChecklistState>(`checklist.${symbol}`, EMPTY);

  return useMemo(() => {
    const price = row?.price ?? null;
    const worksheet = fin ? buildWorksheet(fin) : null;
    const summary = worksheet ? ratioSummary(worksheet) : null;
    const defaults = fin ? valuationDefaults(fin, price) : null;
    const base: DcfInputs = defaults?.inputs ?? { price, ownerEarnings: null, marginOfSafety: 0.25, discountRate: 0.1, growth1to5: 0.05, growth6to10: 0.03, terminalGrowth: 0.02 };
    const inputs: DcfInputs = { ...base, ...overrides, price: overrides.price ?? price };
    const result = dcf(inputs);
    const thresholds: Record<string, number> = Object.fromEntries(QUANT_TESTS.map((t) => [t.id, check.thresholds?.[t.id] ?? t.threshold]));
    const tests = QUANT_TESTS.map((t) => {
      const value = summary ? (summary as unknown as Record<string, number | null>)[t.id] : null;
      return { def: t, value, threshold: thresholds[t.id], result: runTest(t, value, thresholds[t.id]) };
    });
    const suggestions: Record<string, Suggestion> = suggestAnswers({ fin, worksheet, summary, thresholds, dcfInputs: inputs, dcfResult: result, sector: row?.sector ?? '', industry: row?.industry ?? '' });
    // A question the reader has not touched takes the data-driven answer; judgment questions stay blank.
    const effective: Record<string, Answer> = {};
    const isAuto: Record<string, boolean> = {};
    for (const q of QUESTIONS) {
      const own = check.answers?.[q.id];
      const sug = suggestions[q.id];
      if (own) effective[q.id] = own;
      else if (sug?.kind === 'data' && sug.answer) {
        effective[q.id] = sug.answer;
        isAuto[q.id] = true;
      } else effective[q.id] = '';
    }
    const card = scoreChecklist(effective);
    const specialist = isSpecialistSector(row?.sector ?? '', row?.sic);
    const verdict = combinedAssessment(card, result.status, check.requiredScore ?? 0.85, !specialist);
    return {
      worksheet, summary, defaults, inputs, result, tests, suggestions, effective, isAuto, card, verdict, specialist,
      overrides, setOverrides, check: { ...EMPTY, ...check }, setCheck,
    };
  }, [row, fin, overrides, check, setOverrides, setCheck]);
}

export type Analysis = ReturnType<typeof useAnalysis>;
