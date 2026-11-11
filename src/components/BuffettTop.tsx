import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/api';
import { fmtCompact, fmtDate, fmtNum, fmtPct, fmtPrice, isNum } from '../lib/format';
import { Card, ErrorNote, Loading } from './ui';

interface Question {
  id: string;
  pillar: string;
  question: string;
  weight: number;
  gate: boolean;
  answer: 'Yes' | 'No' | 'Uncertain' | '';
  reason: string;
}

interface Entry {
  rank: number;
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  type: 'stock' | 'adr' | 'other';
  marketCap: number | null;
  price: number | null;
  points: number;
  maxPoints: number;
  yes: number;
  no: number;
  uncertain: number;
  intrinsicValue: number | null;
  buyBelow: number | null;
  valueDiscount: number | null;
  valuationStatus: string;
  ownerEarnings: number | null;
  ownerEarningsBasis: string;
  ownerEarningsYield: number | null;
  growth1to5: number;
  growth6to10: number;
  discountRate: number;
  marginOfSafety: number;
  pe: number | null;
  fyLabel: string | null;
  fyEnd: string | null;
  shareBasisNote: string | null;
  splitAdjusted: number | null;
  metrics: {
    avgRoic: number | null;
    avgRoe: number | null;
    positiveFcfYears: number | null;
    fcfYears?: number;
    netDebtEbitda: number | null;
    fcfToNi: number | null;
    shareChange: number | null;
    ebitToInterest: number | null;
    revCagr: number | null;
    quantPass: number;
    quantWithData: number;
  };
  questions: Question[];
}

interface Payload {
  asOf: number;
  minCap: number;
  progress: { done: number; total: number };
  counts: { aboveFloor: number; financialOrRealEstate: number; noStatements: number; analysed: number; shortHistory: number; staleStatements: number; gateFailed: number; capexUnknown: number; noValuation: number; duplicateListings: number; ranked: number };
  maxPoints: number;
  questionCount: number;
  rows: Entry[];
  rules: string[];
}

const usd = (v: number | null | undefined) => (isNum(v) ? `$${fmtPrice(v)}` : '–');
const times = (v: number | null | undefined, dp = 1) => (isNum(v) ? `${fmtNum(v, dp)}x` : '–');

/** Where the price sits against the buy-below price and intrinsic value, on one scale. */
function ValueBar({ e }: { e: Entry }) {
  if (!isNum(e.price) || !isNum(e.intrinsicValue) || !isNum(e.buyBelow)) return <span className="muted">–</span>;
  const max = Math.max(e.intrinsicValue, e.price) * 1.06;
  const pos = (v: number) => Math.min(100, Math.max(0, (v / max) * 100));
  return (
    <div
      style={{ position: 'relative', height: 16, minWidth: 96 }}
      role="img"
      aria-label={`Price ${usd(e.price)}; buy below ${usd(e.buyBelow)}; intrinsic value ${usd(e.intrinsicValue)}`}
      title={`Price ${usd(e.price)} · buy below ${usd(e.buyBelow)} · intrinsic value ${usd(e.intrinsicValue)}`}
    >
      <div style={{ position: 'absolute', left: 0, right: 0, top: 4, height: 8, display: 'flex', gap: 2 }}>
        <span style={{ width: `${pos(e.buyBelow)}%`, background: 'var(--good)', opacity: 0.55, borderRadius: '4px 2px 2px 4px' }} />
        <span style={{ width: `${pos(e.intrinsicValue) - pos(e.buyBelow)}%`, background: 'var(--warning)', opacity: 0.6, borderRadius: 2 }} />
        <span style={{ flex: 1, background: 'var(--surface-3)', borderRadius: '2px 4px 4px 2px' }} />
      </div>
      <i style={{ position: 'absolute', left: `${pos(e.price)}%`, top: 0, width: 4, height: 16, borderRadius: 2, background: 'var(--text)', boxShadow: '0 0 0 2px var(--surface)', transform: 'translateX(-50%)' }} />
    </div>
  );
}

function ScoreBar({ e }: { e: Entry }) {
  return (
    <div style={{ minWidth: 78 }}>
      <div className="num" style={{ fontWeight: 650 }}>
        {e.points} <span className="muted" style={{ fontWeight: 400 }}>/ {e.maxPoints}</span>
      </div>
      <div className="bar-track" style={{ height: 6, marginTop: 3 }} role="img" aria-label={`${e.points} of ${e.maxPoints} points`}>
        <div className="bar-fill" style={{ width: `${(e.points / e.maxPoints) * 100}%` }} />
      </div>
    </div>
  );
}

const mark = (a: Question['answer']) => (a === 'Yes' ? { text: '✓ Yes', cls: 'good' } : a === 'No' ? { text: '✕ No', cls: 'bad' } : { text: '? Uncertain', cls: '' });

function Detail({ e }: { e: Entry }) {
  const pillars = [...new Set(e.questions.map((q) => q.pillar))];
  return (
    <div className="top10-detail">
      <div className="top10-facts">
        <div><span className="k">How the value was estimated</span>Owner earnings {usd(e.ownerEarnings)} a share ({e.ownerEarningsBasis.toLowerCase() || 'automatic estimate'}), growing {fmtPct(e.growth1to5, 1)} for five years then {fmtPct(e.growth6to10, 1)}, discounted at {fmtPct(e.discountRate, 0)}. Buy-below is value less a {fmtPct(e.marginOfSafety, 0)} margin of safety.</div>
        <div><span className="k">More from the worksheet</span>Return on equity {fmtPct(e.metrics.avgRoe, 0)} (5-yr avg) · free cash flow positive in {e.metrics.positiveFcfYears ?? '–'} of {e.metrics.fcfYears ?? 5} years · {isNum(e.metrics.ebitToInterest) ? `EBIT covers interest ${e.metrics.ebitToInterest >= 100 ? '100x+' : times(e.metrics.ebitToInterest)}` : 'no interest figure reported'} · revenue growth {fmtPct(e.metrics.revCagr, 1)} a year · {e.metrics.quantPass} of 8 quant screens passed.</div>
        <div><span className="k">Statements</span>{e.fyLabel ?? 'Latest fiscal year'} (to {fmtDate(e.fyEnd)}), from SEC filings.{e.splitAdjusted ? ' Share counts in the scored years are restated for a stock split.' : ''}{e.shareBasisNote ? ` ${e.shareBasisNote}` : ''}{e.type === 'adr' ? ' Foreign company: where it reports in another currency, the dollar figures are its own year-end translations, so growth rates include currency moves.' : ''}</div>
      </div>
      {pillars.map((p) => (
        <div key={p} style={{ marginTop: 10 }}>
          <div className="small" style={{ fontWeight: 700, marginBottom: 4 }}>{p}</div>
          <div className="top10-answers">
            {e.questions.filter((q) => q.pillar === p).map((q) => {
              const m = mark(q.answer);
              return (
                <div key={q.id} className="top10-answer">
                  <span className={`badge ${m.cls}`}>{m.text}</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>{q.question}{q.gate ? <span className="badge warn" style={{ marginLeft: 6 }}>GATE</span> : null} <span className="muted small">weight {q.weight}</span></div>
                    <div className="small dim">{q.reason}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="row" style={{ marginTop: 12 }}>
        <Link className="btn small primary" to={`/stock/${encodeURIComponent(e.symbol)}/checklist`}>Open the full checklist</Link>
        <Link className="btn small" to={`/stock/${encodeURIComponent(e.symbol)}/valuation`}>See the valuation step by step</Link>
      </div>
    </div>
  );
}

export default function BuffettTop() {
  const { data, error, reload } = useApi<Payload>('/api/market/buffett-top?limit=10', 120000);
  const [open, setOpen] = useState<string | null>(null);
  if (error && !data) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return <Card title="Top 10 on the Buffett checklist"><Loading text="Scoring companies…" /></Card>;
  const { progress, counts } = data;
  const building = progress.total > 0 && progress.done < progress.total * 0.97;
  const screenerLink = '/screener?view=buffett&buffettRank=ranked&sort=buffettRank&dir=asc';
  const mos = (e: Entry) => (isNum(e.valueDiscount) ? (e.valueDiscount >= 0 ? `${fmtPct(e.valueDiscount, 0)} below` : `${fmtPct(-e.valueDiscount, 0)} above`) : '–');
  const toggle = (s: string) => setOpen(open === s ? null : s);

  return (
    <Card
      title="Top 10 on the Buffett checklist"
      sub={`Companies above $${data.minCap / 1e9} billion, ranked on the ${data.questionCount} checklist questions that financial data can answer (${data.maxPoints} points). Ties go to the bigger discount to intrinsic value.`}
      right={<Link className="btn small" to={screenerLink}>See all {counts.ranked.toLocaleString()} ranked</Link>}
      pad={false}
    >
      {building && (
        <div className="banner" style={{ margin: 12 }}>
          Still reading company statements from the SEC: {progress.done.toLocaleString()} of {progress.total.toLocaleString()} analysed. The ranking below is provisional until this finishes.
        </div>
      )}
      {!data.rows.length && <div className="card-pad muted">No companies have been scored yet. This fills in a few minutes after first start.</div>}

      {data.rows.length > 0 && (
        <>
          <div className="table-wrap top10-table">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>#</th>
                  <th className="left">Company</th>
                  <th className="left" title={`Points earned on the ${data.questionCount} data-answerable checklist questions`}>Checklist<br />score</th>
                  <th>Price</th>
                  <th title="Per share, from the automatic 10-year owner-earnings model">Intrinsic<br />value</th>
                  <th title="Intrinsic value less the 25% margin of safety: the most to pay">Buy<br />below</th>
                  <th className="left" title="Green: buy zone. Amber: below value but inside the margin of safety. Marker: today's price.">Price vs value</th>
                  <th title="How far the price is below (or above) intrinsic value">Margin<br />of safety</th>
                  <th title="Five-year average return on invested capital">ROIC<br />5-yr</th>
                  <th title="Normalized owner earnings per share ÷ price">Owner-earnings<br />yield</th>
                  <th title="Net debt ÷ EBITDA, latest fiscal year (0 = net cash)">Net debt /<br />EBITDA</th>
                  <th title="Free cash flow ÷ net income, latest fiscal year">FCF /<br />net income</th>
                  <th title="Change in diluted share count from the first to the last of the five fiscal years scored; negative means buybacks">Share count<br />5-yr</th>
                  <th title="Market value ÷ net income over the trailing twelve months">P/E</th>
                  <th aria-label="Details" />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((e) => (
                  <Fragment key={e.symbol}>
                    <tr onClick={() => toggle(e.symbol)} style={{ cursor: 'pointer' }}>
                      <td className="muted">{e.rank}</td>
                      <td className="left">
                        <Link to={`/stock/${encodeURIComponent(e.symbol)}/checklist`} onClick={(ev) => ev.stopPropagation()} style={{ fontWeight: 700 }}>{e.symbol}</Link>
                        {e.type === 'adr' && <span className="badge" style={{ marginLeft: 6 }} title="American depositary receipt of a foreign company">ADR</span>}
                        <div className="small dim" style={{ maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${e.name} · ${e.sector}`}>{e.name}</div>
                      </td>
                      <td className="left"><ScoreBar e={e} /></td>
                      <td>{usd(e.price)}</td>
                      <td className="strong">{usd(e.intrinsicValue)}</td>
                      <td>{usd(e.buyBelow)}</td>
                      <td className="left"><ValueBar e={e} /></td>
                      <td className="strong">{mos(e)}</td>
                      <td>{fmtPct(e.metrics.avgRoic, 0)}</td>
                      <td>{fmtPct(e.ownerEarningsYield, 1)}</td>
                      <td>{times(e.metrics.netDebtEbitda)}</td>
                      <td>{times(e.metrics.fcfToNi, 2)}</td>
                      <td>{fmtPct(e.metrics.shareChange, 1, true)}</td>
                      <td>{isNum(e.pe) ? fmtNum(e.pe, 1) : '–'}</td>
                      <td><button className="btn ghost small" aria-expanded={open === e.symbol} aria-label={`${open === e.symbol ? 'Hide' : 'Show'} answers for ${e.symbol}`} onClick={(ev) => { ev.stopPropagation(); toggle(e.symbol); }}>{open === e.symbol ? 'Hide' : 'Answers'}</button></td>
                    </tr>
                    {open === e.symbol && (
                      <tr className="top10-open"><td colSpan={15} className="left wrap" style={{ whiteSpace: 'normal' }}><Detail e={e} /></td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="top10-cards">
            {data.rows.map((e) => (
              <div key={e.symbol} className="top10-card">
                <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <span className="muted num" style={{ marginRight: 6 }}>{e.rank}</span>
                    <Link to={`/stock/${encodeURIComponent(e.symbol)}/checklist`} style={{ fontWeight: 700, fontSize: 16 }}>{e.symbol}</Link>
                    {e.type === 'adr' && <span className="badge" style={{ marginLeft: 6 }}>ADR</span>}
                    <div className="small dim" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</div>
                  </div>
                  <ScoreBar e={e} />
                </div>
                <div style={{ margin: '10px 0 4px' }}><ValueBar e={e} /></div>
                <div className="top10-grid">
                  <div><span className="k">Price</span><b className="num">{usd(e.price)}</b></div>
                  <div><span className="k">Intrinsic value</span><b className="num">{usd(e.intrinsicValue)}</b></div>
                  <div><span className="k">Buy below</span><b className="num">{usd(e.buyBelow)}</b></div>
                  <div><span className="k">Margin of safety</span><b className="num">{mos(e)}</b></div>
                  <div><span className="k">ROIC (5-yr)</span><b className="num">{fmtPct(e.metrics.avgRoic, 0)}</b></div>
                  <div><span className="k">Owner-earnings yield</span><b className="num">{fmtPct(e.ownerEarningsYield, 1)}</b></div>
                  <div><span className="k">Net debt / EBITDA</span><b className="num">{times(e.metrics.netDebtEbitda)}</b></div>
                  <div><span className="k">FCF / net income</span><b className="num">{times(e.metrics.fcfToNi, 2)}</b></div>
                  <div><span className="k">Share count, 5-yr</span><b className="num">{fmtPct(e.metrics.shareChange, 1, true)}</b></div>
                  <div><span className="k">P/E</span><b className="num">{isNum(e.pe) ? fmtNum(e.pe, 1) : '–'}</b></div>
                </div>
                <button className="btn small" style={{ marginTop: 8 }} aria-expanded={open === e.symbol} onClick={() => toggle(e.symbol)}>{open === e.symbol ? 'Hide answers' : `Show the ${e.questions.length} answers`}</button>
                {open === e.symbol && <Detail e={e} />}
              </div>
            ))}
          </div>

          <div className="card-pad" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="legend" style={{ marginBottom: 8 }}>
              <span><i className="swatch" style={{ background: 'var(--good)', opacity: 0.55 }} />Buy zone (up to the buy-below price)</span>
              <span><i className="swatch" style={{ background: 'var(--warning)', opacity: 0.6 }} />Below value, margin of safety not met</span>
              <span><i className="swatch" style={{ background: 'var(--surface-3)' }} />Above intrinsic value</span>
              <span><i style={{ display: 'inline-block', width: 4, height: 12, borderRadius: 2, background: 'var(--text)' }} />Today’s price</span>
            </div>
            <p className="note">
              Of {counts.aboveFloor.toLocaleString()} listings above ${data.minCap / 1e9} billion: {counts.financialOrRealEstate.toLocaleString()} are financial or real-estate companies (not scored), {counts.noStatements.toLocaleString()} have no US-GAAP statements to score, {counts.gateFailed.toLocaleString()} fail a required gate, {counts.noValuation.toLocaleString()} cannot be valued because owner earnings are not positive, {counts.capexUnknown.toLocaleString()} do not report capital spending in a form this app can read (so free cash flow is unknown), {(counts.shortHistory + counts.staleStatements).toLocaleString()} have too little or out-of-date history{counts.duplicateListings ? `, and ${counts.duplicateListings.toLocaleString()} are second share classes of a ranked company` : ''}. That leaves {counts.ranked.toLocaleString()} ranked companies. Market value {data.rows.length ? `of these ten ranges from ${fmtCompact(Math.min(...data.rows.map((r) => r.marketCap ?? Infinity)), '$')} to ${fmtCompact(Math.max(...data.rows.map((r) => r.marketCap ?? 0)), '$')}` : ''}.
            </p>
            <details className="method" style={{ marginTop: 8 }}>
              <summary>How this ranking works, and what it leaves out</summary>
              <ul>{data.rules.map((r) => <li key={r}>{r}</li>)}</ul>
            </details>
          </div>
        </>
      )}
    </Card>
  );
}
