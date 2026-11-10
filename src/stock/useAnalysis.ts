import { useMemo } from 'react';
import { useStored } from '../lib/store';
import type { Financials } from '../../shared/financials';
import type { StockRow } from '../../shared/types';
import { QUESTIONS, combinedAssessment, scoreChecklist, type Answer } from '../../shared/checklist';
import { analyse, autoScore, isSpecialistSector, DATA_QUESTION_IDS } from '../../shared/analysis';
import type { DcfInputs } from '../../shared/valuation';

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
    const { worksheet, summary, defaults, inputs, result, tests, suggestions } = analyse({ fin, price: row?.price ?? null, marketCap: row?.marketCap ?? null, sector: row?.sector ?? '', industry: row?.industry ?? '', thresholds: check.thresholds, overrides });
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
    // The same data-only score the front-page ranking uses (it ignores the reader's own answers).
    const dataAnswers: Record<string, Answer> = {};
    for (const id of DATA_QUESTION_IDS) dataAnswers[id] = suggestions[id]?.answer ?? '';
    const dataScore = autoScore(dataAnswers);
    const specialist = isSpecialistSector(row?.sector ?? '', row?.sic);
    const verdict = combinedAssessment(card, result.status, check.requiredScore ?? 0.85, !specialist);
    return {
      worksheet, summary, defaults, inputs, result, tests, suggestions, effective, isAuto, card, dataScore, verdict, specialist,
      overrides, setOverrides, check: { ...EMPTY, ...check }, setCheck,
    };
  }, [row, fin, overrides, check, setOverrides, setCheck]);
}

export type Analysis = ReturnType<typeof useAnalysis>;
