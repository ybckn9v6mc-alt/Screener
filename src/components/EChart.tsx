import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, BarChart, CandlestickChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, AxisPointerComponent, DatasetComponent, TitleComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import { useTheme, type Tokens } from '../lib/theme';

echarts.use([LineChart, BarChart, CandlestickChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, AxisPointerComponent, DatasetComponent, TitleComponent, CanvasRenderer]);

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Shared chart chrome: recessive hairline grid, muted axis labels, crosshair tooltip. */
/** Legend styling, added only by charts with two or more series (a single series is named by its title). */
export function legendStyle(t: Tokens) {
  return { show: true, textStyle: { color: t.text2, fontSize: 12, fontFamily: FONT }, icon: 'roundRect', itemWidth: 14, itemHeight: 3, itemGap: 16, top: 0, left: 0 };
}

export function chrome(t: Tokens) {
  const axisCommon = {
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11, fontFamily: FONT },
    splitLine: { lineStyle: { color: t.grid, type: 'solid' as const, width: 1 } },
  };
  return {
    legendBase: legendStyle(t),
    textStyle: { fontFamily: FONT, color: t.text2 },
    animation: false,
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      padding: [6, 10],
      textStyle: { color: t.text, fontSize: 12, fontFamily: FONT },
      axisPointer: { type: 'line' as const, lineStyle: { color: t.muted, width: 1, type: 'solid' as const }, label: { backgroundColor: t.text2, color: t.surface, fontSize: 11 } },
      confine: true,
    },
    xAxis: { ...axisCommon, splitLine: { show: false } },
    yAxis: { ...axisCommon, axisLine: { show: false } },
  };
}

export interface EChartProps {
  option: EChartsOption;
  height: number | string;
  className?: string;
  group?: string;
  ariaLabel?: string;
}

export default function EChart({ option, height, className, group, ariaLabel }: EChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    inst.current = chart;
    if (group) {
      chart.group = group;
      echarts.connect(group);
    }
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      inst.current = null;
    };
  }, [group]);

  useEffect(() => {
    // `legendBase` is a styling helper carried on the shared chrome object, not an ECharts key.
    const { legendBase: _unused, ...clean } = option as EChartsOption & { legendBase?: unknown };
    inst.current?.setOption(clean, { notMerge: true, lazyUpdate: true });
  }, [option, theme]);

  return <div ref={ref} className={className} style={{ width: '100%', height }} role="img" aria-label={ariaLabel} />;
}
