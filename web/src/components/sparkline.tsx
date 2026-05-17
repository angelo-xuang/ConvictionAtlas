'use client';
import { useId, useRef, useState, useCallback, type MouseEvent } from 'react';

type SparklineProps = {
  points: Array<number | null | undefined>;
  height?: number;
  strokeWidth?: number;
  area?: boolean;
  tone?: 'positive' | 'negative' | 'neutral';
  className?: string;
  showAxes?: boolean;
  xLabels?: [string, string];
  yLabels?: [string, string];
  /** Optional date labels for tooltip X display, same length as points */
  dateLabels?: string[];
  /** Optional value formatter for tooltip */
  formatValue?: (value: number) => string;
};

type HoverState = {
  /** Index into cleanPoints */
  index: number;
  /** SVG x coordinate */
  svgX: number;
  /** SVG y coordinate */
  svgY: number;
  /** The actual data value */
  value: number;
  /** Pixel x relative to canvas */
  pxX: number;
  /** Pixel y relative to canvas */
  pxY: number;
};

export function Sparkline({
  points,
  height = 72,
  strokeWidth = 2.5,
  area = true,
  tone = 'neutral',
  className,
  showAxes = false,
  xLabels,
  yLabels,
  dateLabels,
  formatValue,
}: SparklineProps) {
  const cleanPoints = points.filter(
    (point): point is number => typeof point === 'number' && Number.isFinite(point),
  );

  const [hover, setHover] = useState<HoverState | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  if (!cleanPoints.length) {
    return <div className={className} />;
  }

  const width = 100;
  const svgHeight = 100;
  const minValue = Math.min(...cleanPoints);
  const maxValue = Math.max(...cleanPoints);
  const spread = maxValue - minValue || 1;
  const gradientId = useId().replace(/:/g, '');
  const topPadding = 8;
  const bottomPadding = 10;
  const drawableHeight = svgHeight - topPadding - bottomPadding;

  const coordinates = cleanPoints.map((point, index) => {
    const x =
      cleanPoints.length === 1
        ? width / 2
        : (index / (cleanPoints.length - 1)) * width;
    const y =
      topPadding +
      (1 - (point - minValue) / spread) * Math.max(drawableHeight, 1);

    return { x, y };
  });
  const linePath = buildSmoothPath(coordinates);
  const areaPath = `${linePath} L ${coordinates[coordinates.length - 1].x} ${svgHeight - bottomPadding} L ${coordinates[0].x} ${svgHeight - bottomPadding} Z`;
  const toneClass =
    tone === 'positive'
      ? 'sparkline-positive'
      : tone === 'negative'
        ? 'sparkline-negative'
        : 'sparkline-neutral';
  const resolvedXLabels = xLabels ?? ['起始', '当前'];
  const resolvedYLabels = yLabels ?? [
    maxValue.toFixed(2),
    minValue.toFixed(2),
  ];

  const handleMouseMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const el = canvasRef.current;
      if (!el || cleanPoints.length < 2) return;

      const rect = el.getBoundingClientRect();
      // Account for padding when showAxes is on
      const paddingLeft = showAxes ? 60 : 0;
      const paddingTop = 0;
      const chartWidth = rect.width - paddingLeft;
      const chartHeight = rect.height - paddingTop;

      const relX = e.clientX - rect.left - paddingLeft;
      const relY = e.clientY - rect.top - paddingTop;

      if (relX < 0 || relX > chartWidth) {
        setHover(null);
        return;
      }

      // Map pixel x to data index
      const ratio = Math.max(0, Math.min(1, relX / chartWidth));
      const floatIndex = ratio * (cleanPoints.length - 1);
      const index = Math.round(floatIndex);
      const coord = coordinates[index];
      if (!coord) return;

      // Map SVG coord back to pixel space
      const pxX = paddingLeft + (coord.x / width) * chartWidth;
      const pxY = (coord.y / svgHeight) * chartHeight;

      setHover({
        index,
        svgX: coord.x,
        svgY: coord.y,
        value: cleanPoints[index],
        pxX,
        pxY,
      });
    },
    [cleanPoints, coordinates, showAxes, width, svgHeight],
  );

  const handleMouseLeave = useCallback(() => {
    setHover(null);
  }, []);

  const fmtVal = formatValue ?? ((v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  const tooltipLabel = hover
    ? dateLabels?.[hover.index] ?? `#${hover.index + 1}`
    : '';

  return (
    <div
      className={[
        className,
        'sparkline',
        toneClass,
        showAxes ? 'sparkline-with-axes' : null,
        'sparkline-interactive',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ ['--sparkline-height' as string]: `${height}px` }}
    >
      <div
        className="sparkline-canvas"
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {showAxes ? (
          <>
            <span className="sparkline-y-label sparkline-y-top">{resolvedYLabels[0]}</span>
            <span className="sparkline-y-label sparkline-y-bottom">
              {resolvedYLabels[1]}
            </span>
          </>
        ) : null}
        <svg
          viewBox={`0 0 ${width} ${svgHeight}`}
          className="sparkline-svg"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {showAxes ? (
            <>
              <line x1="0" y1={topPadding} x2={width} y2={topPadding} className="sparkline-grid-line" />
              <line
                x1="0"
                y1={topPadding + drawableHeight / 2}
                x2={width}
                y2={topPadding + drawableHeight / 2}
                className="sparkline-grid-line"
              />
              <line
                x1="0"
                y1={svgHeight - bottomPadding}
                x2={width}
                y2={svgHeight - bottomPadding}
                className="sparkline-axis-line"
              />
            </>
          ) : null}
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {area ? <path d={areaPath} fill={`url(#${gradientId})`} /> : null}
          <path
            d={linePath}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* Hover crosshair — vertical dashed line */}
          {hover ? (
            <>
              <line
                x1={hover.svgX}
                y1={topPadding}
                x2={hover.svgX}
                y2={svgHeight - bottomPadding}
                className="sparkline-crosshair-v"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={0}
                y1={hover.svgY}
                x2={width}
                y2={hover.svgY}
                className="sparkline-crosshair-h"
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : null}
        </svg>

        {/* Hover dot + tooltip overlay (pixel-positioned) */}
        {hover ? (
          <>
            <div
              className="sparkline-hover-dot"
              style={{
                left: `${hover.pxX}px`,
                top: `${hover.pxY}px`,
              }}
            />
            <div
              className="sparkline-tooltip"
              style={{
                left: `${hover.pxX}px`,
                top: `${hover.pxY}px`,
              }}
            >
              <span className="sparkline-tooltip-value">{fmtVal(hover.value)}</span>
              <span className="sparkline-tooltip-label">{tooltipLabel}</span>
            </div>
          </>
        ) : null}
      </div>
      {showAxes ? (
        <div className="sparkline-x-axis">
          <span>{resolvedXLabels[0]}</span>
          <span>{resolvedXLabels[1]}</span>
        </div>
      ) : null}
    </div>
  );
}

function buildSmoothPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) {
    return '';
  }

  if (points.length < 3) {
    return points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
      .join(' ');
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midpointX = (current.x + next.x) / 2;
    const midpointY = (current.y + next.y) / 2;

    path += ` Q ${current.x} ${current.y} ${midpointX} ${midpointY}`;
  }

  const penultimate = points[points.length - 2];
  const last = points[points.length - 1];
  path += ` Q ${penultimate.x} ${penultimate.y} ${last.x} ${last.y}`;

  return path;
}
