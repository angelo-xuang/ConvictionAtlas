import { Injectable } from '@nestjs/common';
import { Direction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getManagerBlueprint } from '../core/manager-blueprints';
import { average, dateKey, round, serializeJson, standardDeviation } from '../core/helpers';
import {
  computeAllIndicators,
  type CandleLike,
} from '../core/technical-indicators';
import { ctaScore } from '../core/scoring/cta-scoring';

type TokenCandles = {
  opportunityId: string;
  slug: string;
  candles: CandleLike[];
};

@Injectable()
export class CtaBackfillService {
  constructor(private readonly prisma: PrismaService) {}

  async backfillCta(days: number = 180, managerSlug: string = 'crypto-cta') {
    const manager = await this.prisma.manager.findUnique({ where: { slug: managerSlug } });
    if (!manager) {
      return { error: `manager '${managerSlug}' not found` };
    }
    const blueprint = getManagerBlueprint(manager.slug);
    if (blueprint.strategyType !== 'cta' || !blueprint.ctaParams) {
      return { error: `manager '${managerSlug}' is not a CTA strategy` };
    }

    const opportunities = await this.prisma.opportunity.findMany({
      where: { type: 'TOKEN', status: 'active' },
      select: { id: true, slug: true },
    });

    // Load 1d candles per token, ordered ascending. We need extra warmup before
    // the first replay day so indicators (ADX-14, MA-99) have enough history.
    const universe: TokenCandles[] = [];
    for (const opp of opportunities) {
      const candles = await this.prisma.candle.findMany({
        where: { opportunityId: opp.id, timeframe: '1d' },
        orderBy: { timestamp: 'asc' },
      });
      if (candles.length < 30) continue;
      universe.push({
        opportunityId: opp.id,
        slug: opp.slug,
        candles: candles.map((c) => ({
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          timestamp: c.timestamp,
        })),
      });
    }

    if (!universe.length) {
      return { error: 'no tokens with >= 30 days of 1d candles' };
    }

    // Build the day grid: midnight-UTC timestamps covering the last `days`,
    // bounded by the latest candle we actually have.
    const latestCandleTs = universe.reduce((max, t) => {
      const last = t.candles[t.candles.length - 1];
      return Math.max(max, last.timestamp.getTime());
    }, 0);
    const startTs = latestCandleTs - days * 24 * 60 * 60 * 1000;
    const dayMs = 24 * 60 * 60 * 1000;
    const days_grid: number[] = [];
    for (let t = startTs; t <= latestCandleTs; t += dayMs) {
      days_grid.push(t);
    }

    let nav = 100;
    const navHistory: number[] = [];
    const dailyReturns: number[] = [];
    let snapshotsWritten = 0;

    for (let i = 0; i < days_grid.length - 1; i++) {
      const ts = days_grid[i];
      const nextTs = days_grid[i + 1];
      const todayKey = dateKey(new Date(nextTs));

      // For each token, compute indicators on candles available up to ts.
      const scored: Array<{
        opp: TokenCandles;
        score: number;
        weight: number;
        startPrice: number;
        endPrice: number;
        direction: Direction;
        rationale: string;
        indicators: ReturnType<typeof computeAllIndicators>;
      }> = [];

      for (const token of universe) {
        const window = token.candles.filter((c) => c.timestamp.getTime() <= ts);
        if (window.length < 30) continue;
        const indicators = computeAllIndicators(window);
        const decision = ctaScore(
          indicators,
          blueprint.ctaParams!,
          blueprint.cashFloor,
          blueprint.maxPositions,
        );
        if (decision.direction !== 'BULLISH' || decision.score <= 0) continue;
        const nextCandle = token.candles.find((c) => c.timestamp.getTime() > ts);
        if (!nextCandle) continue;
        const lastCandle = window[window.length - 1];
        scored.push({
          opp: token,
          score: decision.score,
          weight: decision.positionSize,
          startPrice: lastCandle.close,
          endPrice: nextCandle.close,
          direction: Direction.BULLISH,
          rationale: decision.rationale,
          indicators,
        });
      }

      scored.sort((a, b) => b.score - a.score);
      const selected = scored.slice(0, blueprint.maxPositions);

      const investableCapital = selected.length ? 1 - blueprint.cashFloor : 0;
      const weightSum = selected.reduce((s, p) => s + p.weight, 0) || 1;
      const normalized = selected.map((p) => ({
        ...p,
        normalizedWeight: (p.weight / weightSum) * investableCapital,
      }));

      let intervalReturn = 0;
      for (const pos of normalized) {
        if (pos.startPrice <= 0) continue;
        const r = pos.endPrice / pos.startPrice - 1;
        intervalReturn += pos.normalizedWeight * r;
      }

      nav = round(nav * (1 + intervalReturn), 4);
      navHistory.push(nav);
      dailyReturns.push(intervalReturn);

      const cumulativeReturn = round(nav / 100 - 1, 4);
      const peak = Math.max(100, ...navHistory);
      const drawdown = round(nav / peak - 1, 4);
      const stdRet = dailyReturns.length > 1 ? standardDeviation(dailyReturns) : 0;
      const avgRet = average(dailyReturns);
      const sharpe = round(
        stdRet > 0 ? (avgRet / stdRet) * Math.sqrt(365) * Math.sign(cumulativeReturn || 1) : 0,
        2,
      );
      const hitRate = round(
        dailyReturns.filter((r) => r > 0).length / Math.max(dailyReturns.length, 1),
        4,
      );

      // Upsert portfolio snapshot for this day.
      const cashWeight = round(1 - investableCapital, 4);
      const portfolioData = {
        cashWeight,
        grossExposure: round(investableCapital, 4),
        netExposure: round(investableCapital, 4),
        riskScore: 0,
        nav,
        computedAt: new Date(nextTs),
        metadata: serializeJson({ source: 'cta-backfill' }),
      };
      const snapshot = await this.prisma.portfolioSnapshot.upsert({
        where: { managerId_dateKey: { managerId: manager.id, dateKey: todayKey } },
        create: { managerId: manager.id, dateKey: todayKey, ...portfolioData },
        update: portfolioData,
      });

      // Replace positions for this snapshot.
      await this.prisma.position.deleteMany({
        where: { portfolioSnapshotId: snapshot.id },
      });
      if (normalized.length) {
        await this.prisma.position.createMany({
          data: normalized.map((p) => ({
            portfolioSnapshotId: snapshot.id,
            opportunityId: p.opp.opportunityId,
            weight: round(p.normalizedWeight, 4),
            convictionScore: round(p.score, 4),
            entryPrice: p.startPrice,
          })),
        });
      }

      // Upsert decision rows so /managers/run history reflects the replay.
      for (const pos of normalized) {
        await this.prisma.managerDecision.upsert({
          where: {
            managerId_opportunityId_dateKey: {
              managerId: manager.id,
              opportunityId: pos.opp.opportunityId,
              dateKey: todayKey,
            },
          },
          create: {
            managerId: manager.id,
            opportunityId: pos.opp.opportunityId,
            dateKey: todayKey,
            direction: pos.direction,
            convictionScore: round(pos.score, 4),
            targetWeight: round(pos.normalizedWeight, 4),
            rationale: pos.rationale,
            computedAt: new Date(nextTs),
            metadata: serializeJson({ source: 'cta-backfill' }),
          },
          update: {
            direction: pos.direction,
            convictionScore: round(pos.score, 4),
            targetWeight: round(pos.normalizedWeight, 4),
            rationale: pos.rationale,
            computedAt: new Date(nextTs),
            metadata: serializeJson({ source: 'cta-backfill' }),
          },
        });
      }

      const perfData = {
        portfolioSnapshotId: snapshot.id,
        nav,
        dailyReturn: round(intervalReturn, 6),
        cumulativeReturn,
        drawdown,
        sharpe,
        hitRate,
        computedAt: new Date(nextTs),
        metadata: serializeJson({ source: 'cta-backfill' }),
      };
      await this.prisma.performanceSnapshot.upsert({
        where: { managerId_dateKey: { managerId: manager.id, dateKey: todayKey } },
        create: { managerId: manager.id, dateKey: todayKey, ...perfData },
        update: perfData,
      });
      snapshotsWritten += 1;
    }

    return {
      manager: managerSlug,
      tokensInUniverse: universe.length,
      daysReplayed: snapshotsWritten,
      startDate: new Date(startTs).toISOString().slice(0, 10),
      endDate: new Date(latestCandleTs).toISOString().slice(0, 10),
      finalNav: nav,
      cumulativeReturn: round(nav / 100 - 1, 4),
    };
  }
}
