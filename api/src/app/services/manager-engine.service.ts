import { Direction } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { getManagerBlueprint } from '../core/manager-blueprints';
import { clamp, dateKey, round, serializeJson } from '../core/helpers';
import { isCurrentInvestableOpportunity } from '../core/opportunity-universe';
import { PrismaService } from '../prisma/prisma.service';
import { computeAllIndicators, type CandleLike } from '../core/technical-indicators';
import { ctaScore } from '../core/scoring/cta-scoring';

@Injectable()
export class ManagerEngineService {
  constructor(private readonly prisma: PrismaService) {}

  async runManagers(asOf: Date = new Date()) {
    const todayKey = dateKey(asOf);
    const managers = await this.prisma.manager.findMany();
    const opportunities = (
      await this.prisma.opportunity.findMany({
        where: { status: 'active' },
        include: {
          signals: true,
          newsItems: {
            orderBy: { publishedAt: 'desc' },
            take: 2,
          },
        },
      })
    ).filter((opportunity) => isCurrentInvestableOpportunity(opportunity));

    const computedAt = asOf;
    const rows: Array<{
      managerId: string;
      opportunityId: string;
      dateKey: string;
      direction: Direction;
      convictionScore: number;
      targetWeight: number;
      rationale: string;
      computedAt: Date;
      metadata: string;
    }> = [];

    for (const manager of managers) {
      const blueprint = getManagerBlueprint(manager.slug);

      for (const opportunity of opportunities) {
      if (blueprint.strategyType === 'cta') {
        // ─── CTA Decision Path ───
        if (opportunity.type !== 'TOKEN') continue; // CTA only trades tokens
        const candles = await this.prisma.candle.findMany({
          where: { opportunityId: opportunity.id, timeframe: '1d' },
          orderBy: { timestamp: 'asc' },
        });
        if (candles.length < 30) continue; // Need at least 30 days
        const candleLikes: CandleLike[] = candles.map(c => ({
          open: c.open, high: c.high, low: c.low, close: c.close,
          volume: c.volume, timestamp: c.timestamp,
        }));
        const indicators = computeAllIndicators(candleLikes);
        const params = blueprint.ctaParams!;
        const result = ctaScore(indicators, params);
        const direction =
          result.direction === 'BULLISH' ? Direction.BULLISH :
          result.direction === 'BEARISH' ? Direction.BEARISH :
          Direction.NEUTRAL;
        rows.push({
          managerId: manager.id,
          opportunityId: opportunity.id,
          dateKey: todayKey,
          direction,
          convictionScore: round(result.direction === 'NEUTRAL' ? 0 : result.score, 4),
          targetWeight: round(result.positionSize, 4),
          rationale: result.rationale,
          computedAt,
          metadata: serializeJson({
            blueprint: blueprint.label,
            strategyType: 'cta',
            indicators,
            topHeadline: opportunity.newsItems[0]?.title ?? null,
          }),
        });
      } else {
        // ─── Linear Decision Path (existing) ───
        const signalMap = Object.fromEntries(
          opportunity.signals.map((signal) => [signal.name, signal.value]),
        );
        const opportunityBias = Number(
          blueprint.opportunityTypeBias?.[opportunity.type] ?? 0,
        );
        const drivers = Object.entries(blueprint.signalWeights!).map(
          ([signalName, weight]) => {
            const value = Number(signalMap[signalName] ?? 0);
            return {
              signalName,
              value,
              weight,
              contribution: round(value * weight, 4),
            };
          },
        );
        const rawScore = clamp(
          drivers.reduce((sum, driver) => sum + driver.contribution, 0) +
            opportunityBias,
          -1,
          1,
        );
        const direction =
          rawScore > blueprint.bullishThreshold!
            ? Direction.BULLISH
            : rawScore < blueprint.bearishThreshold!
              ? Direction.BEARISH
              : Direction.NEUTRAL;
        const targetWeight =
          direction === Direction.BULLISH ? clamp(rawScore, 0.03, 0.35) : 0;
        const rationaleDrivers = [...drivers]
          .sort(
            (left, right) =>
              Math.abs(right.contribution) - Math.abs(left.contribution),
          )
          .slice(0, 3)
          .map(
            (driver) =>
              `${driver.signalName}=${round(driver.value, 3)} @ ${round(driver.weight, 2)}`,
          );

        rows.push({
          managerId: manager.id,
          opportunityId: opportunity.id,
          dateKey: todayKey,
          direction,
          convictionScore: round(rawScore, 4),
          targetWeight: round(targetWeight, 4),
          rationale: `${manager.name} is leaning ${direction.toLowerCase()} because ${rationaleDrivers.join(
            ', ',
          )}.`,
          computedAt,
          metadata: serializeJson({
            blueprint: blueprint.label,
            strategyType: 'linear',
            opportunityBias,
            thresholds: {
              bullish: blueprint.bullishThreshold,
              bearish: blueprint.bearishThreshold,
            },
            drivers,
            topHeadline: opportunity.newsItems[0]?.title ?? null,
          }),
        });
      }
      }
    }

    for (const row of rows) {
      const { managerId, opportunityId, dateKey: rowDateKey, ...rest } = row;
      await this.prisma.managerDecision.upsert({
        where: {
          managerId_opportunityId_dateKey: {
            managerId,
            opportunityId,
            dateKey: rowDateKey,
          },
        },
        create: { managerId, opportunityId, dateKey: rowDateKey, ...rest },
        update: rest,
      });
    }

    return {
      managers: managers.length,
      opportunities: opportunities.length,
      decisions: rows.length,
      dateKey: todayKey,
      computedAt,
    };
  }
}
