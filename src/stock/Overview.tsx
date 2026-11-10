import { Link } from 'react-router-dom';
import { fmtCompact, fmtDate, fmtNum, fmtPct, fmtPrice, fmtValue, isNum, recomLabel, signClass } from '../lib/format';
import { COLUMN_BY_KEY } from '../../shared/columns';
import type { StockRow } from '../../shared/types';
import type { Financials } from '../../shared/financials';
import { Card } from '../components/ui';
import PriceChart from './PriceChart';

export interface StockPayload {
  row: StockRow;
  quote: { price: number | null; open: number | null; high: number | null; low: number | null; prevClose: number | null; volume: number | null; iv30: number | null; lastTradeTime: string | null } | null;
  detail: {
    profile: { description: string | null; website: string | null } | null;
    analyst: { low: number | null; high: number | null; mean: number | null; buy: number; hold: number; sell: number; history: { date: string; target: number | null; consensus: string | null }[] } | null;
    forecast: { quarterly: { fiscalEnd: string; eps: number | null; high: number | null; low: number | null; n: number | null }[]; yearly: { fiscalEnd: string; eps: number | null; high: number | null; low: number | null; n: number | null }[] } | null;
    shortInterest: { settlementDate: string | null; shares: number | null; avgDailyVolume: number | null; daysToCover: number | null } | null;
    institutional: { pct: number | null; holders: number | null; sharesHeld: number | null; increasedShares: number | null; decreasedShares: number | null; top: { name: string; date: string; shares: number | null; change: number | null; changePct: number | null; value: number | null }[] } | null;
    insiders: { buys3m: number | null; sells3m: number | null; buys12m: number | null; sells12m: number | null; sharesBought12m: number | null; sharesSold12m: number | null; recent: { insider: string; relation: string; date: string; type: string; shares: number | null; price: number | null; held: number | null }[] } | null;
    dividends: { exDate: string; amount: number | null; payDate: string | null }[];
    surprises: { fiscalQtrEnd: string; dateReported: string | null; eps: number | null; consensus: number | null; surprisePct: number | null }[];
  } | null;
  entity: { cik: number; name: string; sic: string | null; sicDesc: string | null; fiscalYearEnd: string | null } | null;
  peers: { symbol: string; name: string; marketCap: number | null; industry: string }[];
  session: { date: string; open: boolean; status: string };
}

// Finviz-style snapshot: label, field (or a function of the row).
const SNAPSHOT: [string, string | ((r: StockRow) => string), string?][] = [
  ['Index', 'indexes'], ['P/E', 'pe'], ['EPS (ttm)', 'eps'], ['Insider Own', 'insiderOwn'], ['Shs Outstand', 'sharesOut'], ['Perf Week', 'perfWeek'],
  ['Market Cap', 'marketCap'], ['Forward P/E', 'fpe'], ['EPS this Y', 'epsGrowthThisYear'], ['Insider Trans', 'insiderTrans'], ['Shs Float', 'float'], ['Perf Month', 'perfMonth'],
  ['Income', 'netIncome'], ['PEG', 'peg'], ['EPS next Y', 'epsGrowthNextYear'], ['Inst Own', 'instOwn'], ['Short Float', 'shortFloat'], ['Perf Quarter', 'perfQuarter'],
  ['Sales', 'revenue'], ['P/S', 'ps'], ['EPS Q/Q', 'epsGrowthQoq'], ['Inst Trans', 'instTrans'], ['Short Ratio', 'shortRatio'], ['Perf Half Y', 'perfHalf'],
  ['Book/sh', (r) => fmtNum(r.bookPerShare, 2)], ['P/B', 'pb'], ['EPS past 3Y', 'epsGrowth3y'], ['ROA', 'roa'], ['Target Price', 'targetPrice'], ['Perf Year', 'perfYear'],
  ['Cash/sh', (r) => fmtNum(r.cashPerShare, 2)], ['P/C', 'pc'], ['EPS past 5Y', 'epsGrowth5y'], ['ROE', 'roe'], ['52W High', 'high52w'], ['Perf YTD', 'perfYtd'],
  ['Dividend', 'dividend'], ['P/FCF', 'pfcf'], ['Sales Q/Q', 'salesGrowthQoq'], ['ROIC', 'roic'], ['52W Low', 'low52w'], ['Beta', 'beta'],
  ['Dividend %', 'dividendYield'], ['EV/EBITDA', 'evEbitda'], ['Sales past 3Y', 'salesGrowth3y'], ['Gross Margin', 'grossMargin'], ['RSI (14)', 'rsi'], ['ATR (14)', 'atr'],
  ['Payout', 'payout'], ['EV/Sales', 'evSales'], ['Sales past 5Y', 'salesGrowth5y'], ['Oper. Margin', 'operMargin'], ['Rel Volume', 'relVolume'], ['Volatility W / M', (r) => `${fmtPct(r.volatilityWeek, 1)} / ${fmtPct(r.volatilityMonth, 1)}`],
  ['Div. growth', 'dividendGrowth'], ['Current Ratio', 'currentRatio'], ['Sales TTM', 'salesGrowthTtm'], ['Profit Margin', 'netMargin'], ['Avg Volume', 'avgVolume'], ['Prev Close', (r) => fmtPrice(r.prevClose)],
  ['Recom', (r) => recomLabel(r.recom)], ['Quick Ratio', 'quickRatio'], ['EPS TTM growth', 'epsGrowthTtm'], ['Debt/Eq', 'debtEq'], ['Volume', 'volume'], ['Price', 'price'],
  ['Optionable', 'optionable'], ['LT Debt/Eq', 'ltDebtEq'], ['Earnings', (r) => (r.earningsDate ? `${fmtDate(r.earningsDate)}${r.earningsTime === 'pre-market' ? ' BMO' : r.earningsTime === 'after-hours' ? ' AMC' : ''}` : '–')], ['SMA20', 'sma20'], ['SMA50', 'sma50'], ['SMA200', 'sma200'],
  ['IPO', (r) => (r.ipoDate ? fmtDate(r.ipoDate) : r.ipoYear ? String(r.ipoYear) : '–')], ['Pattern', (r) => r.pattern ?? '–'], ['Candlestick', (r) => r.candle ?? '–'], ['Gap', 'gap'], ['From Open', 'changeFromOpen'], ['Change', 'change'],
];

function Snapshot({ row }: { row: StockRow }) {
  return (
    <div className="snapshot">
      {SNAPSHOT.map(([label, src]) => {
        let text: string;
        let cls = '';
        if (typeof src === 'function') text = src(row);
        else {
          const col = COLUMN_BY_KEY.get(src);
          const v = (row as unknown as Record<string, unknown>)[src];
          text = col ? fmtValue(v, col.fmt) : String(v ?? '–');
          if (col?.signed) cls = signClass(v);
        }
        return (
          <div key={label}>
            <span className="k">{label}</span>
            <span className={`v ${cls}`}>{text}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function Overview({ data, fin }: { data: StockPayload; fin: Financials | null }) {
  const { row, detail, entity, peers } = data;
  const a = detail?.analyst;
  const votes = a ? a.buy + a.hold + a.sell : 0;
  const ins = detail?.insiders;
  const inst = detail?.institutional;
  const si = detail?.shortInterest;
  return (
    <div className="stack">
      <Card pad>
        <PriceChart symbol={row.symbol} />
      </Card>
      <Card title="Snapshot" sub={`Fundamentals as of ${row.fundamentalsAsOf ? fmtDate(row.fundamentalsAsOf) : 'n/a'} (SEC filings; income items trailing twelve months) · technicals through ${row.barsAsOf ? fmtDate(row.barsAsOf) : 'n/a'}`} pad={false}>
        <Snapshot row={row} />
      </Card>

      <div className="two-col">
        <Card title="About">
          <p style={{ whiteSpace: 'pre-line' }}>{detail?.profile?.description ?? 'No company description is available.'}</p>
          <div className="kv small" style={{ marginTop: 12 }}>
            <span className="k">Sector / industry</span><span className="v">{[row.sector, row.industry].filter(Boolean).join(' · ') || '–'}</span>
            <span className="k">Country</span><span className="v">{row.country || '–'}</span>
            {entity?.sicDesc && <><span className="k">SEC industry (SIC {entity.sic})</span><span className="v">{entity.sicDesc}</span></>}
            {entity?.fiscalYearEnd && <><span className="k">Fiscal year ends</span><span className="v">{entity.fiscalYearEnd.slice(0, 2)}/{entity.fiscalYearEnd.slice(2)}</span></>}
            {detail?.profile?.website && <><span className="k">Website</span><span className="v"><a href={detail.profile.website} target="_blank" rel="noreferrer">{detail.profile.website.replace(/^https?:\/\//, '')}</a></span></>}
          </div>
          {fin && fin.filings.length > 0 && (
            <>
              <h3 style={{ margin: '14px 0 6px' }}>Recent SEC filings</h3>
              <div className="row small" style={{ gap: '4px 14px' }}>
                {fin.filings.filter((f) => f.form !== '8-K').slice(0, 8).map((f) => <a key={f.url} href={f.url} target="_blank" rel="noreferrer">{f.form} · {f.filed}</a>)}
              </div>
            </>
          )}
        </Card>

        <Card title="Similar companies" sub="Same industry, closest in market value" right={<Link className="btn small" to={`/compare?symbols=${[row.symbol, ...peers.slice(0, 4).map((p) => p.symbol)].map(encodeURIComponent).join(',')}`}>Compare side by side</Link>} pad={false}>
          <div className="table-wrap">
            <table className="data compact">
              <thead><tr><th className="left">Ticker</th><th className="left">Company</th><th className="left">Industry</th><th>Market cap</th></tr></thead>
              <tbody>
                {peers.map((p) => (
                  <tr key={p.symbol}>
                    <td className="left strong"><Link to={`/stock/${encodeURIComponent(p.symbol)}`}>{p.symbol}</Link></td>
                    <td className="left" style={{ maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</td>
                    <td className="left" style={{ maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.industry}</td>
                    <td>{fmtCompact(p.marketCap, '$')}</td>
                  </tr>
                ))}
                {!peers.length && <tr><td className="left muted" colSpan={4}>No comparable companies found.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="two-col">
        <Card title="Analysts" sub="Consensus from Nasdaq">
          {a && votes > 0 ? (
            <>
              <div className="row" style={{ gap: 24, marginBottom: 10 }}>
                <div><div className="stat-label">Mean target</div><div className="stat-value num">${fmtPrice(a.mean)}</div><div className={`small num ${signClass(isNum(a.mean) && isNum(row.price) ? a.mean / row.price - 1 : null)}`}>{isNum(a.mean) && isNum(row.price) ? `${fmtPct(a.mean / row.price - 1, 1, true)} vs price` : ''}</div></div>
                <div><div className="stat-label">Range</div><div className="stat-value num">${fmtPrice(a.low)} – ${fmtPrice(a.high)}</div></div>
                <div><div className="stat-label">Rating</div><div className="stat-value">{recomLabel(row.recom)}</div></div>
              </div>
              <div className="meter" style={{ height: 12 }} role="img" aria-label={`${a.buy} buy, ${a.hold} hold, ${a.sell} sell`}>
                {a.buy > 0 && <span style={{ flex: a.buy, background: 'var(--up-mark)' }} />}
                {a.hold > 0 && <span style={{ flex: a.hold, background: 'var(--neutral-mark)' }} />}
                {a.sell > 0 && <span style={{ flex: a.sell, background: 'var(--down-mark)' }} />}
              </div>
              <div className="legend" style={{ marginTop: 6 }}>
                <span><i className="swatch" style={{ background: 'var(--up-mark)' }} />Buy {a.buy}</span>
                <span><i className="swatch" style={{ background: 'var(--neutral-mark)' }} />Hold {a.hold}</span>
                <span><i className="swatch" style={{ background: 'var(--down-mark)' }} />Sell {a.sell}</span>
              </div>
            </>
          ) : <span className="muted">No analyst coverage data.</span>}
          {detail?.forecast && detail.forecast.yearly.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="data compact">
                <thead><tr><th className="left">Fiscal year</th><th>EPS estimate</th><th>Low</th><th>High</th><th>Analysts</th></tr></thead>
                <tbody>{detail.forecast.yearly.map((y) => <tr key={y.fiscalEnd}><td className="left">{y.fiscalEnd}</td><td>{fmtNum(y.eps, 2)}</td><td>{fmtNum(y.low, 2)}</td><td>{fmtNum(y.high, 2)}</td><td>{y.n ?? '–'}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Earnings history" sub="Reported EPS against consensus" pad={false}>
          <div className="table-wrap">
            <table className="data compact">
              <thead><tr><th className="left">Quarter</th><th className="left">Reported</th><th>EPS</th><th>Consensus</th><th>Surprise</th></tr></thead>
              <tbody>
                {(detail?.surprises ?? []).map((s) => <tr key={s.fiscalQtrEnd}><td className="left">{s.fiscalQtrEnd}</td><td className="left">{fmtDate(s.dateReported)}</td><td>{fmtNum(s.eps, 2)}</td><td>{fmtNum(s.consensus, 2)}</td><td className={signClass(s.surprisePct)}>{isNum(s.surprisePct) ? `${s.surprisePct > 0 ? '+' : ''}${s.surprisePct.toFixed(1)}%` : '–'}</td></tr>)}
                {!(detail?.surprises ?? []).length && <tr><td className="left muted" colSpan={5}>No earnings history available.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="two-col">
        <Card title="Ownership & short interest" pad={false}>
          <div className="card-pad row" style={{ gap: 24 }}>
            <div><div className="stat-label">Institutional ownership</div><div className="stat-value num">{isNum(inst?.pct) ? `${inst!.pct!.toFixed(1)}%` : '–'}</div><div className="small muted">{inst?.holders ? `${inst.holders.toLocaleString()} holders` : ''}</div></div>
            <div><div className="stat-label">Non-affiliate float</div><div className="stat-value num">{fmtCompact(row.float)}</div><div className="small muted">{isNum(row.insiderOwn) ? `${fmtPct(row.insiderOwn, 1)} held by insiders/affiliates (est.)` : ''}</div></div>
            <div><div className="stat-label">Short interest</div><div className="stat-value num">{fmtCompact(si?.shares)}</div><div className="small muted">{isNum(row.shortFloat) ? `${fmtPct(row.shortFloat, 1)} of float · ` : ''}{isNum(si?.daysToCover) ? `${si!.daysToCover!.toFixed(1)} days to cover` : ''}{si?.settlementDate ? ` · ${fmtDate(si.settlementDate)}` : ''}</div></div>
          </div>
          <div className="table-wrap">
            <table className="data compact">
              <thead><tr><th className="left">Largest institutional holders</th><th>Shares</th><th>Change</th><th>Value</th><th className="left">As of</th></tr></thead>
              <tbody>
                {(inst?.top ?? []).map((h) => <tr key={h.name}><td className="left" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name}</td><td>{fmtCompact(h.shares)}</td><td className={signClass(h.changePct)}>{isNum(h.changePct) ? `${h.changePct > 0 ? '+' : ''}${h.changePct.toFixed(1)}%` : '–'}</td><td>{fmtCompact(h.value, '$')}</td><td className="left">{fmtDate(h.date)}</td></tr>)}
                {!(inst?.top ?? []).length && <tr><td className="left muted" colSpan={5}>No institutional holdings data.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Insider trading" sub={ins ? `Last 12 months: ${ins.buys12m ?? 0} open-market buys, ${ins.sells12m ?? 0} sells · ${fmtCompact(ins.sharesBought12m)} shares bought, ${fmtCompact(ins.sharesSold12m)} sold` : undefined} pad={false}>
          <div className="table-wrap">
            <table className="data compact">
              <thead><tr><th className="left">Insider</th><th className="left">Relation</th><th className="left">Date</th><th className="left">Transaction</th><th>Shares</th><th>Price</th></tr></thead>
              <tbody>
                {(ins?.recent ?? []).map((t, i) => <tr key={`${t.insider}-${t.date}-${i}`}><td className="left" style={{ maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.insider}</td><td className="left">{t.relation}</td><td className="left">{fmtDate(t.date)}</td><td className="left">{t.type}</td><td>{fmtCompact(t.shares)}</td><td>{isNum(t.price) && t.price > 0 ? fmtPrice(t.price) : '–'}</td></tr>)}
                {!(ins?.recent ?? []).length && <tr><td className="left muted" colSpan={6}>No insider transactions reported.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {(detail?.dividends ?? []).length > 0 && (
        <Card title="Dividend history" sub="Most recent payments" pad={false}>
          <div className="table-wrap">
            <table className="data compact">
              <thead><tr><th className="left">Ex-dividend date</th><th className="left">Paid</th><th>Amount / share</th></tr></thead>
              <tbody>{detail!.dividends.slice(0, 12).map((d) => <tr key={d.exDate}><td className="left">{fmtDate(d.exDate)}</td><td className="left">{fmtDate(d.payDate)}</td><td>{isNum(d.amount) ? `$${d.amount.toFixed(4).replace(/0{1,2}$/, '')}` : '–'}</td></tr>)}</tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
