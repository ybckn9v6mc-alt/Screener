import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { useTheme } from '../lib/theme';
import { fmtNum, fmtPct, isNum } from '../lib/format';
import EChart, { chrome } from '../components/EChart';
import { Card } from '../components/ui';
import { earningsPowerValue, grahamValue, impliedGrowth, sensitivity, stressTests, type DcfInputs } from '../../shared/valuation';
import type { Analysis } from './useAnalysis';

const usd = (v: number | null | undefined) => (isNum(v) ? `$${fmtNum(v, 2)}` : '–');

function NumField({ label, why, value, onChange, percent, step, auto, onReset }: { label: string; why?: string; value: number | null; onChange: (v: number | null) => void; percent?: boolean; step?: number; auto?: boolean; onReset?: () => void }) {
  const shown = value == null ? '' : percent ? String(Math.round(value * 10000) / 100) : String(Math.round(value * 100) / 100);
  return (
    <div className="field">
      <label>
        <span style={{ fontWeight: 600 }}>{label}</span>{' '}
        {auto ? <span className="badge info">Auto</span> : onReset && <button className="btn ghost small" onClick={onReset} title="Return to the automatic value">Reset</button>}
      </label>
      <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
        <input className="input num" type="number" inputMode="decimal" step={step ?? (percent ? 0.5 : 0.01)} value={shown} aria-label={label}
          onChange={(e) => { const n = e.target.value === '' ? null : Number(e.target.value); onChange(n == null || !Number.isFinite(n) ? null : percent ? n / 100 : n); }} />
        <span className="muted small" style={{ width: 14 }}>{percent ? '%' : '$'}</span>
      </span>
      {why && <div className="why">{why}</div>}
    </div>
  );
}

export default function Valuation({ a, symbol, finError }: { a: Analysis; symbol: string; finError?: string | null }) {
  const { tokens } = useTheme();
  const { inputs, result, defaults, overrides, setOverrides } = a;
  const set = (k: keyof DcfInputs, v: number | null) => setOverrides({ ...overrides, [k]: v as never });
  const reset = (k: keyof DcfInputs) => { const next = { ...overrides }; delete next[k]; setOverrides(next); };
  const isAuto = (k: keyof DcfInputs) => !(k in overrides);

  const stress = useMemo(() => (result.valid ? stressTests(inputs) : []), [inputs, result.valid]);
  const implied = useMemo(() => impliedGrowth(inputs), [inputs]);
  const grid = useMemo(() => {
    if (!result.valid) return null;
    const rates = [-0.02, -0.01, 0, 0.01, 0.02].map((d) => Math.round((inputs.discountRate + d) * 1000) / 1000).filter((r) => r > inputs.terminalGrowth + 0.005);
    const growths = [-0.04, -0.02, 0, 0.02, 0.04].map((d) => Math.round((inputs.growth1to5 + d) * 1000) / 1000);
    return sensitivity(inputs, rates, growths);
  }, [inputs, result.valid]);
  const epv = earningsPowerValue(inputs.ownerEarnings, inputs.discountRate);
  const graham = grahamValue(defaults?.eps ?? null, inputs.growth1to5 * 100, 4.4);

  const chart = useMemo<EChartsOption | null>(() => {
    if (!result.valid) return null;
    const base = chrome(tokens);
    return {
      ...base,
      grid: { left: 52, right: 12, top: 34, bottom: 26 },
      legend: { ...base.legendBase, icon: 'rect', itemHeight: 8, itemWidth: 10 },
      tooltip: { ...base.tooltip, valueFormatter: (v) => usd(v as number) },
      xAxis: { ...base.xAxis, type: 'category', data: result.years.map((y) => `Y${y.year}`) },
      yAxis: { ...base.yAxis, type: 'value', axisLabel: { ...base.yAxis.axisLabel, formatter: '${value}' } },
      series: [
        { name: 'Owner earnings per share', type: 'bar', data: result.years.map((y) => +y.ownerEarnings.toFixed(2)), barMaxWidth: 18, barGap: '15%', itemStyle: { color: tokens.series[0], borderRadius: [4, 4, 0, 0] } },
        { name: 'Present value today', type: 'bar', data: result.years.map((y) => +y.presentValue.toFixed(2)), barMaxWidth: 18, itemStyle: { color: tokens.series[1], borderRadius: [4, 4, 0, 0] } },
      ],
    };
  }, [result, tokens]);

  const price = inputs.price;
  const zone = result.status === 'AT / BELOW BUY ZONE' ? 'good' : result.status === 'ABOVE BUY ZONE' ? 'warn' : 'neutral';
  // Where the price sits relative to buy-below and intrinsic value, on one scale.
  const scaleMax = result.valid ? Math.max(result.intrinsicValue as number, price ?? 0) * 1.15 : 1;
  const pos = (v: number) => `${Math.min(100, Math.max(0, (v / scaleMax) * 100))}%`;

  return (
    <div className="stack">
      {a.specialist && (
        <div className="banner warn">
          {symbol} is a financial or real-estate company. This generic owner-earnings model is not appropriate on its own for banks, insurers or REITs — capital ratios, reserving, credit quality or FFO/AFFO matter more. Treat the numbers below as illustration only.
        </div>
      )}
      {finError && <div className="banner warn">{finError} Nothing can be filled in automatically; enter your own normalized owner-earnings figure and growth assumptions to use the model.</div>}
      <div className={`verdict ${zone}`}>
        <div className="row between">
          <div>
            <div className="stat-label">Valuation status</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{result.status}</div>
          </div>
          <div className="row" style={{ gap: 28 }}>
            <div><div className="stat-label">Intrinsic value / share</div><div className="stat-value num">{usd(result.intrinsicValue)}</div></div>
            <div><div className="stat-label">Buy-below price ({fmtPct(inputs.marginOfSafety, 0)} margin)</div><div className="stat-value num">{usd(result.buyBelow)}</div></div>
            <div><div className="stat-label">Market price</div><div className="stat-value num">{usd(price)}</div></div>
            <div><div className="stat-label">Price vs intrinsic value</div><div className="stat-value num">{isNum(result.discountToValue) ? (result.discountToValue >= 0 ? `${fmtPct(result.discountToValue, 0)} below` : `${fmtPct(-result.discountToValue, 0)} above`) : '–'}</div></div>
          </div>
        </div>
        {result.valid && isNum(price) && (
          <div style={{ marginTop: 18, position: 'relative', height: 44 }} role="img" aria-label={`Price ${usd(price)}, buy-below ${usd(result.buyBelow)}, intrinsic value ${usd(result.intrinsicValue)}`}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 4, height: 10, borderRadius: 5, display: 'flex', gap: 2 }}>
              <span style={{ width: pos(result.buyBelow as number), background: 'var(--good)', opacity: 0.55, borderRadius: '5px 2px 2px 5px' }} />
              <span style={{ width: `calc(${pos(result.intrinsicValue as number)} - ${pos(result.buyBelow as number)})`, background: 'var(--warning)', opacity: 0.6, borderRadius: 2 }} />
              <span style={{ flex: 1, background: 'var(--surface-3)', borderRadius: '2px 5px 5px 2px' }} />
            </div>
            <i className="pin" style={{ position: 'absolute', left: pos(price), top: 0, width: 4, height: 18, borderRadius: 2, background: 'var(--text)', boxShadow: '0 0 0 2px var(--surface)', transform: 'translateX(-50%)' }} />
            <div className="small" style={{ position: 'absolute', top: 22, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', color: 'var(--text-2)' }}>
              <span><i className="swatch" style={{ background: 'var(--good)', opacity: 0.55 }} /> Buy zone (to {usd(result.buyBelow)})</span>
              <span><i className="swatch" style={{ background: 'var(--warning)', opacity: 0.6 }} /> Margin of safety not met (to {usd(result.intrinsicValue)})</span>
              <span><i className="swatch" style={{ background: 'var(--surface-3)' }} /> Above intrinsic value</span>
              <span>▮ Price {usd(price)}</span>
            </div>
          </div>
        )}
        {!result.valid && <p className="note" style={{ marginTop: 8 }}>{result.safetyCheck === 'INVALID: DISCOUNT ≤ TERMINAL' ? 'The discount rate must be higher than perpetual growth.' : defaults?.ownerEarningsWhy ?? 'Enter a positive normalized owner-earnings figure to run the model.'}</p>}
      </div>

      <div className="two-col">
        <Card title="1 · Inputs" sub="Every figure can be overridden. Automatic values are a conservative starting point, not a forecast.">
          <NumField label="Current market price" value={inputs.price} onChange={(v) => set('price', v)} auto={isAuto('price')} onReset={() => reset('price')} why="Latest delayed quote. Override to test another entry price." />
          <NumField label="Normalized owner earnings per share" value={inputs.ownerEarnings} onChange={(v) => set('ownerEarnings', v)} auto={isAuto('ownerEarnings')} onReset={() => reset('ownerEarnings')} why={defaults?.ownerEarningsWhy} />
          {defaults && (
            <div style={{ padding: '6px 0 10px', borderBottom: '1px solid var(--border)' }}>
              <div className="small dim" style={{ marginBottom: 4 }}>Choose a different basis:</div>
              <div className="row" style={{ gap: 6 }}>
                {defaults.options.map((o) => (
                  <button key={o.id} className="btn small" disabled={!isNum(o.value)} title={o.how} aria-pressed={isNum(o.value) && inputs.ownerEarnings === Math.round(o.value * 100) / 100} onClick={() => isNum(o.value) && set('ownerEarnings', Math.round(o.value * 100) / 100)}>
                    {o.label}: <b className="num">{usd(o.value)}</b>
                  </button>
                ))}
              </div>
            </div>
          )}
          <NumField label="Growth in owner earnings, years 1–5" percent value={inputs.growth1to5} onChange={(v) => set('growth1to5', v ?? 0)} auto={isAuto('growth1to5')} onReset={() => reset('growth1to5')} why={defaults ? `${defaults.growthWhy} History: ${defaults.history.map((h) => `${h.label} ${fmtPct(h.value, 1)}`).join(' · ')}.` : undefined} />
          <NumField label="Growth in owner earnings, years 6–10" percent value={inputs.growth6to10} onChange={(v) => set('growth6to10', v ?? 0)} auto={isAuto('growth6to10')} onReset={() => reset('growth6to10')} why="Fade growth; avoid extrapolating exceptional periods." />
          <NumField label="Perpetual growth after year 10" percent value={inputs.terminalGrowth} onChange={(v) => set('terminalGrowth', v ?? 0)} auto={isAuto('terminalGrowth')} onReset={() => reset('terminalGrowth')} why="Keep below the discount rate and economically defensible (roughly long-run inflation)." />
          <NumField label="Equity discount rate / required return" percent value={inputs.discountRate} onChange={(v) => set('discountRate', v ?? 0)} auto={isAuto('discountRate')} onReset={() => reset('discountRate')} why="The return you require for owning this business, not a guaranteed market return." />
          <NumField label="Required margin of safety" percent step={5} value={inputs.marginOfSafety} onChange={(v) => set('marginOfSafety', v ?? 0)} auto={isAuto('marginOfSafety')} onReset={() => reset('marginOfSafety')} why="The cushion between value and the most you will pay. Use more when estimates are unreliable." />
          <div className="row between" style={{ marginTop: 10 }}>
            <span className="small">Assumption safety check: <b>{result.safetyCheck}</b></span>
            <button className="btn small" onClick={() => setOverrides({})} disabled={!Object.keys(overrides).length}>Reset all to automatic</button>
          </div>
        </Card>

        <Card title="2 · How the value is built" sub="A 10-year, two-stage owner-earnings model per share. Net debt is not subtracted: owner earnings are already after financing.">
          <div className="steps">
            <div className="step"><div><b>Project owner earnings for 10 years.</b><div className="formula">{`Years 1–5:  OE(t) = OE(t−1) × (1 + ${fmtPct(inputs.growth1to5, 1)})\nYears 6–10: OE(t) = OE(t−1) × (1 + ${fmtPct(inputs.growth6to10, 1)})\nStarting from ${usd(inputs.ownerEarnings)} per share`}</div></div></div>
            <div className="step"><div><b>Discount each year back to today.</b><div className="formula">{`PV(t) = OE(t) ÷ (1 + ${fmtPct(inputs.discountRate, 1)})^t\nSum of years 1–10 = ${usd(result.pvYears)}`}</div></div></div>
            <div className="step"><div><b>Add the value of everything after year 10.</b><div className="formula">{`Terminal value = OE(10) × (1 + ${fmtPct(inputs.terminalGrowth, 1)}) ÷ (${fmtPct(inputs.discountRate, 1)} − ${fmtPct(inputs.terminalGrowth, 1)}) = ${usd(result.terminalValue)}\nPV of terminal value = ${usd(result.terminalValue)} ÷ (1 + ${fmtPct(inputs.discountRate, 1)})^10 = ${usd(result.pvTerminal)}`}</div></div></div>
            <div className="step"><div><b>Intrinsic value per share.</b><div className="formula">{`${usd(result.pvYears)} + ${usd(result.pvTerminal)} = ${usd(result.intrinsicValue)}`}</div></div></div>
            <div className="step"><div><b>Apply the margin of safety.</b><div className="formula">{`Buy-below price = ${usd(result.intrinsicValue)} × (1 − ${fmtPct(inputs.marginOfSafety, 0)}) = ${usd(result.buyBelow)}\nMargin of safety at today's price = 1 − ${usd(price)} ÷ ${usd(result.intrinsicValue)} = ${isNum(result.discountToValue) ? fmtPct(result.discountToValue, 1) : '–'}\nUpside to intrinsic value = ${isNum(result.upside) ? fmtPct(result.upside, 1, true) : '–'}`}</div></div></div>
          </div>
          {isNum(result.terminalShare) && (
            <p className="note" style={{ marginTop: 10 }}>
              {fmtPct(result.terminalShare, 0)} of the value comes from the period after year 10{result.terminalShare > 0.7 ? ' — the residual dominates, so small changes in the terminal assumptions move the answer a lot.' : '.'}
            </p>
          )}
        </Card>
      </div>

      {result.valid && chart && (
        <div className="two-col">
          <Card title="3 · Year-by-year cash flows">
            <EChart option={chart} height={220} ariaLabel="Projected owner earnings per share and their present value, years 1 to 10" />
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="data compact">
                <thead><tr><th className="left">Year</th><th>Growth</th><th>Owner earnings / share</th><th>Discount factor</th><th>Present value</th></tr></thead>
                <tbody>
                  {result.years.map((y) => <tr key={y.year}><td className="left">{y.year}</td><td>{fmtPct(y.growth, 1)}</td><td>{usd(y.ownerEarnings)}</td><td>{y.discountFactor.toFixed(4)}</td><td>{usd(y.presentValue)}</td></tr>)}
                  <tr className="strong"><td className="left" colSpan={4}>PV of years 1–10</td><td>{usd(result.pvYears)}</td></tr>
                  <tr><td className="left" colSpan={4}>Terminal value at year 10 ({usd(result.terminalValue)}) discounted</td><td>{usd(result.pvTerminal)}</td></tr>
                  <tr className="strong"><td className="left" colSpan={4}>Intrinsic value per share</td><td>{usd(result.intrinsicValue)}</td></tr>
                </tbody>
              </table>
            </div>
          </Card>
          <div className="stack">
            <Card title="4 · Stress tests" sub="Does the thesis survive a less-than-perfect outcome? If not, demand a larger margin.">
              <div className="table-wrap">
                <table className="data compact">
                  <thead><tr><th className="left">Scenario</th><th>Intrinsic value</th><th>vs price</th><th className="left">Still above price?</th></tr></thead>
                  <tbody>
                    {stress.map((s) => (
                      <tr key={s.label}>
                        <td className="left wrap"><b>{s.label}</b><div className="small muted">{s.detail}</div></td>
                        <td>{usd(s.value)}</td>
                        <td>{isNum(s.value) && isNum(price) ? fmtPct(s.value / price - 1, 0, true) : '–'}</td>
                        <td className="left">{s.holds == null ? '–' : <span className={`badge ${s.holds ? 'good' : 'bad'}`}>{s.holds ? '✓ Yes' : '✕ No'}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            {grid && (
              <Card title="5 · Sensitivity" sub="Intrinsic value per share for other discount rates (across) and years 1–5 growth rates (down).">
                <div className="table-wrap">
                  <table className="data compact">
                    <thead><tr><th className="left">Growth ↓ / Discount →</th>{grid.rates.map((r) => <th key={r}>{fmtPct(r, 1)}</th>)}</tr></thead>
                    <tbody>
                      {grid.growths.map((g, gi) => (
                        <tr key={g}>
                          <td className="left strong">{fmtPct(g, 1)}</td>
                          {grid.rates.map((r, ri) => {
                            const v = grid.values[gi][ri];
                            const now = Math.abs(r - inputs.discountRate) < 1e-9 && Math.abs(g - inputs.growth1to5) < 1e-9;
                            const cls = isNum(v) && isNum(price) ? (v * (1 - inputs.marginOfSafety) >= price ? 'heat-hi' : v < price ? 'heat-lo' : '') : '';
                            return <td key={r} className={`${cls} ${now ? 'heat-now' : ''}`}>{usd(v)}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="note" style={{ marginTop: 6 }}>Shaded green: price is inside the buy zone at those assumptions. Shaded red: value is below today’s price. Outlined: your current inputs.</p>
              </Card>
            )}
          </div>
        </div>
      )}

      <Card title="6 · Cross-checks" sub="Other lenses on the same business. None of them replaces judgment.">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th className="left">Method</th><th>Value / share</th><th>vs price</th><th className="left">How it is calculated</th></tr></thead>
            <tbody>
              <tr><td className="left strong">Owner-earnings model (above)</td><td>{usd(result.intrinsicValue)}</td><td>{isNum(result.upside) ? fmtPct(result.upside, 0, true) : '–'}</td><td className="left wrap small">10 years of projected owner earnings plus a terminal value, discounted at {fmtPct(inputs.discountRate, 1)}.</td></tr>
              <tr><td className="left strong">Earnings power value (no growth)</td><td>{usd(epv)}</td><td>{isNum(epv) && isNum(price) ? fmtPct(epv / price - 1, 0, true) : '–'}</td><td className="left wrap small">Owner earnings ÷ discount rate: what the business is worth if it never grows again.</td></tr>
              <tr><td className="left strong">Graham formula</td><td>{usd(graham)}</td><td>{isNum(graham) && isNum(price) ? fmtPct(graham / price - 1, 0, true) : '–'}</td><td className="left wrap small">EPS × (8.5 + 2g) with g = years 1–5 growth (capped at 15). Uses reported EPS of {usd(defaults?.eps)}; shown without Graham’s bond-yield adjustment.</td></tr>
              <tr><td className="left strong">Growth the market is pricing in</td><td>{isNum(implied) ? fmtPct(implied, 1) : '–'}</td><td>–</td><td className="left wrap small">The years 1–5 growth rate (fading afterwards) at which this model’s value equals today’s price. Compare it with what the business has actually delivered{defaults ? `: ${defaults.history.map((h) => `${h.label} ${fmtPct(h.value, 1)}`).join(', ')}` : ''}.</td></tr>
            </tbody>
          </table>
        </div>
      </Card>

      <details className="method card card-pad">
        <summary>Model limitations</summary>
        <ul>
          <li><b>Earnings proxy.</b> Cash from operations minus all capex is not true owner earnings. Adjust for maintenance capex, working capital, stock compensation and cyclicality.</li>
          <li><b>Equity basis.</b> Inputs are per-share cash flows available to owners after financing. Do not subtract net debt again.</li>
          <li><b>Residual dominates.</b> The terminal value can dominate the model; change the assumptions and record your downside case.</li>
          <li><b>Margin of safety.</b> The buy-below price already includes the required margin; a discount to value is not a forecast of return.</li>
          <li><b>Sector exception.</b> The model is not appropriate by itself for banks, insurers, REITs or companies with structurally negative free cash flow.</li>
          <li>This is a valuation aid, not the formula Warren Buffett uses and not a precise forecast.</li>
        </ul>
      </details>
    </div>
  );
}
