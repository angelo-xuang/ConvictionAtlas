/**
 * Technical Indicators — computed from Candle OHLCV data.
 * Used by CTA and other systematic strategies.
 */

export type CandleLike = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: Date;
};

export type IndicatorResult = {
  atr: number;
  adx: number;
  plusDi: number;
  minusDi: number;
  momentum7d: number;
  momentum14d: number;
  momentum30d: number;
  ma7: number;
  ma25: number;
  ma99: number;
  volumeRatio: number;
  bollingerWidth: number;
  bollingerUpper: number;
  bollingerLower: number;
  rsi14: number;
};

/** Average True Range */
export function computeATR(candles: CandleLike[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close),
    );
    trs.push(tr);
  }
  if (trs.length < period) return trs.length > 0 ? avg(trs) : 0;
  // Wilder's smoothing
  let atr = avg(trs.slice(0, period));
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

/** Average Directional Index (trend strength, 0-100) */
export function computeADX(candles: CandleLike[], period = 14): { adx: number; plusDi: number; minusDi: number } {
  if (candles.length < period + 1) return { adx: 0, plusDi: 0, minusDi: 0 };

  const plusDMs: number[] = [], minusDMs: number[] = [], trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const upMove = c.high - p.high;
    const downMove = p.low - c.low;
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }

  if (trs.length < period) return { adx: 0, plusDi: 0, minusDi: 0 };

  let smoothPlusDM = sum(plusDMs.slice(0, period));
  let smoothMinusDM = sum(minusDMs.slice(0, period));
  let smoothTR = sum(trs.slice(0, period));

  const dxValues: number[] = [];
  let plusDi = 0, minusDi = 0;

  for (let i = period; i < trs.length; i++) {
    smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDMs[i];
    smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDMs[i];
    smoothTR = smoothTR - smoothTR / period + trs[i];

    plusDi = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
    minusDi = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
    const diSum = plusDi + minusDi;
    dxValues.push(diSum > 0 ? Math.abs(plusDi - minusDi) / diSum * 100 : 0);
  }

  let adx = dxValues.length >= period ? avg(dxValues.slice(0, period)) : (dxValues.length > 0 ? avg(dxValues) : 0);
  for (let i = period; i < dxValues.length; i++) {
    adx = (adx * (period - 1) + dxValues[i]) / period;
  }

  return { adx, plusDi, minusDi };
}

/** Price momentum: percentage return over N periods */
export function computeMomentum(candles: CandleLike[], period: number): number {
  if (candles.length <= period) return 0;
  const current = candles[candles.length - 1].close;
  const past = candles[candles.length - 1 - period].close;
  return past !== 0 ? (current - past) / past : 0;
}

/** Simple Moving Average */
export function computeMA(candles: CandleLike[], period: number): number {
  if (candles.length < period) return 0;
  const slice = candles.slice(-period);
  return avg(slice.map(c => c.close));
}

/** Current volume / average volume over N periods */
export function computeVolumeRatio(candles: CandleLike[], period = 7): number {
  if (candles.length < period + 1) return 1;
  const currentVol = candles[candles.length - 1].volume;
  const avgVol = avg(candles.slice(-period - 1, -1).map(c => c.volume));
  return avgVol > 0 ? currentVol / avgVol : 1;
}

/** Bollinger Band width (normalized) */
export function computeBollingerWidth(candles: CandleLike[], period = 20): {
  width: number; upper: number; lower: number;
} {
  if (candles.length < period) return { width: 0, upper: 0, lower: 0 };
  const closes = candles.slice(-period).map(c => c.close);
  const ma = avg(closes);
  const std = Math.sqrt(avg(closes.map(c => (c - ma) ** 2)));
  const upper = ma + 2 * std;
  const lower = ma - 2 * std;
  const width = ma > 0 ? (upper - lower) / ma : 0;
  return { width, upper, lower };
}

/** Relative Strength Index */
export function computeRSI(candles: CandleLike[], period = 14): number {
  if (candles.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Compute all indicators at once */
export function computeAllIndicators(candles: CandleLike[]): IndicatorResult {
  const { adx, plusDi, minusDi } = computeADX(candles, 14);
  const boll = computeBollingerWidth(candles, 20);
  return {
    atr: computeATR(candles, 14),
    adx,
    plusDi,
    minusDi,
    momentum7d: computeMomentum(candles, 7),
    momentum14d: computeMomentum(candles, 14),
    momentum30d: computeMomentum(candles, 30),
    ma7: computeMA(candles, 7),
    ma25: computeMA(candles, 25),
    ma99: computeMA(candles, 99),
    volumeRatio: computeVolumeRatio(candles, 7),
    bollingerWidth: boll.width,
    bollingerUpper: boll.upper,
    bollingerLower: boll.lower,
    rsi14: computeRSI(candles, 14),
  };
}

function sum(arr: number[]): number { return arr.reduce((a, b) => a + b, 0); }
function avg(arr: number[]): number { return arr.length > 0 ? sum(arr) / arr.length : 0; }
