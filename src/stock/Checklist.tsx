import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtCompact, fmtNum, fmtPct, isNum } from '../lib/format';
import { Card, Hint } from '../components/ui';
import { PILLARS, QUESTIONS, type Answer, type Pillar, type QuantTestDef } from '../../shared/checklist';
import { WORKSHEET_ROWS } from '../../shared/analysis';
import type { Financials } from '../../shared/financials';
import type { Analysis } from './useAnalysis';

const PILLAR_NOTE: Record<Pillar, string> = {
  Understand: 'Circle of competence: can you explain the business and its future?',
  Moat: 'Long-term favorable economics and an enduring competitive advantage.',
  Management: 'Trustworthy, able capital allocators whose interests align with owners.',
  Financials: 'Returns on capital, cash generation, leverage and per-share economics.',
  Risk: 'What could permanently impair the business.',
  Valuation: 'A sensible price relative to conservatively estimated intrinsic value.',
};

function fmtTest(def: QuantTestDef, v: number | null | undefined): string {
  if (!isNum(v)) return '–';
  if (def.unit === 'pct') return fmtPct(v, 1);
  if (def.unit === 'count') return String(v);
  return `${fmtNum(v, 2)}x`;
}

function AnswerButtons({ value, onChange, label }: { value: Answer; onChange: (a: Answer) => void; label: string }) {
  const opts: { a: Answer; text: string; cls: string }[] = [
    { a: 'Yes', text: '✓ Yes', cls: 'yes' },
    { a: 'No', text: '✕ No', cls: 'no' },
    { a: 'Uncertain', text: '? Uncertain', cls: 'unc' },
  ];
  return (
    <div className="answer" role="group" aria-label={`Answer: ${label}`}>
      {opts.map((o) => (
        <button key={o.a} type="button" className={value === o.a ? `on ${o.cls}` : ''} aria-pressed={value === o.a} onClick={() => onChange(value === o.a ? '' : o.a)}>{o.text}</button>
      ))}
    </div>
  );
}

export default function Checklist({ a, symbol, fin, finError }: { a: Analysis; symbol: string; fin: Financials | null; finError: string | null }) {
  const { check, setCheck, card, dataScore, verdict, suggestions, effective, isAuto, tests, worksheet, summary, result } = a;
  const [filter, setFilter] = useState<'all' | 'open' | 'gates'>('all');
  const [openNotes, setOpenNotes] = useState<Record<string, boolean>>({});
  const setAnswer = (id: string, ans: Answer) => setCheck({ ...check, answers: { ...check.answers, [id]: ans } });
  const setNote = (id: string, note: string) => setCheck({ ...check, notes: { ...check.notes, [id]: note } });
  const setThreshold = (id: string, v: number) => setCheck({ ...check, thresholds: { ...check.thresholds, [id]: v } });
  const overriddenCount = Object.values(check.answers).filter(Boolean).length;
  const autoCount = Object.values(isAuto).filter(Boolean).length;
  const zone = result.status === 'AT / BELOW BUY ZONE' ? 'PASS' : result.status === 'ABOVE BUY ZONE' ? 'TOO EXPENSIVE' : 'PENDING';
  const passCount = tests.filter((t) => t.result === 'PASS').length;
  const filing = fin?.filings.find((f) => f.form === '10-K' || f.form === '20-F' || f.form === '40-F');
  const proxy = fin?.filings.find((f) => f.form === 'DEF 14A');

  return (
    <div className="stack">
      {a.specialist && <div className="banner warn">{symbol} is a financial or real-estate company. The workbook labels these “specialist sector review”: leverage screens, ROIC and the generic cash-flow model need sector-specific interpretation.</div>}
      {finError && <div className="banner warn">{finError} Data-driven answers are unavailable; the checklist can still be completed by hand.</div>}
      {fin?.splitAdjusted && <div className="banner">Share counts and per-share figures for earlier years have been restated for a stock split (factor {fin.splitAdjusted}), using the comparative figures in the company’s later filings, so growth and dilution are measured on one basis.</div>}

      <div className={`verdict ${verdict.tone}`}>
        <div className="stat-label">Combined assessment</div>
        <div style={{ fontSize: 22, fontWeight: 700, margin: '2px 0 4px' }}>{verdict.label}</div>
        <p className="dim">{verdict.explain}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginTop: 14 }}>
          <div>
            <div className="stat-label">Weighted quality score</div>
            <div className="stat-value num">{card.score == null ? '–' : fmtPct(card.score, 0)}</div>
            <div className="bar-track" style={{ marginTop: 4, position: 'relative', overflow: 'visible' }}>
              <div className="bar-fill" style={{ width: `${(card.score ?? 0) * 100}%` }} />
              <span title={`Required ${fmtPct(check.requiredScore, 0)}`} style={{ position: 'absolute', left: `${check.requiredScore * 100}%`, top: -3, width: 2, height: 14, background: 'var(--text)' }} />
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>
              Required{' '}
              <input className="input num" style={{ width: 54, padding: '1px 4px' }} type="number" min={0} max={100} step={5} aria-label="Required quality score percent" value={Math.round(check.requiredScore * 100)} onChange={(e) => setCheck({ ...check, requiredScore: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })} /> %
            </div>
          </div>
          <div><div className="stat-label">Checklist completed</div><div className="stat-value num">{card.completed} / {card.total}</div><div className="small muted">{card.uncertainOrBlank} uncertain or blank</div></div>
          <div><div className="stat-label">Required gates</div><div className="stat-value">{card.gates}</div><div className="small muted">{card.gatesNo ? `${card.gatesNo} marked No` : 'All eight must be Yes'}</div></div>
          <div><div className="stat-label">Price vs buy zone</div><div className="stat-value">{zone}</div><div className="small muted">{isNum(result.discountToValue) ? (result.discountToValue >= 0 ? `Price is ${fmtPct(result.discountToValue, 0)} below intrinsic value` : `Price is ${fmtPct(-result.discountToValue, 0)} above intrinsic value`) : 'Complete the valuation'}</div></div>
          <div title="The score the front-page ranking uses: only the questions financial data can answer, ignoring your own answers"><div className="stat-label">Answered from data</div><div className="stat-value num">{dataScore.points} / {dataScore.max}</div><div className="small muted">{dataScore.yes} of {dataScore.questions} questions Yes</div></div>
          <div><div className="stat-label">Quant screens</div><div className="stat-value num">{passCount} / {tests.length}</div><div className="small muted">{tests.filter((t) => t.result === 'NO DATA').length} without data</div></div>
        </div>
        <p className="note" style={{ marginTop: 12 }}>A qualifying label is not a buy recommendation. Confirm data quality, business resilience, a downside scenario, and whether the holding fits your portfolio.</p>
      </div>

      <div className="two-col">
        <Card title="Category scorecard" sub="Weighted points earned from Yes answers">
          <div style={{ display: 'grid', gap: 8 }}>
            {card.byPillar.map((p) => (
              <div key={p.pillar} style={{ display: 'grid', gridTemplateColumns: '110px minmax(60px, 1fr) 96px', gap: 10, alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>{p.pillar}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(p.rate ?? 0) * 100}%` }} /></div>
                <span className="num small" style={{ textAlign: 'right' }}>{p.earned} / {p.max} · {fmtPct(p.rate, 0)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Investment thesis" sub="Saved in this browser for this ticker">
          <textarea className="input" style={{ width: '100%', minHeight: 96 }} placeholder={`Why would you own ${symbol}? What would make you wrong?`} value={check.thesis} onChange={(e) => setCheck({ ...check, thesis: e.target.value })} aria-label="Investment thesis" />
          <div className="row small" style={{ marginTop: 6 }}>
            {filing && <a href={filing.url} target="_blank" rel="noreferrer">Latest {filing.form} ({filing.filed})</a>}
            {proxy && <a href={proxy.url} target="_blank" rel="noreferrer">Proxy statement ({proxy.filed})</a>}
            <Link to={`/stock/${encodeURIComponent(symbol)}/valuation`}>Open the valuation</Link>
          </div>
        </Card>
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <h3>The Buffett quality checklist</h3>
            <div className="note">{autoCount} answered from the data (marked Auto), {overriddenCount} set by you. Judgment questions are left for you. Every required gate must be Yes; an Uncertain answer counts as incomplete.</div>
          </div>
          <div className="row">
            <div className="seg" role="group" aria-label="Show questions">
              {([['all', 'All'], ['open', 'Unanswered'], ['gates', 'Gates']] as const).map(([v, l]) => <button key={v} className={filter === v ? 'on' : ''} onClick={() => setFilter(v)}>{l}</button>)}
            </div>
            <button className="btn small" onClick={() => setCheck({ ...check, answers: {} })} disabled={!overriddenCount} title="Remove your answers and return to the data-driven ones">Clear my answers</button>
          </div>
        </div>
        {PILLARS.map((pillar) => {
          const items = QUESTIONS.filter((q) => q.pillar === pillar && (filter === 'all' || (filter === 'gates' && q.gate) || (filter === 'open' && (effective[q.id] === '' || effective[q.id] === 'Uncertain'))));
          if (!items.length) return null;
          const score = card.byPillar.find((p) => p.pillar === pillar);
          return (
            <div key={pillar}>
              <div className="row between" style={{ padding: '8px 16px', background: 'var(--surface-2)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                <span><b>{pillar}</b> <span className="small dim">— {PILLAR_NOTE[pillar]}</span></span>
                {score && <span className="small num dim">{score.earned} / {score.max} points</span>}
              </div>
              {items.map((q) => {
                const sug = suggestions[q.id];
                const ans = effective[q.id];
                return (
                  <div key={q.id} className="q">
                    <div style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <span className="qt">{q.question}</span>
                        {q.gate && <span className="badge warn" title="A required gate: a No stops the process">GATE</span>}
                        <span className="badge" title="Weight in the quality score">Weight {q.weight}</span>
                        {isAuto[q.id] && <span className="badge info" title="Answered automatically from the financial data; choose another answer to override">Auto</span>}
                      </div>
                      <div className="small dim" style={{ marginTop: 2 }}><b>A yes looks like:</b> {q.yesLooksLike}</div>
                      {sug && (
                        <div className="small" style={{ marginTop: 6 }}>
                          <span className="dim">{sug.kind === 'data' ? 'From the data' : sug.kind === 'lean' ? 'The data leans' : 'Needs your judgment'}{sug.kind !== 'judgment' && sug.answer ? `: ${sug.answer}` : ''} — </span>
                          {sug.reason}
                          {sug.kind === 'lean' && sug.answer && !check.answers[q.id] && (
                            <button className="btn ghost small" style={{ marginLeft: 6 }} onClick={() => setAnswer(q.id, sug.answer)}>Accept “{sug.answer}”</button>
                          )}
                        </div>
                      )}
                      {sug && sug.facts.length > 0 && (
                        <div className="facts">{sug.facts.map((f) => <span key={f.label}>{f.label}: <b className="num">{f.value}</b></span>)}</div>
                      )}
                      {sug && <div className="small muted" style={{ marginTop: 4 }}>Where to verify: {sug.verify}</div>}
                      {check.notes[q.id] || openNotes[q.id] ? (
                        <textarea className="input" autoFocus={Boolean(openNotes[q.id]) && !check.notes[q.id]} placeholder="Your evidence (write what you found, not just an opinion)" aria-label={`Evidence for: ${q.question}`} value={check.notes[q.id] ?? ''} onChange={(e) => setNote(q.id, e.target.value)} />
                      ) : (
                        <button className="btn ghost small" style={{ marginTop: 4, paddingLeft: 0 }} onClick={() => setOpenNotes({ ...openNotes, [q.id]: true })}>+ Add your evidence</button>
                      )}
                    </div>
                    <AnswerButtons value={ans} onChange={(v) => setAnswer(q.id, v)} label={q.question} />
                  </div>
                );
              })}
            </div>
          );
        })}
        <div className="card-pad note" style={{ borderTop: '1px solid var(--border)' }}>
          Scoring = weighted Yes ÷ total possible points. A critical No is a hard stop; unknown or blank answers always block qualification. Treat the required score as an adjustable screen, never proof of safety. Price discipline is enforced separately by the buy-zone test: a wonderful business above the buy zone remains a watchlist candidate, not a failed quality business. This is a practical analyst scorecard, not a checklist published or endorsed by Warren Buffett.
        </div>
      </section>

      <Card title="Automated quantitative screen" sub="Thresholds are editable analyst heuristics, not official pass/fail numbers. No data never counts as a pass." pad={false}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th className="left">Measurement</th><th>Result</th><th>Compare</th><th>Screen</th><th className="left">Pass / review</th><th className="left">Context</th></tr></thead>
            <tbody>
              {tests.map((t) => (
                <tr key={t.def.id}>
                  <td className="left strong">{t.def.label}</td>
                  <td>{fmtTest(t.def, t.value)}</td>
                  <td>{t.def.compare}</td>
                  <td>
                    <input className="input num" style={{ width: 70, padding: '2px 6px', textAlign: 'right' }} type="number" step={t.def.unit === 'pct' ? 1 : t.def.unit === 'count' ? 1 : 0.5} aria-label={`${t.def.label} threshold`}
                      value={t.def.unit === 'pct' ? Math.round(t.threshold * 1000) / 10 : t.threshold}
                      onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) setThreshold(t.def.id, t.def.unit === 'pct' ? n / 100 : n); }} />
                    <span className="muted small"> {t.def.unit === 'pct' ? '%' : t.def.unit === 'x' ? 'x' : ''}</span>
                  </td>
                  <td className="left"><span className={`badge ${t.result === 'PASS' ? 'good' : t.result === 'REVIEW' ? 'warn' : ''}`}>{t.result === 'PASS' ? '✓ PASS' : t.result === 'REVIEW' ? '! REVIEW' : 'NO DATA'}</span></td>
                  <td className="left wrap small dim">{t.def.context}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-pad note">Use this as a warning system, not a buy signal. Check the 10-K cash flow, debt schedules, competitor returns and recession-period performance before approving the corresponding Yes above.</div>
      </Card>

      {worksheet && summary && (
        <Card title="5-year financial quality worksheet" sub={`${summary.span} · from SEC filings, in US dollars · capex and interest shown as positive spending`} pad={false}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th className="left">Metric</th>{worksheet.labels.map((l) => <th key={l}>{l}</th>)}<th>Latest TTM</th></tr></thead>
              <tbody>
                {WORKSHEET_ROWS.map((r) => {
                  const f = (v: number | null | undefined) => (r.fmt === 'pct' ? fmtPct(v, 1) : fmtCompact(v, r.fmt === 'money' ? '$' : ''));
                  return (
                    <tr key={r.key} className={r.key === 'fcf' ? 'strong' : ''}>
                      <td className="left">{r.label}</td>
                      {worksheet.rows[r.key].map((v, i) => <td key={i}>{f(v)}</td>)}
                      <td>{f(worksheet.ttm?.[r.key])}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="card-pad">
            <h3 style={{ marginBottom: 8 }}>Automatic ratio summary</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '6px 24px' }}>
              {([
                ['Revenue CAGR', fmtPct(summary.revCagr, 1), 'Growth alone does not create value.'],
                ['Net income CAGR', fmtPct(summary.niCagr, 1), 'Not meaningful if earnings are cyclical or negative.'],
                ['FCF CAGR', fmtPct(summary.fcfCagr, 1), 'FCF = CFO − all capex (a proxy, not owner earnings).'],
                ['Average ROIC', fmtPct(summary.avgRoic, 1), 'Check the ROIC definition, acquisitions and accounting.'],
                ['Average ROE', fmtPct(summary.avgRoe, 1), 'High debt can inflate ROE.'],
                ['Positive-FCF years', summary.positiveFcfYears == null ? '–' : `${summary.positiveFcfYears} of ${summary.fcfYears}`, 'Compare with the number of years supplied.'],
                ['Latest net debt / EBITDA', isNum(summary.netDebtEbitda) ? `${summary.netDebtEbitda.toFixed(2)}x` : '–', 'A screen for non-financial firms, not banks.'],
                ['Latest FCF / net income', isNum(summary.fcfToNi) ? `${summary.fcfToNi.toFixed(2)}x` : '–', 'Conversion can swing with working capital.'],
                ['Diluted share count change', fmtPct(summary.shareChange, 1), 'Negative means the share count declined (generally favorable).'],
                ['Latest EBIT / cash interest', isNum(summary.ebitToInterest) ? `${summary.ebitToInterest.toFixed(1)}x` : '–', '100x is a display cap when interest is zero.'],
                ['Positive net income years', summary.positiveNiYears == null ? '–' : `${summary.positiveNiYears} of ${summary.yearsEntered}`, 'Profits through a complete cycle matter.'],
                ['Average 5-year FCF', fmtCompact(summary.avgFcf, '$'), 'Consider normalization before valuation.'],
              ] as [string, string, string][]).map(([k, v, tip]) => (
                <div key={k} className="row between" style={{ borderBottom: '1px solid var(--border)', padding: '3px 0', flexWrap: 'nowrap' }}>
                  <span className="dim row" style={{ gap: 4, flexWrap: 'nowrap' }}>{k} <Hint text={tip} /></span>
                  <b className="num">{v}</b>
                </div>
              ))}
            </div>
            <p className="note" style={{ marginTop: 10 }}>Banks, insurers, utilities and REITs need sector-specific ratio interpretation. For capital-intensive firms, CFO − capex can understate normalized owner earnings in growth years, or overstate it if spending is deferred.</p>
          </div>
        </Card>
      )}
    </div>
  );
}
