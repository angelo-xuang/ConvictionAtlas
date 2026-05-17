import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const managers = [
  {
    slug: 'narrative-manager',
    name: 'Narrative Manager',
    description:
      '追踪突破性主题、注意力流动和跨市场叙事轮动，执行高信念的主题性交易。',
    style: '叙事驱动',
    riskProfile: '积极型',
    rebalanceCadence: '每日',
    memoStyle: '主题先行，逻辑驱动',
    universe: '大盘代币、催化密集型市场、叙事突破',
    pricingSummary: '¥199/月 研究订阅',
    metadata: JSON.stringify({
      signalWeights: {
        narrative_strength: 0.26,
        news_heat: 0.18,
        market_momentum: 0.14,
        trend_regime: 0.16,
        opportunity_quality: 0.18,
        volume_spike: 0.08,
        event_proximity: 0.04,
        price_dislocation: 0.06,
        risk_flag: -0.16,
      },
      thresholds: {
        bullish: 0.14,
        bearish: -0.12,
      },
      opportunityTypeBias: {
        TOKEN: 0.10,
        PREDICTION_MARKET: -0.18,
      },
    }),
    pricingPlans: [
      {
        name: 'Narrative Pro',
        cadence: 'monthly',
        amountUsd: 29,
        description: '解锁主题备忘录和每日机会观察列表。',
      },
    ],
  },
  {
    slug: 'event-driven-manager',
    name: 'Event-driven Manager',
    description:
      '聚焦事件日历、概率变化和截止日期临近，覆盖预测市场和代币催化事件。',
    style: '事件驱动',
    riskProfile: '均衡型',
    rebalanceCadence: '日内',
    memoStyle: '催化事件与情景分析',
    universe: '预测市场、催化事件、高影响力新闻',
    pricingSummary: '¥269/月 催化研究',
    metadata: JSON.stringify({
      signalWeights: {
        catalyst_setup: 0.26,
        event_proximity: 0.18,
        probability_edge: 0.12,
        trend_regime: 0.1,
        news_heat: 0.08,
        narrative_strength: 0.08,
        opportunity_quality: 0.08,
        market_momentum: 0.05,
        volume_spike: 0.07,
        risk_flag: -0.18,
      },
      thresholds: {
        bullish: 0.10,
        bearish: -0.12,
      },
      opportunityTypeBias: {
        TOKEN: 0.04,
        PREDICTION_MARKET: 0.04,
      },
    }),
    pricingPlans: [
      {
        name: 'Catalyst Desk',
        cadence: 'monthly',
        amountUsd: 39,
        description: '访问事件备忘录、提醒推送和再平衡解读。',
      },
    ],
  },
  {
    slug: 'onchain-fundamentals-manager',
    name: 'On-chain Fundamentals',
    description:
      '以链上基本面为核心，结合 DeFi 协议的 TVL、手续费收入和链上活跃度数据，执行保守型投资策略。',
    style: '链上基本面',
    riskProfile: '保守型',
    rebalanceCadence: '每12小时',
    memoStyle: '协议基本面简报',
    universe: '具有可衡量 TVL、手续费收入和链上活跃度的 DeFi 协议（ETH、SOL、TRON、Base 生态）',
    pricingSummary: '¥309/月 基本面研究',
    metadata: JSON.stringify({
      signalWeights: {
        opportunity_quality: 0.28,
        volume_spike: 0.22,
        trend_regime: 0.16,
        price_dislocation: 0.18,
        probability_edge: 0.04,
        event_proximity: 0.06,
        narrative_strength: 0.04,
        risk_flag: -0.24,
      },
      thresholds: {
        bullish: 0.16,
        bearish: -0.10,
      },
      opportunityTypeBias: {
        TOKEN: 0.12,
        PREDICTION_MARKET: -0.25,
      },
      dataSources: ['defillama-api', 'whale-watch', 'crypto-whale-monitor', 'mobula', 'nansen-smart-money-tracker'],
    }),
    pricingPlans: [
      {
        name: 'Fundamentals Desk',
        cadence: 'monthly',
        amountUsd: 45,
        description: 'TVL 流动报告、聪明资金异动提醒、协议升级观察列表。',
      },
    ],
  },
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
  {
    slug: 'prediction-market-manager',
    name: 'Prediction Market Manager',
    description:
      '专注 Polymarket 加密预测市场的概率套利。利用概率偏差、事件临近度和催化剂信号，捕捉预测市场的定价错误。',
    style: '预测市场',
    riskProfile: '事件型',
    rebalanceCadence: '每日',
    memoStyle: '概率分析与事件情景',
    universe: 'Polymarket 加密预测市场（BTC 价格目标、ETF 审批、DeFi TVL、监管政策等）',
    pricingSummary: '¥199/月 预测市场研究',
    metadata: JSON.stringify({
      signalWeights: {
        probability_edge: 0.24,
        event_proximity: 0.20,
        catalyst_setup: 0.14,
        trend_regime: 0.14,
        opportunity_quality: 0.10,
        volume_spike: 0.08,
        news_heat: 0.06,
        price_dislocation: 0.06,
        risk_flag: -0.20,
      },
      thresholds: {
        bullish: 0.08,
        bearish: -0.06,
      },
      opportunityTypeBias: {
        TOKEN: -0.16,
        PREDICTION_MARKET: 0.20,
      },
      dataSources: ['polymarket-gamma', 'polymarket-clob'],
    }),
    pricingPlans: [
      {
        name: 'PM Edge',
        cadence: 'monthly',
        amountUsd: 29,
        description: '预测市场概率分析、事件提醒和持仓追踪。',
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
