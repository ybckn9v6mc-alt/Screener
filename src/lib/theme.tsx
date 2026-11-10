import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeName = 'light' | 'dark';

export interface Tokens {
  surface: string;
  surface2: string;
  text: string;
  text2: string;
  muted: string;
  grid: string;
  axis: string;
  border: string;
  accent: string;
  up: string;
  down: string;
  series: string[];
  divNeg2: string;
  divNeg1: string;
  divMid: string;
  divPos1: string;
  divPos2: string;
}

function readTokens(): Tokens {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    surface: v('--surface'),
    surface2: v('--surface-2'),
    text: v('--text'),
    text2: v('--text-2'),
    muted: v('--muted'),
    grid: v('--grid'),
    axis: v('--axis'),
    border: v('--border-strong'),
    accent: v('--accent'),
    up: v('--up-mark'),
    down: v('--down-mark'),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--s${i}`)),
    divNeg2: v('--div-neg-2'),
    divNeg1: v('--div-neg-1'),
    divMid: v('--div-mid'),
    divPos1: v('--div-pos-1'),
    divPos2: v('--div-pos-2'),
  };
}

const systemTheme = (): ThemeName => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

interface ThemeCtx {
  theme: ThemeName;
  tokens: Tokens;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(() => {
    const stamped = document.documentElement.getAttribute('data-theme');
    return stamped === 'light' || stamped === 'dark' ? stamped : systemTheme();
  });
  const [tokens, setTokens] = useState<Tokens>(readTokens);

  useEffect(() => {
    setTokens(readTokens());
  }, [theme]);

  // Follow the OS setting until the viewer picks a theme explicitly.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (!document.documentElement.getAttribute('data-theme')) setTheme(systemTheme());
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: ThemeName = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try {
        localStorage.setItem('theme', next);
      } catch {
        /* preference just will not persist */
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, tokens, toggle }), [theme, tokens, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTheme outside ThemeProvider');
  return c;
}
