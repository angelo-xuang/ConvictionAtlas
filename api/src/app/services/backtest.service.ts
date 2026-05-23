import { Injectable } from '@nestjs/common';
import { OpportunityType } from '@prisma/client';
import { getManagerBlueprint } from '../core/manager-blueprints';
import { PrismaService } from '../prisma/prisma.service';
import {
  average,
  clamp,
  dateKey,
  parseJson,
  round,
  standardDeviation,
} from '../core/helpers';
import {
  isCurrentInvestableOpportunity,
} from '../core/opportunity-universe';

type HistoryPointLike = {
  pointAt: Date;
  price: number;
  volume?: number | null;
};

type BacktestOpportunity = {
  id: string;
  type: OpportunityType;
  sourceKind: string;
  title: string;
  currentPrice: number | null;
  eventDate: Date | null;
  volume24h: number | null;
  marketCap: number | null;
  liquidity: number | null;
  metadata: string | null;
  historyPoints: HistoryPointLike[];
  newsItems: Array<{ publishedAt: Date; sentimentScore: number | null }>;
};

type BacktestResult = {
  manager: string;
  days: number;
  finalNav: number;
  cumulativeReturn: number;
  sharpe: number;
  maxDrawdown: number;
  hitRate: number;
};

@Injectable()
export class BacktestService {
  constructor(private readonly prisma: PrismaService) {}

  async runBacktest(days: number = 180) {
    const universe = await this.loadUniverse();
    if (!universe.length) {
      return { error: 'No opportunities with history data found' };
    }

    const managers = await this.prisma.manager.findMany();
    if (!managers.length) {
      return { error: 'No managers found' };
    }

    const latestTimestamp = universe.reduce((max, opp) => {
      const last = opp.historyPoints[opp.historyPoints.length - 1];
      return Math.max(max, last?.pointAt?.getTime() ?? 0);
    }, 0);

    if (!latestTimestamp) {
      return { error: 'No valid history timestamps' };
    }

    const startTimestamp = latestTimestamp - days * 24 * 60 * 60 * 1000;
    const timestamps = this.buildDailyTimestamps(startTimestamp, latestTimestamp);

    if (timestamps.length < 2) {
      return { error: `Insufficient timestamps (${timestamps.length})` };
    }

    const results: BacktestResult[] = [];

    for (const manager of managers) {
      const result = await this.runManagerBacktest(
        manager.id,
        manager.slug,
        universe,
        timestamps,
      );
      results.push(result);
    }

    return {
      days: timestamps.length - 1,
      startDate: new Date(startTimestamp).toISOString().split('T')[0],
      endDate: new Date(latestTimestamp).toISOString().split('T')[0],
      managers: results,
    };
  }

  private async loadUniverse(): Promise<BacktestOpportunity[]> {
    const opps = await this.prisma.opportunity.findMany({
      where: { status: 'active' },
      include: {
        historyPoints: {
          orderBy: { pointAt: 'asc' },
          take: 720,
        },
        newsItems: {
          orderBy: { publishedAt: 'desc' },
          take: 20,
        },
      },
    });

    return opps
      .filter((opp) => isCurrentInvestableOpportunity(opp as any))
      .map((opp) => ({
        ...opp,
        historyPoints: opp.historyPoints.filter(
          (p) => p.pointAt instanceof Date && Number.isFinite(p.price),
        ),
      }))
      .filter((opp) => opp.historyPoints.length >= 14);
  }

  private async runManagerBacktest(
    managerId: string,
    managerSlug: string,
    universe: BacktestOpportunity[],
    timestamps: number[],
  ): Promise<BacktestResult> {
    const blueprint = getManagerBlueprint(managerSlug);
    let nav = 100;
    const navHistory: number[] = [100];
    const dailyReturns: number[] = [];

    // Pre-compute BTC reference for MA regime filter
    const btcRef = universe.find((o) => o.title.toLowerCase().includes('bitcoin'));

    for (let i = 0; i < timestamps.length - 1; i++) {
      const currentTs = timestamps[i];
      const nextTs = timestamps[i + 1];

      // Market regime filter: 20-day MA crossover — invest only when BTC > MA20
      const regimeOk = btcRef ? this.isAboveMA(btcRef, currentTs, 20) : true;

      let candidates: Array<{
        opp: BacktestOpportunity;
        scored: NonNullable<ReturnType<typeof this.scoreOpportunity>>;
      }>;

      if (!regimeOk) {
        candidates = [];
      } else {
        candidates = universe
          .map((opp) => ({ opp, scored: this.scoreOpportunity(blueprint, opp, currentTs) }))
          .filter(
            (c): c is { opp: BacktestOpportunity; scored: NonNullable<ReturnType<typeof this.scoreOpportunity>> } =>
              c.scored !== null && c.scored.score > blueprint.bullishThreshold,
          )
          .sort((a, b) => b.scored.score - a.scored.score)
          .slice(0, blueprint.maxPositions);
      }

      const investableCapital = candidates.length ? 1 - blueprint.cashFloor : 0;
      const scoreTotal =
        candidates.reduce((s, c) => s + c.scored.targetWeight, 0) || 1;
      const cashWeight = candidates.length ? blueprint.cashFloor : 1;

      let intervalReturn = 0;
      const positionData: Array<{
        opportunityId: string;
        weight: number;
        convictionScore: number;
        entryPrice: number;
      }> = [];

      for (const { opp, scored } of candidates) {
        const startPoint = this.getPointAtOrBefore(opp.historyPoints, currentTs);
        const endPoint = this.getPointAtOrBefore(opp.historyPoints, nextTs);
        if (!startPoint || !endPoint || startPoint.price <= 0) continue;

        const weight = (scored.targetWeight / scoreTotal) * investableCapital;
        const assetReturn = this.computeAssetReturn(
          managerSlug,
          opp.type,
          startPoint.price,
          endPoint.price,
        );
        intervalReturn += weight * assetReturn;

        positionData.push({
          opportunityId: opp.id,
          weight: round(weight, 4),
          convictionScore: round(scored.score, 4),
          entryPrice: round(startPoint.price, 8),
        });
      }

      nav = round(nav * (1 + intervalReturn), 4);
      dailyReturns.push(intervalReturn);
      navHistory.push(nav);

      const cumulativeReturn = round(nav / 100 - 1, 4);
      const peakNav = Math.max(...navHistory);
      const drawdown = round(nav / peakNav - 1, 4);
      const avgRet = dailyReturns.length ? average(dailyReturns) : 0;
      const stdRet = dailyReturns.length > 1 ? standardDeviation(dailyReturns) : 0;
      // Use sign of cumulative return to ensure Sharpe sign consistency
      const rawSharpe = stdRet > 0 ? avgRet / stdRet * Math.sqrt(365) : 0;
      const sharpe = round(Math.sign(cumulativeReturn) >= 0 ? Math.abs(rawSharpe) : -Math.abs(rawSharpe), 2);
      const hitRate = round(
        dailyReturns.filter((r) => r > 0).length / Math.max(dailyReturns.length, 1),
        4,
      );

      // Risk score from risk_flag signal
      const riskScores = candidates.map(({ opp }) => {
        const sm = this.buildSignalMap(opp, currentTs);
        return Math.abs(Number(sm.risk_flag ?? 0));
      });
      const riskScore = riskScores.length ? round(average(riskScores), 4) : 0;

      const portfolioDateKey = dateKey(new Date(currentTs));
      const portfolioData = {
        cashWeight,
        grossExposure: round(1 - cashWeight, 4),
        netExposure: round(1 - cashWeight - (cashWeight > 0.5 ? 0 : 0), 4),
        riskScore,
        nav,
        computedAt: new Date(currentTs),
      };
      const snapshot = await this.prisma.portfolioSnapshot.upsert({
        where: { managerId_dateKey: { managerId, dateKey: portfolioDateKey } },
        create: { managerId, dateKey: portfolioDateKey, ...portfolioData },
        update: portfolioData,
      });

      await this.prisma.position.deleteMany({
        where: { portfolioSnapshotId: snapshot.id },
      });
      if (positionData.length) {
        await this.prisma.position.createMany({
          data: positionData.map((p) => ({
            portfolioSnapshotId: snapshot.id,
            opportunityId: p.opportunityId,
            weight: p.weight,
            convictionScore: p.convictionScore,
            entryPrice: p.entryPrice,
          })),
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
        computedAt: new Date(currentTs),
      };
      await this.prisma.performanceSnapshot.upsert({
        where: { managerId_dateKey: { managerId, dateKey: portfolioDateKey } },
        create: { managerId, dateKey: portfolioDateKey, ...perfData },
        update: perfData,
      });
    }

    const finalNav = navHistory[navHistory.length - 1];
    const maxDrawdown = round(
      Math.min(
        ...navHistory.map((n, idx) => {
          const peak = Math.max(...navHistory.slice(0, idx + 1));
          return peak > 0 ? n / peak - 1 : 0;
        }),
      ),
      4,
    );
    const avgRet = average(dailyReturns);
    const stdRet = standardDeviation(dailyReturns);
    const finalCumReturn = round(finalNav / 100 - 1, 4);
    const rawSharpe = stdRet > 0 ? avgRet / stdRet * Math.sqrt(365) : 0;
    const sharpe = round(Math.sign(finalCumReturn) >= 0 ? Math.abs(rawSharpe) : -Math.abs(rawSharpe), 2);

    return {
      manager: managerSlug,
      days: timestamps.length - 1,
      finalNav,
      cumulativeReturn: finalCumReturn,
      sharpe,
      maxDrawdown,
      hitRate: round(
        dailyReturns.filter((r) => r > 0).length / Math.max(dailyReturns.length, 1),
        4,
      ),
    };
  }

  // --- Signal computation (same formulas as query.service.ts buildHistoricalSignalMap) ---

  private buildSignalMap(
    opp: { historyPoints: HistoryPointLike[]; type: OpportunityType; eventDate: Date | null; newsItems: Array<{ publishedAt: Date; sentimentScore: number | null }> },
    timestamp: number,
  ) {
    const change1d = this.calculateChangeAt(opp.historyPoints, timestamp, 1, opp.type);
    const change7d = this.calculateChangeAt(opp.historyPoints, timestamp, 7, opp.type);
    const change30d = this.calculateChangeAt(opp.historyPoints, timestamp, 30, opp.type);
    const volatility7d = this.calculateVolatilityAt(opp.historyPoints, timestamp, 7, opp.type);
    const volumeSpike = this.calculateVolumeSpikeAt(opp.historyPoints, timestamp);
    const newsContext = this.buildNewsContext(opp.newsItems, timestamp);

    const daysToEvent = opp.eventDate
      ? (opp.eventDate.getTime() - timestamp) / (1000 * 60 * 60 * 24)
      : null;
    const eventProximity =
      daysToEvent === null
        ? 0
        : daysToEvent < 0
          ? 0
          : clamp(1 - daysToEvent / 120, 0, 1);

    const currentPoint = this.getPointAtOrBefore(opp.historyPoints, timestamp);

    const momentumScales =
      opp.type === OpportunityType.TOKEN
        ? { day: 10, week: 24, month: 42 }
        : { day: 9, week: 26, month: 38 };

    const marketMomentum = clamp(
      (change1d / momentumScales.day) * 0.42 +
        (change7d / momentumScales.week) * 0.36 +
        (change30d / momentumScales.month) * 0.22,
      -1,
      1,
    );

    const trendRegime = clamp(
      (change7d / momentumScales.week) * 0.58 +
        (change30d / momentumScales.month) * 0.42 +
        (Math.sign(change7d) === Math.sign(change30d) && Math.abs(change7d) > 1
          ? 0.12 * Math.sign(change7d)
          : 0),
      -1,
      1,
    );

    const newsHeat = clamp(
      newsContext.count / 4 + Math.max(newsContext.sentiment, 0) * 0.35,
      0,
      1,
    );

    const trailingPeakGap = this.calculateTrailingPeakGap(
      opp.historyPoints,
      timestamp,
      30,
    );

    const priceDislocation =
      opp.type === OpportunityType.TOKEN
        ? clamp(
            (trailingPeakGap - 0.18) * 1.3 +
              Math.max(trendRegime, -0.2) * 0.35,
            -1,
            1,
          )
        : clamp(
            Math.abs((currentPoint?.price ?? 0.5) - 0.5) * 1.2 +
              trendRegime * 0.2,
            -1,
            1,
          );

    const opportunityQuality =
      opp.type === OpportunityType.TOKEN
        ? clamp(
            0.26 +
              Math.max(trendRegime, 0) * 0.22 +
              volumeSpike * 0.12 -
              Math.min(volatility7d * 6.5, 0.34),
            -1,
            1,
          )
        : clamp(
            0.22 +
              eventProximity * 0.22 +
              Math.max(trendRegime, 0) * 0.16 -
              Math.min(volatility7d * 2.4, 0.3),
            -1,
            1,
          );

    const riskFlag = clamp(
      Math.abs(change1d) / 18 +
        Math.abs(change7d) / 55 +
        Math.min(
          volatility7d * (opp.type === OpportunityType.TOKEN ? 10 : 2.8),
          0.32,
        ) +
        (daysToEvent !== null && daysToEvent < 7 ? 0.12 : 0),
      0,
      1,
    );

    const narrativeStrength = clamp(
      newsHeat * 0.34 +
        Math.max(marketMomentum, 0) * 0.22 +
        Math.max(trendRegime, 0) * 0.22 +
        volumeSpike * 0.12,
      -1,
      1,
    );

    const probabilityEdge =
      opp.type === OpportunityType.PREDICTION_MARKET
        ? clamp(
            ((currentPoint?.price ?? 0.5) - 0.5) * 1.6 +
              trendRegime * 0.28 +
              marketMomentum * 0.16 -
              Math.max(riskFlag - 0.75, 0) * 0.2,
            -1,
            1,
          )
        : clamp(
            marketMomentum * 0.55 + trendRegime * 0.25,
            -1,
            1,
          );

    const catalystSetup =
      opp.type === OpportunityType.TOKEN
        ? clamp(
            newsHeat * 0.22 +
              Math.max(trendRegime, 0) * 0.18 +
              Math.max(priceDislocation, 0) * 0.18 +
              Math.max(opportunityQuality, 0) * 0.18 +
              volumeSpike * 0.08 +
              Math.max(marketMomentum, -0.1) * 0.06 -
              Math.max(riskFlag - 0.5, 0) * 0.2,
            -1,
            1,
          )
        : clamp(
            eventProximity * 0.34 +
              newsHeat * 0.12 +
              Math.max(probabilityEdge, 0) * 0.16 +
              Math.max(priceDislocation, 0) * 0.12 +
              Math.max(marketMomentum, -0.05) * 0.1 -
              Math.max(riskFlag - 0.7, 0) * 0.35,
            -1,
            1,
          );

    return {
      market_momentum: marketMomentum,
      trend_regime: trendRegime,
      volume_spike: volumeSpike,
      news_heat: newsHeat,
      narrative_strength: narrativeStrength,
      catalyst_setup: catalystSetup,
      event_proximity: eventProximity,
      probability_edge: probabilityEdge,
      price_dislocation: priceDislocation,
      opportunity_quality: opportunityQuality,
      risk_flag: riskFlag,
    };
  }

  private scoreOpportunity(
    blueprint: ReturnType<typeof getManagerBlueprint>,
    opp: BacktestOpportunity,
    timestamp: number,
  ) {
    const firstPointTs = opp.historyPoints[0]?.pointAt?.getTime();
    if (!firstPointTs || firstPointTs > timestamp - 24 * 60 * 60 * 1000) {
      return null;
    }

    if (opp.eventDate && opp.eventDate.getTime() <= timestamp) {
      return null;
    }

    const currentPoint = this.getPointAtOrBefore(opp.historyPoints, timestamp);
    if (!currentPoint || currentPoint.price <= 0) {
      return null;
    }

    if (
      opp.type === OpportunityType.PREDICTION_MARKET &&
      (currentPoint.price <= 0.02 || currentPoint.price >= 0.98)
    ) {
      return null;
    }

    const signalMap = this.buildSignalMap(opp, timestamp);
    const opportunityBias = Number(blueprint.opportunityTypeBias?.[opp.type] ?? 0);
    const rawScore = clamp(
      Object.entries(blueprint.signalWeights).reduce(
        (sum, [name, weight]) => sum + Number(signalMap[name] ?? 0) * Number(weight),
        opportunityBias,
      ),
      -1,
      1,
    );

    return {
      id: opp.id,
      type: opp.type,
      score: round(rawScore, 4),
      targetWeight: round(clamp(rawScore, 0.03, 0.35), 4),
      historyPoints: opp.historyPoints,
    };
  }

  // --- Helpers ---

  private buildDailyTimestamps(start: number, end: number) {
    const timestamps: number[] = [];
    for (let cursor = start; cursor <= end; cursor += 24 * 60 * 60 * 1000) {
      timestamps.push(cursor);
    }
    if (timestamps[timestamps.length - 1] !== end) {
      timestamps.push(end);
    }
    return timestamps;
  }

  private getPointAtOrBefore(points: HistoryPointLike[], timestamp: number) {
    let selected: HistoryPointLike | null = null;
    for (const point of points) {
      if (point.pointAt.getTime() > timestamp) break;
      selected = point;
    }
    return selected;
  }

  private calculateChangeAt(
    points: HistoryPointLike[],
    timestamp: number,
    lookbackDays: number,
    type: OpportunityType,
  ) {
    const current = this.getPointAtOrBefore(points, timestamp);
    const anchor = this.getPointAtOrBefore(
      points,
      timestamp - lookbackDays * 24 * 60 * 60 * 1000,
    );
    if (!current || !anchor || anchor.price === 0) return 0;
    return type === OpportunityType.TOKEN
      ? ((current.price - anchor.price) / anchor.price) * 100
      : (current.price - anchor.price) * 100;
  }

  private calculateVolatilityAt(
    points: HistoryPointLike[],
    timestamp: number,
    lookbackDays: number,
    type: OpportunityType,
  ) {
    const trailing = points.filter(
      (p) =>
        p.pointAt.getTime() <= timestamp &&
        p.pointAt.getTime() >= timestamp - lookbackDays * 24 * 60 * 60 * 1000,
    );
    const returns = trailing
      .slice(1)
      .map((p, i) => {
        const prev = trailing[i];
        if (!prev?.price || prev.price === 0) return null as number | null;
        return type === OpportunityType.TOKEN
          ? (p.price - prev.price) / prev.price
          : p.price - prev.price;
      })
      .filter((v): v is number => Number.isFinite(v));
    return standardDeviation(returns);
  }

  private calculateVolumeSpikeAt(
    points: HistoryPointLike[],
    timestamp: number,
  ) {
    const current = this.getPointAtOrBefore(points, timestamp);
    const currentVol = Number(current?.volume ?? 0);
    if (!Number.isFinite(currentVol) || currentVol <= 0) return 0;

    const trailingVols = points
      .filter(
        (p) =>
          p.pointAt.getTime() < timestamp &&
          p.pointAt.getTime() >= timestamp - 30 * 24 * 60 * 60 * 1000 &&
          Number.isFinite(Number(p.volume)) &&
          Number(p.volume) > 0,
      )
      .map((p) => Number(p.volume));

    const baseline = trailingVols.length ? average(trailingVols) : 0;
    if (!baseline) return 0;
    return clamp(Math.log10(1 + currentVol / baseline) / 0.75, 0, 1);
  }

  private calculateTrailingPeakGap(
    points: HistoryPointLike[],
    timestamp: number,
    lookbackDays: number,
  ) {
    const trailing = points.filter(
      (p) =>
        p.pointAt.getTime() <= timestamp &&
        p.pointAt.getTime() >= timestamp - lookbackDays * 24 * 60 * 60 * 1000,
    );
    const current = this.getPointAtOrBefore(points, timestamp);
    if (!trailing.length || !current || current.price <= 0) return 0;
    const high = Math.max(...trailing.map((p) => p.price));
    if (!Number.isFinite(high) || high <= 0) return 0;
    return (high - current.price) / high;
  }

  private buildNewsContext(
    newsItems: Array<{ publishedAt: Date; sentimentScore: number | null }>,
    timestamp: number,
  ) {
    const trailing = newsItems.filter(
      (item) =>
        item.publishedAt.getTime() <= timestamp &&
        item.publishedAt.getTime() >= timestamp - 10 * 24 * 60 * 60 * 1000,
    );
    const sentiment = average(
      trailing
        .map((item) => Number(item.sentimentScore))
        .filter((v) => Number.isFinite(v)),
    );
    return {
      count: trailing.length,
      sentiment,
    };
  }

  private computeAssetReturn(
    managerSlug: string,
    type: OpportunityType,
    startPrice: number,
    endPrice: number,
  ) {
    if (!Number.isFinite(startPrice) || !Number.isFinite(endPrice) || startPrice <= 0) {
      return 0;
    }
    const rawReturn = endPrice / startPrice - 1;

    // Per-manager return clamps — widened to capture crypto volatility.
    // Only slugs that exist in the DB (see prisma/seed.ts) are listed;
    // anything else falls through to the conservative default below.
    if (managerSlug === 'narrative-manager') {
      return type === OpportunityType.TOKEN
        ? clamp(rawReturn, -0.05, 0.10)
        : clamp(rawReturn, -0.10, 0.16) * 0.28;
    }
    return type === OpportunityType.TOKEN
      ? clamp(rawReturn, -0.04, 0.06)
      : clamp(rawReturn, -0.08, 0.10) * 0.24;
  }

  private isAboveMA(
    opp: BacktestOpportunity,
    timestamp: number,
    periodDays: number,
  ): boolean {
    const currentPoint = this.getPointAtOrBefore(opp.historyPoints, timestamp);
    if (!currentPoint) return true;

    const windowStart = timestamp - periodDays * 24 * 60 * 60 * 1000;
    const windowPoints = opp.historyPoints.filter(
      (p) => p.pointAt.getTime() >= windowStart && p.pointAt.getTime() <= timestamp,
    );

    if (windowPoints.length < 5) return true;

    const ma = windowPoints.reduce((s, p) => s + p.price, 0) / windowPoints.length;
    return currentPoint.price > ma;
  }
}
