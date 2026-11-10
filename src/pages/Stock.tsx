import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../lib/api';
import { deltaText, fmtCompact, fmtDate, fmtPrice, isNum, signClass } from '../lib/format';
import { ErrorNote, Loading } from '../components/ui';
import type { Financials } from '../../shared/financials';
import Overview, { type StockPayload } from '../stock/Overview';
import FinancialsTab from '../stock/FinancialsTab';
import Checklist from '../stock/Checklist';
import Valuation from '../stock/Valuation';
import { useAnalysis } from '../stock/useAnalysis';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'financials', label: 'Financials' },
  { id: 'checklist', label: 'Buffett checklist' },
  { id: 'valuation', label: 'Intrinsic value' },
];

export default function Stock() {
  const params = useParams();
  const nav = useNavigate();
  const symbol = (params.symbol ?? '').toUpperCase();
  const tab = TABS.some((t) => t.id === params.tab) ? (params.tab as string) : 'overview';
  const stock = useApi<StockPayload>(symbol ? `/api/stock/${encodeURIComponent(symbol)}` : null, 60000);
  const finApi = useApi<Financials>(symbol ? `/api/stock/${encodeURIComponent(symbol)}/financials` : null);
  // Guard against showing the previous ticker's data while a new one loads.
  const data = stock.data?.row.symbol === symbol ? stock.data : null;
  const fin = finApi.data && data && finApi.data.cik === data.row.cik ? finApi.data : null;
  const analysis = useAnalysis(symbol, data?.row ?? null, fin);

  if (stock.error && !data) {
    return (
      <div className="stack">
        <ErrorNote message={stock.error} onRetry={stock.reload} />
        <p className="dim">Only US-listed common stocks and ADRs are covered. Try the <Link to="/screener">screener</Link> or search for another ticker.</p>
      </div>
    );
  }
  if (!data) return <Loading text={`Loading ${symbol}…`} />;
  const r = data.row;
  const pct = isNum(r.change) ? r.change * 100 : null;
  const v = analysis.result;

  return (
    <div className="stack">
      <div className="row between" style={{ alignItems: 'flex-end' }}>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
            <h1 style={{ fontSize: 26 }}>{r.symbol}</h1>
            <span style={{ fontSize: 17, fontWeight: 600 }}>{r.name}</span>
          </div>
          <div className="small dim" style={{ marginTop: 2 }}>
            {[r.exchange, r.sector && <Link key="s" to={`/screener?sector=${encodeURIComponent(r.sector)}`}>{r.sector}</Link>, r.industry && <Link key="i" to={`/screener?industry=${encodeURIComponent(r.industry)}`}>{r.industry}</Link>, r.country, r.type === 'adr' ? 'ADR' : null].filter(Boolean).map((x, i) => <span key={i}>{i > 0 ? ' · ' : ''}{x}</span>)}
          </div>
        </div>
        <div className="row" style={{ gap: 22, alignItems: 'flex-end' }}>
          <div style={{ textAlign: 'right' }}>
            <div className="row" style={{ alignItems: 'baseline', gap: 10, justifyContent: 'flex-end' }}>
              <span style={{ fontSize: 28, fontWeight: 650 }}>${fmtPrice(r.price)}</span>
              <span className={`num ${signClass(pct)}`} style={{ fontSize: 16, fontWeight: 650 }}>{deltaText(pct)}</span>
            </div>
            <div className="small muted">{data.quote?.lastTradeTime ? `${fmtDate(data.quote.lastTradeTime)} ${data.quote.lastTradeTime.slice(11, 16)} ET · delayed` : data.session.status} · Market cap {fmtCompact(r.marketCap, '$')}</div>
          </div>
          <Link className="btn" to={`/compare?symbols=${[r.symbol, ...data.peers.slice(0, 3).map((p) => p.symbol)].map(encodeURIComponent).join(',')}`}>Compare with peers</Link>
        </div>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <Link to={`/stock/${encodeURIComponent(symbol)}/checklist`} className={`chip`} style={{ color: 'inherit' }}>
          Checklist: <b>{analysis.verdict.label}</b>
        </Link>
        <Link to={`/stock/${encodeURIComponent(symbol)}/valuation`} className="chip" style={{ color: 'inherit' }}>
          Intrinsic value: <b className="num">{isNum(v.intrinsicValue) ? `$${fmtPrice(v.intrinsicValue)}` : 'needs input'}</b>
          {isNum(v.buyBelow) && <> · buy below <b className="num">${fmtPrice(v.buyBelow)}</b></>}
          {isNum(v.discountToValue) && <> · price is <b className="num">{Math.abs(v.discountToValue * 100).toFixed(0)}% {v.discountToValue >= 0 ? 'below' : 'above'}</b> value</>}
        </Link>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => nav(`/stock/${encodeURIComponent(symbol)}${t.id === 'overview' ? '' : `/${t.id}`}`, { replace: true })}>{t.label}</button>
        ))}
      </div>

      {tab === 'overview' && <Overview data={data} fin={fin} />}
      {tab === 'financials' && (fin ? <FinancialsTab fin={fin} /> : finApi.error ? <ErrorNote message={finApi.error} /> : <Loading text="Loading financial statements from SEC filings…" />)}
      {tab === 'checklist' && (finApi.loading && !fin && !finApi.error ? <Loading text="Loading financial statements from SEC filings…" /> : <Checklist a={analysis} symbol={symbol} fin={fin} finError={finApi.error} />)}
      {tab === 'valuation' && (finApi.loading && !fin && !finApi.error ? <Loading text="Loading financial statements from SEC filings…" /> : <Valuation a={analysis} symbol={symbol} finError={finApi.error} />)}
    </div>
  );
}
