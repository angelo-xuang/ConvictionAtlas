import { Direction } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { getManagerBlueprint } from '../core/manager-blueprints';
import { average, dateKey, parseJson, round, serializeJson } from '../core/helpers';
import { isCurrentInvestableOpportunity } from '../core/opportunity-universe';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PortfolioService {
  constructor(private readonly prisma: PrismaService) {}

  async rebalancePortfolios(asOf: Date = new Date()) {
    const todayKey = dateKey(asOf);
    const managers = await this.prisma.manager.findMany();
    let snapshotsCreated = 0;

    for (const manager of managers) {
      const blueprint = getManagerBlueprint(manager.slug);
      // Use today's decisions if present; the engine writes per-day rows.
      const decisions = await this.prisma.managerDecision.findMany({
        where: {
          managerId: manager.id,
          direction: Direction.BULLISH,
          dateKey: todayKey,
        },
        orderBy: [{ convictionScore: 'desc' }, { targetWeight: 'desc' }],
        take: blueprint.maxPositions,
        include: {
          opportunity: {
            include: {
              signals: true,
            },
          },
        },
      });
      const investableDecisions = decisions.filter((decision) =>
        isCurrentInvestableOpportunity(decision.opportunity),
      );
      // Pick the most recent prior snapshot (any prior day) for NAV continuity.
      const previousSnapshot = await this.prisma.portfolioSnapshot.findFirst({
        where: { managerId: manager.id, dateKey: { lt: todayKey } },
        orderBy: { dateKey: 'desc' },
      });

      const investableCapital = investableDecisions.length
        ? 1 - blueprint.cashFloor
        : 0;
      const scoreTotal =
        investableDecisions.reduce(
          (sum, decision) => sum + decision.targetWeight,
          0,
        ) || 1;
      const riskValues = investableDecisions.map((decision) => {
        const riskSignal = decision.opportunity.signals.find(
          (signal) => signal.name === 'risk_flag',
        );
        return riskSignal?.value ?? 0;
      });

      const snapshotData = {
        cashWeight: round(1 - investableCapital, 4),
        grossExposure: round(investableCapital, 4),
        netExposure: round(investableCapital, 4),
        riskScore: round(average(riskValues), 4),
        nav: previousSnapshot?.nav ?? 100,
        metadata: serializeJson({
          decisionCount: investableDecisions.length,
          model: 'portfolio-engine-v1',
        }),
        computedAt: asOf,
      };

      const snapshot = await this.prisma.portfolioSnapshot.upsert({
        where: { managerId_dateKey: { managerId: manager.id, dateKey: todayKey } },
        create: {
          managerId: manager.id,
          dateKey: todayKey,
          ...snapshotData,
        },
        update: snapshotData,
      });

      // Replace positions for this snapshot (idempotent re-run).
      await this.prisma.position.deleteMany({
        where: { portfolioSnapshotId: snapshot.id },
      });
      if (investableDecisions.length) {
        await this.prisma.position.createMany({
          data: investableDecisions.map((decision) => ({
            portfolioSnapshotId: snapshot.id,
            opportunityId: decision.opportunityId,
            weight: round((decision.targetWeight / scoreTotal) * investableCapital, 4),
            convictionScore: decision.convictionScore,
            entryPrice: decision.opportunity.currentPrice ?? null,
            note: parseJson<any>(decision.metadata, {}).topHeadline ?? null,
          })),
        });
      }

      snapshotsCreated += 1;
    }

    return { snapshotsCreated, dateKey: todayKey };
  }
}
