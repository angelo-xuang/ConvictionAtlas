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
    slug: 'quant-manager',
    name: 'Quant Manager',
    description:
      '用动量、成交量和价格偏离信号对流动性标的打分，保持规则至上的投资组合。',
    style: '量化',
    riskProfile: '系统型',
    rebalanceCadence: '每日两次',
    memoStyle: '规则化市场复盘',
    universe: '流动性代币和价格发现中的预测市场',
    pricingSummary: '¥129/月 量化推送',
    metadata: JSON.stringify({
      signalWeights: {
        market_momentum: 0.26,
        trend_regime: 0.22,
        volume_spike: 0.16,
        price_dislocation: 0.14,
        opportunity_quality: 0.16,
        probability_edge: 0.04,
        event_proximity: 0.02,
        risk_flag: -0.18,
      },
      thresholds: {
        bullish: 0.14,
        bearish: -0.12,
      },
      opportunityTypeBias: {
        TOKEN: 0.12,
        PREDICTION_MARKET: -0.22,
      },
    }),
    pricingPlans: [
      {
        name: 'Quant Feed',
        cadence: 'monthly',
        amountUsd: 19,
        description: '每日信号摘要和最新系统化投资组合。',
      },
    ],
  },
  {
    slug: 'hybrid-manager',
    name: 'Hybrid Manager',
    description:
      '融合市场结构、催化事件检测和主题分析，运行多元化的高信念投资组合。',
    style: '混合',
    riskProfile: '自适应',
    rebalanceCadence: '每日',
    memoStyle: '均衡投资组合报告',
    universe: '代币、预测市场和跨市场催化篮子',
    pricingSummary: '¥339/月 旗舰策略',
    metadata: JSON.stringify({
      signalWeights: {
        market_momentum: 0.14,
        trend_regime: 0.12,
        narrative_strength: 0.14,
        news_heat: 0.12,
        opportunity_quality: 0.16,
        event_proximity: 0.08,
        volume_spike: 0.12,
        price_dislocation: 0.10,
        probability_edge: 0.06,
        risk_flag: -0.14,
      },
      thresholds: {
        bullish: 0.12,
        bearish: -0.12,
      },
      opportunityTypeBias: {
        TOKEN: 0.06,
        PREDICTION_MARKET: -0.12,
      },
    }),
    pricingPlans: [
      {
        name: 'Flagship Atlas',
        cadence: 'monthly',
        amountUsd: 49,
        description: '完整备忘录、投资组合可见性和高级内容解锁。',
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
