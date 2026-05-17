/**
 * CTA Scoring Engine — Layered decision logic for Crypto CTA manager.
 *
 * Not a linear weighted formula. Instead:
 *   Layer 1: Trend filter (ADX)
 *   Layer 2: Direction (MA alignment + momentum)
 *   Layer 3: Strength score
 *   Layer 4: Position sizing (ATR risk parity)
 */

import { IndicatorResult } from '../technical-indicators';

export type CTAParams = {  adxThreshold: number;  maxRiskPerPosition: number;  onlyTokenTypes: boolean;};

export type CTADecision = {
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number;
  positionSize: number;
  rationale: string;
  indicators: IndicatorResult;
};

/**
 * Main CTA decision function.
 * Returns NEUTRAL (score=0) when conditions are not met.
 */
export function ctaScore(indicators: IndicatorResult, params: CTAParams, cashFloor: number = 0.25, maxPositions: number = 6): CTADecision {
  const { adx, ma7, ma25, ma99, momentum14d, volumeRatio, bollingerWidth, atr, ma7: close } = indicators;

  // Layer 1: Trend filter — ADX must be strong enough
  if (adx < params.adxThreshold) {
    return {
      direction: 'NEUTRAL',
      score: 0,
      positionSize: 0,
      rationale: `ADX ${adx.toFixed(1)} < ${params.adxThreshold}, 无明确趋势，空仓等待`,
      indicators,
    };
  }

  // Layer 2: Direction — MA alignment + momentum confirmation
  const bullishAlign = ma7 > ma25 && ma25 > ma99;
  const bearishAlign = ma7 < ma25 && ma25 < ma99;
  const momPositive = momentum14d > 0;
  const momNegative = momentum14d < 0;

  const isBullish = bullishAlign && momPositive;
  const isBearish = bearishAlign && momNegative;

  if (!isBullish && !isBearish) {
    return {
      direction: 'NEUTRAL',
      score: 0,
      positionSize: 0,
      rationale: `趋势存在(ADX ${adx.toFixed(1)})但方向不明确，MA 未排列`,
      indicators,
    };
  }

  // Layer 3: Strength score (0~1)
  // Base: absolute momentum normalized (typical crypto daily momentum ranges ±0.05-0.15)
  const rawMomentum = Math.abs(momentum14d);
  const base = Math.min(rawMomentum / 0.15, 1); // 15% 14d move = max score

  // Volume confirmation bonus
  const volumeBoost = volumeRatio > 1.5 ? 0.10 : volumeRatio > 1.2 ? 0.05 : 0;

  // Bollinger squeeze bonus (low volatility compression → breakout imminent)
  const bollingerBoost = bollingerWidth < 0.03 ? 0.15 : bollingerWidth < 0.05 ? 0.05 : 0;

  // RSI filter: avoid extreme overbought entries
  const rsi = indicators.rsi14;
  const rsiPenalty = isBullish && rsi > 75 ? -0.15 : isBearish && rsi < 25 ? -0.15 : 0;

  const score = Math.max(0, Math.min(1, base + volumeBoost + bollingerBoost + rsiPenalty));

  // Layer 4: Position sizing (risk parity)
  // maxRiskPerPosition = fraction of portfolio we're willing to lose on this trade
  // ATR tells us how much the asset typically moves per day
  // positionSize = maxRisk / (ATR / close) = maxRisk * close / ATR
  const closePrice = indicators.ma7; // use MA7 as proxy for current price
  let positionSize = 0;
  if (atr > 0 && closePrice > 0) {
    const dailyRisk = atr / closePrice; // daily risk as fraction
    positionSize = Math.min(
      params.maxRiskPerPosition / dailyRisk, // risk parity
      (1 - cashFloor) / maxPositions, // max per position
    );
    positionSize = Math.max(0, Math.min(positionSize, 0.30)); // hard cap 30%
  }

  const direction = isBullish ? 'BULLISH' : 'BEARISH';
  const directionLabel = isBullish ? '多头' : '空头';

  return {
    direction,
    score,
    positionSize,
    rationale: [
      `${directionLabel}信号 (ADX ${adx.toFixed(1)})`,
      `均线${bullishAlign ? '多头' : '空头'}排列 (MA7>MA25>MA99)`,
      `14日动量 ${(momentum14d * 100).toFixed(1)}%`,
      `量比 ${volumeRatio.toFixed(1)}x${volumeRatio > 1.5 ? ' (放量确认)' : ''}`,
      score > 0 ? `评分 ${score.toFixed(2)} → 仓位 ${(positionSize * 100).toFixed(1)}%` : '',
    ].filter(Boolean).join(' | '),
    indicators,
  };
}
