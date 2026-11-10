import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ThemeProvider, useTheme } from './lib/theme';
import { api, useApi } from './lib/api';
import { fmtCompact } from './lib/format';
import { Loading } from './components/ui';
import type { BuildStatus } from '../shared/types';

const Home = lazy(() => import('./pages/Home'));
const Screener = lazy(() => import('./pages/Screener'));
const Stock = lazy(() => import('./pages/Stock'));
const Compare = lazy(() => import('./pages/Compare'));

interface Hit {
  symbol: string;
  name: string;
  exchange: string;
  marketCap: number | null;
}

function SymbolSearch() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const nav = useNavigate();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      api<Hit[]>(`/api/search?q=${encodeURIComponent(q)}`).then(
        (h) => {
          if (live) {
            setHits(h);
            setIdx(0);
            setOpen(true);
          }
        },
        () => undefined,
      );
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const go = (symbol: string) => {
    setQ('');
    setOpen(false);
    nav(`/stock/${encodeURIComponent(symbol)}`);
  };

  return (
    <div className="search" ref={box}>
      <input
        className="input"
        placeholder="Search ticker or company"
        aria-label="Search ticker or company"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIdx((i) => Math.min(hits.length - 1, i + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIdx((i) => Math.max(0, i - 1));
          } else if (e.key === 'Enter') {
            if (hits[idx]) go(hits[idx].symbol);
            else if (q.trim()) go(q.trim().toUpperCase());
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && hits.length > 0 && (
        <div className="search-list" role="listbox">
          {hits.map((h, i) => (
            <Link key={h.symbol} to={`/stock/${encodeURIComponent(h.symbol)}`} className={i === idx ? 'on' : ''} role="option" aria-selected={i === idx} onClick={() => go(h.symbol)}>
              <span className="sym">{h.symbol}</span>
              <span className="nm">{h.name}</span>
              <span className="muted small num" style={{ marginLeft: 'auto' }}>{fmtCompact(h.marketCap, '$')}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function DataStatus() {
  const { data } = useApi<BuildStatus & { session: { status: string; date: string } }>('/api/status', 15000);
  if (!data) return null;
  const tech = data.technicals;
  const building = !data.fundamentals.done || (tech.total > 0 && tech.done < tech.total);
  const text = !data.universe.count
    ? 'Loading market data…'
    : !data.fundamentals.done
      ? data.fundamentals.progress ?? 'Loading fundamentals…'
      : tech.total > 0 && tech.done < tech.total
        ? `Price history ${tech.done.toLocaleString()} / ${tech.total.toLocaleString()}`
        : `${data.universe.count.toLocaleString()} stocks · ${data.session.status || 'Market'}`;
  return (
    <span className="small dim row" style={{ gap: 6 }} title={data.errors.length ? data.errors.join('\n') : 'Data status'}>
      {building ? <span className="spinner" aria-hidden style={{ width: 12, height: 12 }} /> : <span className="swatch" style={{ background: 'var(--good)', borderRadius: '50%' }} aria-hidden />}
      {text}
    </span>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button className="btn ghost" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title="Switch theme">
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}

function Shell() {
  const loc = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 16 16"><path d="M1.5 11.5l4-4.5 3 2.5 6-7" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            Screener
          </Link>
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end>Markets</NavLink>
            <NavLink to="/screener">Screener</NavLink>
            <NavLink to="/compare">Compare</NavLink>
          </nav>
          <span className="grow" />
          <DataStatus />
          <SymbolSearch />
          <ThemeToggle />
        </div>
      </header>
      <main className="page">
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/screener" element={<Screener />} />
            <Route path="/stock/:symbol" element={<Stock />} />
            <Route path="/stock/:symbol/:tab" element={<Stock />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="*" element={<div className="banner">Page not found. <Link to="/">Go to Markets</Link></div>} />
          </Routes>
        </Suspense>
      </main>
      <footer className="footer">
        Data: Nasdaq (listings, quotes, analyst and ownership data), SEC EDGAR (financial statements), Cboe (index and price history, 15-minute delayed), Federal Reserve (Z.1, H.15). For research and education; not investment advice.
      </footer>
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Shell />
    </ThemeProvider>
  );
}
