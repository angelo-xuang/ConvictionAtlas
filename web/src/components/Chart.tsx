'use client';

import { useEffect, useRef, useMemo } from 'react';
import * as echarts from 'echarts/core';
import { LineChart as ELineChart, BarChart as EBarChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';

echarts.use([
  ELineChart,
  EBarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

type ChartProps = {
  options: EChartsOption;
  height?: number;
  className?: string;
};

export function Chart({ options, height = 200, className }: ChartProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({ backgroundColor: 'transparent', ...options });

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      observer.disconnect();
      chart.dispose();
    };
  }, [options]);

  return (
    <div
      ref={ref}
      className={className}
      style={{ width: '100%', height: `${height}px` }}
    />
  );
}

function cleanPoints(points: Array<number | null | undefined>): number[] {
  return points.filter((p): p is number => typeof p === 'number' && Number.isFinite(p));
}

function toneColor(tone: 'positive' | 'negative' | 'neutral') {
  return tone === 'positive' ? '#059669' : tone === 'negative' ? '#dc2626' : '#2563eb';
}

/* ─── Performance line chart (with axes + tooltip) ─── */

type PerfLineProps = {
  points: Array<number | null | undefined>;
  dateLabels?: string[];
  height?: number;
  tone?: 'positive' | 'negative' | 'neutral';
  showArea?: boolean;
  className?: string;
};

export function PerfLine({
  points,
  dateLabels,
  height = 160,
  tone = 'neutral',
  showArea = true,
  className,
}: PerfLineProps) {
  const clean = cleanPoints(points);
  const color = toneColor(tone);

  const options = useMemo<EChartsOption>(() => ({
    grid: { top: 10, right: 10, bottom: 20, left: 50 },
    xAxis: {
      type: 'category',
      show: false,
      data: dateLabels?.length === clean.length ? dateLabels : undefined,
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#e5e7eb' } },
      axisLabel: {
        color: '#9ca3af',
        fontSize: 10,
        formatter: (v: number) => v.toFixed(v >= 100 ? 0 : 2),
      },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#fff',
      borderColor: '#e5e7eb',
      textStyle: { color: '#111827', fontSize: 12 },
      formatter: (params: any) => {
        const p = Array.isArray(params) ? params[0] : params;
        const val = typeof p.value === 'object' ? (p.value as any).value : p.value;
        const label = p.name || `#${p.dataIndex + 1}`;
        return `<span style="color:#6b7280">${label}</span><br/><strong>${val.toFixed(2)}</strong>`;
      },
    },
    series: [{
      type: 'line',
      data: clean,
      smooth: 0.3,
      showSymbol: false,
      lineStyle: { width: 2, color },
      itemStyle: { color },
      areaStyle: showArea ? {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: color + '30' },
          { offset: 1, color: color + '05' },
        ]),
      } : undefined,
    }],
    animation: true,
    animationDuration: 600,
  }), [clean, dateLabels, color, showArea]);

  return <Chart options={options} height={height} className={className} />;
}

/* ─── Mini sparkline (no axes, no tooltip) ─── */

type MiniLineProps = {
  points: Array<number | null | undefined>;
  height?: number;
  tone?: 'positive' | 'negative' | 'neutral';
  className?: string;
};

export function MiniLine({ points, height = 48, tone = 'neutral', className }: MiniLineProps) {
  const valid = cleanPoints(points);
  const color = toneColor(tone);

  const options = useMemo<EChartsOption>(() => ({
    grid: { top: 2, right: 2, bottom: 2, left: 2 },
    xAxis: { type: 'category', show: false },
    yAxis: { type: 'value', show: false },
    tooltip: { show: false },
    series: [{
      type: 'line',
      data: valid,
      smooth: 0.3,
      showSymbol: false,
      lineStyle: { width: 1.5, color },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: color + '25' },
          { offset: 1, color: color + '02' },
        ]),
      },
      itemStyle: { color },
    }],
    animation: false,
  }), [valid, color]);

  return <Chart options={options} height={height} className={className} />;
}

/* ─── Bar chart ─── */

type BarProps = {
  data: { name: string; value: number; color?: string }[];
  height?: number;
  className?: string;
};

export function BarChart({ data, height = 120, className }: BarProps) {
  const options = useMemo<EChartsOption>(() => ({
    grid: { top: 5, right: 5, bottom: 5, left: 5 },
    xAxis: { type: 'category', show: false },
    yAxis: { type: 'value', show: false },
    tooltip: { show: false },
    series: [{
      type: 'bar',
      data: data.map(d => ({
        value: Math.abs(d.value),
        itemStyle: { color: d.color || (d.value >= 0 ? '#059669' : '#dc2626') },
      })),
      barWidth: '60%',
    }],
    animation: false,
  }), [data]);

  return <Chart options={options} height={height} className={className} />;
}
