import { Injectable } from '@nestjs/common';
import {
  average,
  dateKey,
  round,
  serializeJson,
  standardDeviation,
} from '../core/helpers';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshotPerformance(asOf: Date = new Date()) {
    const todayKey = dateKey(asOf);
    const managers = await this.prisma.manager.findMany();
    let created = 0;

    for (const manager of managers) {
      const todayPortfolio = await this.prisma.portfolioSnapshot.findUnique({
        where: { managerId_dateKey: { managerId: manager.id, dateKey: todayKey } },
        include: {
          positions: {
            include: {
              opportunity: true,
            },
          },
        },
      });

      if (!todayPortfolio) {
        continue;
      }

      // Previous performance: most recent strictly-prior day.
      const previous = await this.prisma.performanceSnapshot.findFirst({
        where: { managerId: manager.id, dateKey: { lt: todayKey } },
        orderBy: { dateKey: 'desc' },
      });
      // Historical series for sharpe / drawdown stats (exclude today; today will be appended).
      const historical = await this.prisma.performanceSnapshot.findMany({
        where: { managerId: manager.id, dateKey: { lt: todayKey } },
        orderBy: { dateKey: 'asc' },
      });

      const positionReturns = todayPortfolio.positions.map((position) => {
        return (position.weight * (position.opportunity.priceChange24h ?? 0)) / 100;
      });
      const dailyReturn = round(
        positionReturns.reduce((sum, value) => sum + value, 0),
        4,
      );
      const nav = round((previous?.nav ?? 100) * (1 + dailyReturn), 4);
      const cumulativeReturn = round(nav / 100 - 1, 4);
      const maxNav = Math.max(100, nav, ...historical.map((entry) => entry.nav));
      const drawdown = round(nav / maxNav - 1, 4);
      const returns = [...historical.map((entry) => entry.dailyReturn), dailyReturn];
      const avgReturn = average(returns);
      const stdDev = standardDeviation(returns);
      const sharpe = round(stdDev === 0 ? avgReturn : avgReturn / stdDev, 4);
      const hitRate = todayPortfolio.positions.length
        ? round(
            todayPortfolio.positions.filter(
              (position) => (position.opportunity.priceChange24h ?? 0) > 0,
            ).length / todayPortfolio.positions.length,
            4,
          )
        : 0;

      const perfData = {
        portfolioSnapshotId: todayPortfolio.id,
        nav,
        dailyReturn,
        cumulativeReturn,
        drawdown,
        sharpe,
        hitRate,
        metadata: serializeJson({
          positionCount: todayPortfolio.positions.length,
          model: 'performance-engine-v1',
        }),
        computedAt: asOf,
      };

      await this.prisma.performanceSnapshot.upsert({
        where: { managerId_dateKey: { managerId: manager.id, dateKey: todayKey } },
        create: { managerId: manager.id, dateKey: todayKey, ...perfData },
        update: perfData,
      });

      await this.prisma.portfolioSnapshot.update({
        where: { id: todayPortfolio.id },
        data: { nav },
      });

      created += 1;
    }

    return { created, dateKey: todayKey };
  }
}
