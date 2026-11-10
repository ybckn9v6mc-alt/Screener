import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Works both from source (server/) and from the bundled build (dist-server/).
export const ROOT = path.resolve(here, '..');

export const config = {
  port: Number(process.env.PORT ?? 8787),
  dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data', 'cache'),
  seedDir: path.join(ROOT, 'data', 'seed'),
  /**
   * Sent with every outbound request. The SEC asks automated clients to identify
   * themselves; set SEC_USER_AGENT="Your Name you@example.com" to follow their
   * fair-access guidance when you self-host.
   */
  userAgent: process.env.HTTP_USER_AGENT ?? 'stock-screener-app/1.0',
  secUserAgent: process.env.SEC_USER_AGENT ?? process.env.HTTP_USER_AGENT ?? 'stock-screener-app/1.0',
  /** Set ENRICH=off to skip the slow per-symbol analyst / ownership crawl. */
  enrich: (process.env.ENRICH ?? 'on') !== 'off',
  /** Set LIVE_QUOTES=off to rely on end-of-day prices only (no rolling Cboe quote sweep). */
  liveQuotes: (process.env.LIVE_QUOTES ?? 'on') !== 'off',
  /** Set BACKGROUND=off to serve only what is already cached (no crawling). */
  background: (process.env.BACKGROUND ?? 'on') !== 'off',
};
