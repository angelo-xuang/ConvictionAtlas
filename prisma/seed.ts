import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 4 个 linear 实验经理(narrative / event-driven / onchain-fundamentals /
// prediction-market)已于 2026-06-12 下线删除(DB 级联清除, 备份
// conviction-atlas.db.bak_20260612_del4mgr)。seed 仅保留在运营的经理。
const managers = [
  {
    slug: 'crypto-cta',
    name: 'Crypto CTA',
    description:
      '纯量价系统化交易。不看新闻不听故事，只根据价格趋势强度、动量方向和波动率信号做出系统性决策。趋势明确时跟随，震荡时自动空仓等待。',
    style: '量价CTA',
    riskProfile: '系统型',
    rebalanceCadence: '每日',
    memoStyle: '技术面分析报告',
    universe: '流动性充足的主流加密货币（按成交量筛选）',
    pricingSummary: '¥249/月 量价研究',
    metadata: JSON.stringify({
      strategyType: 'cta',
      signalWeights: {},
      thresholds: { bullish: 0.1, bearish: -0.1 },
      opportunityTypeBias: { TOKEN: 0.0, PREDICTION_MARKET: -1.0 },
      dataSources: ['coingecko-ohlcv'],
    }),
    pricingPlans: [
      {
        name: 'CTA Desk',
        cadence: 'monthly',
        amountUsd: 36,
        description: '每日技术面分析、趋势跟踪信号、持仓报告。',
      },
    ],
  },
];

async function main() {
  for (const manager of managers) {
    const record = await prisma.manager.upsert({
      where: { slug: manager.slug },
      update: {
        name: manager.name,
        description: manager.description,
        style: manager.style,
        riskProfile: manager.riskProfile,
        rebalanceCadence: manager.rebalanceCadence,
        memoStyle: manager.memoStyle,
        universe: manager.universe,
        pricingSummary: manager.pricingSummary,
        metadata: manager.metadata,
      },
      create: {
        slug: manager.slug,
        name: manager.name,
        description: manager.description,
        style: manager.style,
        riskProfile: manager.riskProfile,
        rebalanceCadence: manager.rebalanceCadence,
        memoStyle: manager.memoStyle,
        universe: manager.universe,
        pricingSummary: manager.pricingSummary,
        metadata: manager.metadata,
      },
    });

    await prisma.pricingPlan.deleteMany({ where: { managerId: record.id } });
    await prisma.pricingPlan.createMany({
      data: manager.pricingPlans.map((plan) => ({
        managerId: record.id,
        name: plan.name,
        cadence: plan.cadence,
        amountUsd: plan.amountUsd,
        description: plan.description,
      })),
    });
  }
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
