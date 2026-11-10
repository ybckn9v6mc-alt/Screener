import { cached, HOUR } from '../lib/cache.ts';
import * as nasdaq from '../sources/nasdaq.ts';

/** Per-company extras fetched on demand when a stock page is opened. */
export function stockDetail(symbol: string) {
  return cached('detail', symbol, 6 * HOUR, async () => {
    const safe = <T>(p: Promise<T>) => p.catch(() => null);
    const [profile, analyst, forecast, shortInterest, institutional, insiders, dividends, surprises] = await Promise.all([
      safe(nasdaq.companyProfile(symbol)),
      safe(nasdaq.targetPrice(symbol)),
      safe(nasdaq.earningsForecast(symbol)),
      safe(nasdaq.shortInterest(symbol)),
      safe(nasdaq.institutional(symbol, 10)),
      safe(nasdaq.insiderTrades(symbol, 15)),
      safe(nasdaq.dividendHistory(symbol)),
      safe(nasdaq.earningsSurprise(symbol)),
    ]);
    return { profile, analyst, forecast, shortInterest, institutional, insiders, dividends: (dividends ?? []).slice(0, 40), surprises: surprises ?? [] };
  });
}
