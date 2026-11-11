# Stock Screener

A self-hosted, Finviz-style research app for US-listed stocks, built entirely on
public data: a market dashboard, a 75-filter screener, deep company pages, a
Buffett-style quality checklist and an automatic intrinsic-value calculator.

No API keys are needed.

## What it does

| Area | What you get |
|---|---|
| **Markets** (home) | Index board with a chart for every index: S&P 500, Dow, Nasdaq Composite, Nasdaq-100, Russell 2000, VIX, the MSCI world indexes and 15 countries, plus rates, gold, oil, the dollar and bitcoin. One range switch (1D to 5Y) drives every chart. |
| **Sentiment & valuation** | A Fear & Greed index with its seven components and history back to 1991, and the Buffett Indicator (US market value / GDP) with history back to 1946 against its long-run trend. |
| **Top 10 on the Buffett checklist** | Every non-financial company above $2 billion is scored on the 14 checklist questions that financial data can answer (34 points), using the same code as its own checklist page. The ten highest are listed with price, intrinsic value, buy-below price, margin of safety, ROIC, owner-earnings yield, leverage, cash conversion and share-count change; each row opens to show every answer and the reasoning. |
| **Compare lab** | Put the S&P 500 next to Fear & Greed, the Buffett Indicator, VIX, Treasury yields, the yield curve, world indexes or any ticker. Stacked panels on a shared time axis, indexed to 100, or standardized; correlation readout and data table. |
| **Screener** | Every US-listed common stock and ADR (about 5,900). 75 filters in Finviz's Descriptive / Fundamental / Technical layout, each with presets and custom ranges, including checklist score and price versus intrinsic value. Views: Overview, Valuation, Financial, Ownership, Performance, Buffett, Technical, Custom columns and Charts. Signals, saved screens, sorting, CSV export, shareable URLs. |
| **Company page** | Interactive price chart (candles/line/area, daily/weekly/monthly, 1D to max, SMA/EMA/Bollinger, volume, RSI, MACD, log scale, performance comparison), a Finviz-style snapshot, analysts, earnings history, ownership, insiders, dividends and SEC filing links. |
| **Financials** | Up to 12 years annual and 16 quarters from SEC filings: income statement, cash flow, balance sheet, per-share figures and ratios. Tick any row to chart it. |
| **Buffett checklist** | The 34 questions, 8 required gates, weights, 8 quant tests and 5-year worksheet from the Buffett Investment Qualification Checklist workbook. Questions that numbers can answer are answered automatically with the reasoning shown; judgment questions are left to you with supporting facts and where to verify. Your answers, evidence and thesis are saved per ticker in your browser. |
| **Intrinsic value** | The workbook's 10-year, two-stage owner-earnings model, filled in automatically and fully editable. Shows every step, the margin-of-safety calculation, buy-below price, stress tests, a sensitivity grid, the growth the market is pricing in and two cross-checks. |
| **Compare companies** | Up to eight companies side by side, with one-click "similar companies" (same industry, closest in size): relative performance, ~45 metrics, rankings and financial history. |

## Run it

Requires Node.js 20 or newer.

```bash
npm install
npm run build
npm start            # http://localhost:8787
```

For development, `npm run dev` runs the API (port 8787) and the Vite dev server
(port 5173) together. `npm test` runs the unit tests and `npm run typecheck`
checks both the client and the server.

With Docker:

```bash
docker build -t stock-screener .
docker run -p 8787:8787 -v screener-data:/app/data/cache stock-screener
```

### First start

Data is collected in the background and cached under `data/cache/`, so the app is
usable while it fills in:

| Layer | Source | First run | Refresh |
|---|---|---|---|
| Listings, market value, sector, country | Nasdaq | seconds | every 20 minutes |
| Fundamentals for ~4,900 companies | SEC EDGAR (about 570 requests) | 1-2 minutes | daily |
| Price history and technicals | Nasdaq (one request per stock) | about 7 minutes | daily |
| Live prices during the session | Nasdaq batch quotes | about 1 minute per pass | every 3 minutes while the market is open |
| Checklist scores for ~1,450 larger companies | SEC EDGAR (one request per company) | about 3 minutes | when a company reports new results |
| Analyst, short-interest and ownership data | Nasdaq (six requests per stock) | several hours, largest companies first | weekly |

A stock page refreshes that company's analyst and ownership data immediately,
whatever the background crawl has reached.

### Settings (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | Port to listen on |
| `SEC_USER_AGENT` | `stock-screener-app/1.0` | The SEC asks automated clients to identify themselves. Set this to `Your Name you@example.com` when you self-host. |
| `ENRICH` | `on` | `off` skips the slow analyst/ownership crawl |
| `LIVE_QUOTES` | `on` | `off` uses end-of-day prices only |
| `BACKGROUND` | `on` | `off` serves only what is already cached |
| `DATA_DIR` | `data/cache` | Where cached data is kept |
| `NODE_USE_ENV_PROXY` | – | Set to `1` if outbound traffic must go through `HTTPS_PROXY` |

## Where the data comes from

| Source | Used for |
|---|---|
| **Nasdaq** (`api.nasdaq.com`) | US listings, quotes, daily price history, earnings calendar, analyst targets and estimates, short interest, institutional holders, insider trades, dividends |
| **SEC EDGAR** (`data.sec.gov`) | Financial statements: the XBRL "frames" API for the whole universe at once, and each company's full filing history for its own page |
| **Cboe** (`cdn-api.cboe.com`) | Index levels and history (S&P 500 from 1975, VIX from 1990), intraday index charts, long price history for stock charts (15-minute delayed) |
| **Federal Reserve** | Z.1 Financial Accounts (market value of US equities, GDP) and H.15 Treasury yields |
| **Wikipedia** | S&P 500 and Dow constituents |

The app identifies itself honestly to every source, paces its requests per host,
and backs off when a host asks it to slow down.

## Things worth knowing

These are the places where the app deliberately differs from what you might assume.

- **International indexes are country funds.** Local index levels such as the
  Nikkei 225, DAX or FTSE 100 are not published by any open source that permits
  automated access, so each country is shown through its US-listed iShares MSCI
  fund, in dollars. The MSCI World, ACWI, EAFE and Emerging Markets cards are
  real index levels.
- **Fear & Greed is computed here.** CNN does not offer its index for automated
  use, so the app calculates one with the seven-indicator method CNN describes.
  Three inputs (NYSE highs/lows, the McClellan summation, the put/call ratio) are
  not freely available and use public stand-ins, each explained in the app. It
  tracks CNN's number but will not equal it.
- **Fundamentals cover US-GAAP filers.** Companies that report to the SEC under
  IFRS (many foreign ADRs) have no fundamentals here. Income items are trailing
  twelve months; cash-flow items use the latest fiscal year, because quarterly
  filings report cash flow year-to-date.
- **The Top 10 ranks a data-only score.** Twenty of the checklist's 34 questions
  (understanding the business, the moat, management, governance) need your
  judgment and are not scored, so the list is a shortlist for research, not a
  verdict. Financial and real-estate companies are left out, as the workbook
  treats them as specialist cases, and a company is dropped if the data answers
  No to a required gate.
- **Missing data is never treated as good news.** Companies describe capital
  spending and debt with dozens of different XBRL captions, and a later filing
  often re-presents an earlier year under different ones. The app therefore
  reads captions one filing at a time and never adds one filing's presentation
  to another's.
  - *Capital spending* is the sum of the cash-flow lines a filing tags
    (property and equipment, oil-and-gas additions, rental equipment,
    capitalized software and other purchased intangibles) or its stated total,
    whichever is larger. This is wider than the "purchases of property and
    equipment" line some data sites use, so free cash flow here can be lower.
  - *Debt* is read several independent ways (the balance-sheet captions, a
    stated total, the instruments, the debt note). A reading is used when it
    is complete by construction or when a second reading agrees with it, and
    never when it exceeds total liabilities. Operating leases are listed but
    not counted as debt.
  - When a figure cannot be read, or the one read is contradicted (an interest
    bill far too large for the debt shown; debt that vanishes from a quarterly
    report with no sign of repayment), the result is blank rather than zero.
    Free cash flow is never shown as equal to operating cash flow, a company
    that pays interest is never shown as debt-free, and blanks earn no
    checklist points and no place in the Top 10.
- **Only a company's own periodic reports are read** (10-K, 10-Q, 20-F, 40-F,
  6-K and the registration statement of a new listing). Proxy statements and
  current reports also carry XBRL, sometimes in other units and sometimes
  another company's statements.
- **Stock splits are restated.** SEC filings never restate years before a split,
  which would make share counts jump and EPS collapse. The app reads the split
  from the comparative figures in the company's later filings and puts every
  year on today's share basis. Where the share count in the filings does not
  match the listed share (Berkshire B, ADRs), per-share values use market value
  divided by price instead, and the page says so.
- **Sector and industry names are Nasdaq's**, not the ones Finviz uses.
- **Estimated fields are labeled.** Russell 2000 membership is licensed data and
  is approximated (US companies ranked 1,001-3,000 by market value). Float and
  insider ownership are derived from the public float each company reports on
  its annual report cover. Chart patterns are detected by a heuristic.
- **Gap, change-from-open and candlestick** describe the latest completed daily
  bar, which Nasdaq publishes after the close.
- **A blank means "not available"**, and a stock with a blank never passes a
  filter on that field.
- **Automatic valuations are conservative starting points.** The default
  owner-earnings figure is the lowest of the three-year-average, latest-year and
  trailing-twelve-month figures for free cash flow and owner earnings, so it can
  sit well below reported earnings. Growth for years 1-5 is three-quarters of
  the most cautious reading of the last five years (never above revenue growth,
  zero if revenue fell in the latest year, capped at 10%). Return on invested
  capital taxes operating income at 15-35% whatever the year's actual rate and
  is capped at 100%. Override any input; the page shows its working.
- **Holding-company reorganizations** give a company a new SEC registrant with
  no history. The link to the old registrant is not published in a
  machine-readable form, so known cases (currently Exxon Mobil) are listed in
  `server/sources/sec.ts`.

## Layout

```
server/            Express API and background data collection
  sources/         One module per data source (nasdaq, sec, cboe, fed)
  market/          Index board, Fear & Greed, Buffett Indicator, series registry
  universe/        Universe build: fundamentals, technicals, live quotes, membership
  company/         Per-company financial statements, checklist ranking and detail
shared/            Logic used by both sides: filters, columns, checklist, valuation, analysis, caption reading
src/               React client (pages, stock tabs, chart components)
tests/             Unit tests for the valuation model, checklist scoring, statements, filters, indicators
data/seed/         Ticker-to-SEC-filer map so the first start skips a 15-minute crawl
```

## Disclaimer

For research and education. Nothing here is investment advice. Data can be
delayed, incomplete or wrong; check the original filings before acting on it. The
checklist is an analyst scorecard, not something published or endorsed by Warren
Buffett, and a "qualifies" label is a prompt for deeper research, not a buy signal.
