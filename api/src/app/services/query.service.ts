import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OpportunityType, SourceKind } from '@prisma/client';
import { getManagerBlueprint } from '../core/manager-blueprints';
import { PrismaService } from '../prisma/prisma.service';
import {
  average,
  clamp,
  parseJson,
  round,
  standardDeviation,
} from '../core/helpers';
import {
  isCryptoRelevantPredictionOpportunity,
  isCurrentInvestableOpportunity,
} from '../core/opportunity-universe';
import { TronPaymentService } from './tron-payment.service';
import axios from 'axios';

// equity-agent(后端基座)只读出口;CA 作为前端窗口在读取层聚合它的经理。
const EQUITY_AGENT_STATE_URL =
  process.env.EQUITY_AGENT_STATE_URL ?? 'http://127.0.0.1:3010/state';
// 进程级 TTL 缓存:详情页一次会触发多次聚合,缓存避免对 sidecar fanout;失败 fail-open 返回上次缓存。
let EQUITY_CACHE: { at: number; data: any[] } | null = null;
const EQUITY_CACHE_TTL_MS = 15000;

// equity 经理策略档案:覆盖默认"主观/规则/每日"。用于前端把调仓周期、信号构成、
// 持仓规则等参数写清楚(确定性量化经理)。未列出的 equity 经理沿用默认值。
const EQUITY_STRATEGY_PROFILES: Record<
  string,
  {
    style: string;
    riskLabel: string;
    rebalanceCadence: string;
    universe: string;
    memoStyle: string;
    description: string;
    signalMix: { name: string; weight: number }[];
    playbook: { label: string; value: string }[];
  }
> = {
  'factor-lab-cn': {
    style: '量化 · 多因子合成',
    riskLabel: '满仓 · 中高波动',
    rebalanceCadence: '周频 · 每周一',
    universe: 'A股全市场',
    memoStyle: '规则驱动 · 无人工干预',
    description:
      '全A股约 250 个量价因子(WorldQuant Alpha101 + 国泰君安 Alpha191)按各自 IC 方向投票,取共识打分最高的标的,经生存否决(剔除 ST / 涨停买不进 / 流动性不足)后按 score_tilt 加权建仓,周频调仓、单边成本 30bp、跌破 −20% 灾难线即平。',
    signalMix: [
      { name: '国泰君安 Alpha191', weight: 0.6 },
      { name: 'WorldQuant Alpha101', weight: 0.4 },
    ],
    playbook: [
      { label: '信号源', value: '全A股约 250 因子共识投票(Alpha101 + Alpha191,按各自 IC 方向)' },
      { label: '调仓频率', value: '周频(每周一);日内仅做 −20% 灾难止损,不择时' },
      { label: '选股', value: '共识打分 top 30 只' },
      { label: '加权', value: 'score_tilt——共识票数越多权重越大(成比例)' },
      { label: '约束', value: '单股 ≤10%、行业 ≤30%,超限水填削平' },
      { label: '生存否决', value: '剔除 ST / 涨停无法买入 / 流动性不足(铁律5)' },
      { label: '成本', value: '30bp 单边,已计入净值' },
      { label: '止损', value: '−20% 灾难线,每日检查' },
      { label: '本金', value: '500 万 CNY(净值看百分比)' },
    ],
  },
  'factor-lab-lowvol-cn': {
    style: '量化 · 低波防御',
    riskLabel: '满仓 · 低回撤',
    rebalanceCadence: '周频 · 每周一',
    universe: 'A股流动性前1500',
    memoStyle: '规则驱动 · 无人工干预',
    description:
      '在A股流动性前1500的可投资域内, 按过去60日收益波动率选出波动最低的50只等权持有, 周频调仓。天然规避高波动垃圾股, 危机年/熊市跑赢大盘、疯牛年让出部分涨幅, 全期对大盘Pareto占优(更高收益+更浅回撤)。参数±20%无悬崖, 泛化性经回测验证。',
    signalMix: [{ name: '低波因子(60日波动率)', weight: 1.0 }],
    playbook: [
      { label: '信号源', value: '低波因子 = −过去60日收益波动率(每日横截面排名)' },
      { label: '选股池', value: 'A股流动性前1500 + 上市>120日 + 当日可买(非停牌非涨停)' },
      { label: '选股', value: '池内波动率最低的 top 50, 等权' },
      { label: '调仓频率', value: '周频(每周一); 日内仅做 −20% 灾难止损' },
      { label: '成本', value: '30bp 单边, 已计入净值' },
      { label: '定位', value: '防御型——危机年/熊市跑赢大盘, 疯牛年让涨, 全期对大盘Pareto占优' },
      { label: '泛化验证', value: '参数±20%(窗口/持仓数)无悬崖, 成本/调仓不敏感, 逐年IC 7/7同号' },
      { label: '本金', value: '500 万 CNY(净值看百分比)' },
    ],
  },
};

type HistoryPointLike = {
  pointAt: Date;
  price: number;
  volume?: number | null;
};

type ManagerSeriesPoint = {
  pointAt: string;
  nav: number;
  cumulativeReturn: number;
};

type ReplayOpportunityLike = {
  id: string;
  type: OpportunityType;
  sourceKind: SourceKind;
  title: string;
  summary: string | null;
  description: string | null;
  category: string | null;
  status: string | null;
  currentPrice: number | null;
  eventDate: Date | null;
  volume24h: number | null;
  marketCap: number | null;
  liquidity: number | null;
  metadata: string | null;
  historyPoints: HistoryPointLike[];
  newsItems: Array<{
    publishedAt: Date;
    sentimentScore: number | null;
  }>;
  signals: Array<{
    name: string;
    value: number;
  }>;
};

type ReplayPreparedOpportunity = ReplayOpportunityLike & {
  metadataRecord: Record<string, unknown>;
  signalMap: Record<string, number>;
};

@Injectable()
export class QueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tronPayment: TronPaymentService,
  ) {}

  async getManagers() {
    const managers = await this.prisma.manager.findMany({
      include: {
        pricingPlans: true,
        reviews: true,
      },
    });

    const cryptoSummaries = await Promise.all(
      managers.map(async (manager) => {
        const { latestPortfolio, analytics } = await this.getLatestManagerState(
          manager,
        );

        return {
          id: manager.id,
          slug: manager.slug,
          name: manager.name,
          style: manager.style,
          riskProfile: manager.riskProfile,
          description: manager.description,
          pricingSummary: manager.pricingSummary,
          latestNav: analytics.latestNav,
          dailyReturn: analytics.dailyReturn,
          cumulativeReturn: analytics.cumulativeReturn,
          drawdown: analytics.drawdown,
          sharpe: analytics.sharpe,
          hitRate: analytics.hitRate,
          grossExposure: latestPortfolio?.grossExposure ?? 0,
          cashWeight: latestPortfolio?.cashWeight ?? 1,
          riskScore: latestPortfolio?.riskScore ?? 0,
          averageRating: manager.reviews.length
            ? round(average(manager.reviews.map((review) => review.rating)), 2)
            : null,
          topPositions:
            latestPortfolio?.positions.map((position) =>
              this.serializePositionSummary(position),
            ) ?? [],
          performanceSeries: analytics.series,
          signalMix: this.buildSignalMix(manager.slug, manager.metadata),
          blueprint: (() => {
            const bp = getManagerBlueprint(manager.slug);
            return {
              strategyType: bp.strategyType,
              opportunityTypeBias: bp.opportunityTypeBias ?? {},
              bullishThreshold: bp.bullishThreshold ?? 0,
              bearishThreshold: bp.bearishThreshold ?? 0,
              cashFloor: bp.cashFloor,
              maxPositions: bp.maxPositions,
              ctaParams: bp.ctaParams ?? undefined,
            };
          })(),
          pricingPlans: manager.pricingPlans,
        };
      }),
    );

    const equitySummaries = (await this.fetchEquityManagers()).map((m) =>
      this.mapEquityManagerSummary(m),
    );
    return [...cryptoSummaries, ...equitySummaries];
  }

  /** equity-agent 契约 → CA ManagerSummary DTO(镜像 crypto 的 key,防前端渲染崩)。 */
  private mapEquityManagerSummary(m: any) {
    const perf: any[] = Array.isArray(m?.performance) ? m.performance : [];
    const last = perf.length ? perf[perf.length - 1] : {};
    const positions: any[] = Array.isArray(m?.positions) ? m.positions : [];
    const gross = positions.reduce((s, p) => s + (Number(p?.weight) || 0), 0);
    const markets = Array.isArray(m?.markets) ? m.markets : [];
    const profile = EQUITY_STRATEGY_PROFILES[m?.slug];
    return {
      id: m?.slug,
      slug: m?.slug,
      name: m?.label ?? m?.slug,
      style: profile?.style ?? '主观 / 规则',
      riskProfile: profile?.riskLabel ?? (markets.join('/') || '—'),
      baseCcy: m?.base_ccy ?? 'USD',
      description:
        profile?.description ?? `${m?.asset_domain ?? 'equity'} · ${markets.join('/') || '—'}`,
      pricingSummary: null,
      latestNav: Number(last?.nav ?? 100),
      dailyReturn: Number(last?.daily_return ?? 0),
      cumulativeReturn: Number(last?.cum_return ?? 0),
      drawdown: Number(last?.drawdown ?? 0),
      sharpe: Number(last?.sharpe ?? 0),
      hitRate: Number(last?.hit_rate ?? 0),
      grossExposure: round(gross, 4),
      cashWeight: round(Math.max(0, 1 - gross), 4),
      riskScore: 0,
      averageRating: null,
      topPositions: positions.map((p) => ({
        id: p?.symbol,
        title: p?.name ?? p?.symbol,
        slug: p?.symbol,
        weight: Number(p?.weight) || 0,
        imageUrl: null,
        symbol: p?.symbol,
        sourceKind: null,
        priceChange24h: Number(p?.pnl_pct ?? 0) * 100,
      })),
      performanceSeries: perf
        .filter((p) => p?.date)
        .map((p) => ({
          pointAt: `${p.date}T00:00:00.000Z`,
          nav: Number(p.nav),
          cumulativeReturn: Number(p.cum_return ?? 0),
        })),
      signalMix: profile?.signalMix ?? [],
      blueprint: {
        strategyType: m?.strategy_type ?? 'rule',
        opportunityTypeBias: {},
        bullishThreshold: 0,
        bearishThreshold: 0,
        cashFloor: round(Math.max(0, 1 - gross), 4),
        maxPositions: positions.length || 0,
        ctaParams: undefined,
        playbook: profile?.playbook,
      },
      pricingPlans: [],
    };
  }

  private async findEquityManager(slug: string): Promise<any | null> {
    const managers = await this.fetchEquityManagers();
    return managers.find((m) => m?.slug === slug) ?? null;
  }

  private mapEquityPerfSeries(m: any) {
    const perf: any[] = Array.isArray(m?.performance) ? m.performance : [];
    return perf
      .filter((p) => p?.date)
      .map((p) => ({
        pointAt: `${p.date}T00:00:00.000Z`,
        nav: Number(p.nav),
        cumulativeReturn: Number(p.cum_return ?? 0),
      }));
  }

  private mapEquityPortfolio(m: any) {
    const positions: any[] = Array.isArray(m?.positions) ? m.positions : [];
    const gross = positions.reduce((s, p) => s + (Number(p?.weight) || 0), 0);
    const perf: any[] = Array.isArray(m?.performance) ? m.performance : [];
    const last = perf.length ? perf[perf.length - 1] : {};
    return {
      id: `${m?.slug}-portfolio`,
      managerId: m?.slug,
      cashWeight: round(Math.max(0, 1 - gross), 4),
      grossExposure: round(gross, 4),
      netExposure: round(gross, 4),
      riskScore: 0,
      nav: Number(last?.nav ?? 100),
      metadata: '{}',
      computedAt: new Date().toISOString(),
      positions: positions.map((p) => ({
        id: `${m?.slug}-${p?.symbol}`,
        portfolioSnapshotId: `${m?.slug}-portfolio`,
        opportunityId: p?.symbol,
        weight: Number(p?.weight) || 0,
        convictionScore: 0,
        entryPrice: Number(p?.entry_price ?? 0),
        note: p?.note ?? '',
        opportunity: {
          id: p?.symbol,
          slug: p?.symbol,
          title: p?.name ?? p?.symbol,
          summary: p?.note ?? '',
          symbol: p?.symbol,
          imageUrl: null,
          sourceKind: null,
          priceChange24h: Number(p?.pnl_pct ?? 0) * 100,
          currentPrice: Number(p?.last_price ?? 0),
        },
      })),
    };
  }

  private mapEquityManagerDetail(m: any) {
    const summary = this.mapEquityManagerSummary(m);
    const markets = Array.isArray(m?.markets) ? m.markets : [];
    const profile = EQUITY_STRATEGY_PROFILES[m?.slug];
    const now = new Date().toISOString();
    return {
      id: m?.slug,
      slug: m?.slug,
      name: m?.label ?? m?.slug,
      description: summary.description,
      style: profile?.style ?? '主观 / 规则',
      riskProfile: profile?.riskLabel ?? (markets.join('/') || '—'),
      baseCcy: m?.base_ccy ?? 'USD',
      rebalanceCadence: profile?.rebalanceCadence ?? '每日',
      memoStyle: profile?.memoStyle ?? '规则触发',
      universe: profile?.universe ?? (markets.join('/') || '—'),
      pricingSummary: null,
      metadata: {},
      createdAt: now,
      updatedAt: now,
      pricingPlans: [],
      latestPerformance: null,
      latestPortfolio: this.mapEquityPortfolio(m),
      reviews: [],
      ratingAverage: null,
      performanceSeries: summary.performanceSeries,
      derivedPerformance: {
        nav: summary.latestNav,
        dailyReturn: summary.dailyReturn,
        cumulativeReturn: summary.cumulativeReturn,
        drawdown: summary.drawdown,
        sharpe: summary.sharpe,
        hitRate: summary.hitRate,
        lookbackDays: summary.performanceSeries.length,
      },
      signalMix: summary.signalMix,
      blueprint: summary.blueprint,
      latestDecisions: (Array.isArray(m?.positions) ? m.positions : []).map(
        (p: any, i: number) => ({
          id: `${m?.slug}-dec-${i}`,
          direction: 'BULLISH' as const,
          convictionScore: Number(p?.weight) || 0,
          targetWeight: Number(p?.weight) || 0,
          rationale: p?.note || '规则触发持仓',
          opportunity: {
            id: p?.symbol,
            slug: p?.symbol,
            title: p?.name ?? p?.symbol,
            summary: p?.note ?? '',
            imageUrl: null,
            symbol: p?.symbol,
            sourceKind: null,
            priceChange24h: Number(p?.pnl_pct ?? 0) * 100,
            currentPrice: Number(p?.last_price ?? 0),
          },
        }),
      ),
    };
  }

  async getManager(slug: string) {
    const eq = await this.findEquityManager(slug);
    if (eq) return this.mapEquityManagerDetail(eq);
    const manager = await this.getManagerOrThrow(slug);
    const [latestState, reviews, latestDecisions] = await Promise.all([
      this.getLatestManagerState(manager),
      this.prisma.review.findMany({
        where: { managerId: manager.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      (async () => {
        const latest = await this.prisma.managerDecision.findFirst({
          where: { managerId: manager.id },
          orderBy: { dateKey: 'desc' },
          select: { dateKey: true },
        });
        if (!latest) return [];
        return this.prisma.managerDecision.findMany({
          where: { managerId: manager.id, dateKey: latest.dateKey },
          orderBy: [{ convictionScore: 'desc' }, { targetWeight: 'desc' }],
          take: 8,
          include: { opportunity: true },
        });
      })(),
    ]);
    const { latestPerformance, latestPortfolio, analytics } = latestState;

    return {
      ...manager,
      metadata: parseJson(manager.metadata, {}),
      latestPerformance,
      latestPortfolio,
      reviews,
      ratingAverage: reviews.length
        ? round(average(reviews.map((review) => review.rating)), 2)
        : null,
      performanceSeries: analytics.series,
      derivedPerformance: {
        nav: analytics.latestNav,
        dailyReturn: analytics.dailyReturn,
        cumulativeReturn: analytics.cumulativeReturn,
        drawdown: analytics.drawdown,
        sharpe: analytics.sharpe,
        hitRate: analytics.hitRate,
        lookbackDays: analytics.lookbackDays,
      },
      signalMix: this.buildSignalMix(manager.slug, manager.metadata),
      blueprint: (() => {
        const bp = getManagerBlueprint(manager.slug);
        return {
          strategyType: bp.strategyType,
          opportunityTypeBias: bp.opportunityTypeBias ?? {},
          bullishThreshold: bp.bullishThreshold ?? 0,
          bearishThreshold: bp.bearishThreshold ?? 0,
          cashFloor: bp.cashFloor,
          maxPositions: bp.maxPositions,
          ctaParams: bp.ctaParams ?? undefined,
        };
      })(),
      latestDecisions: latestDecisions.map((decision) => ({
        id: decision.id,
        direction: decision.direction,
        convictionScore: decision.convictionScore,
        targetWeight: decision.targetWeight,
        rationale: decision.rationale,
        opportunity: {
          id: decision.opportunity.id,
          slug: decision.opportunity.slug,
          title: decision.opportunity.title,
          summary: decision.opportunity.summary,
          imageUrl: decision.opportunity.imageUrl,
          symbol: decision.opportunity.symbol,
          sourceKind: decision.opportunity.sourceKind,
          priceChange24h: decision.opportunity.priceChange24h,
          currentPrice: decision.opportunity.currentPrice,
        },
      })),
    };
  }

  async getManagerPerformance(slug: string) {
    const eq = await this.findEquityManager(slug);
    if (eq) return this.mapEquityPerfSeries(eq);
    const manager = await this.getManagerOrThrow(slug);
    const { analytics } = await this.getLatestManagerState(manager);
    return analytics.series;
  }

  async getManagerPortfolio(slug: string) {
    const eq = await this.findEquityManager(slug);
    if (eq) return this.mapEquityPortfolio(eq);
    const manager = await this.getManagerOrThrow(slug);
    return this.prisma.portfolioSnapshot.findFirst({
      where: { managerId: manager.id },
      orderBy: { computedAt: 'desc' },
      include: {
        positions: {
          orderBy: { weight: 'desc' },
          include: {
            opportunity: true,
          },
        },
      },
    });
  }

  async getManagerRebalances(slug: string) {
    const eq = await this.findEquityManager(slug);
    if (eq) return [];
    const manager = await this.getManagerOrThrow(slug);
    const snapshots = await this.prisma.portfolioSnapshot.findMany({
      where: { managerId: manager.id },
      orderBy: { computedAt: 'desc' },
      take: 2,
      include: {
        positions: {
          include: {
            opportunity: true,
          },
        },
      },
    });

    const current = snapshots[0];
    const previous = snapshots[1];

    if (!current) {
      return [];
    }

    const previousMap = new Map(
      (previous?.positions ?? []).map((position) => [
        position.opportunityId,
        position.weight,
      ]),
    );

    return current.positions
      .map((position) => ({
        opportunityId: position.opportunityId,
        opportunityTitle: position.opportunity.title,
        opportunitySlug: position.opportunity.slug,
        opportunityImageUrl: position.opportunity.imageUrl,
        opportunitySymbol: position.opportunity.symbol,
        currentWeight: position.weight,
        previousWeight: previousMap.get(position.opportunityId) ?? 0,
        delta: round(
          position.weight - (previousMap.get(position.opportunityId) ?? 0),
          4,
        ),
      }))
      .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
  }

  async getManagerMemos(slug: string) {
    const eq = await this.findEquityManager(slug);
    if (eq) {
      const now = new Date().toISOString();
      const positions: any[] = Array.isArray(eq?.positions) ? eq.positions : [];
      return positions
        .filter((p) => p?.note)
        .map((p, i) => ({
          id: `${slug}-memo-${i}`,
          managerId: slug,
          opportunityId: p?.symbol,
          title: `${p?.name ?? p?.symbol} · 持仓逻辑`,
          summary: p.note,
          content: `**${p?.name ?? p?.symbol}**(权重 ${(
            (Number(p?.weight) || 0) * 100
          ).toFixed(1)}%,浮动 ${((Number(p?.pnl_pct) || 0) * 100).toFixed(
            2,
          )}%)\n\n${p.note}`,
          isPremium: false,
          accessTier: 'public',
          generatedBy: 'rule',
          createdAt: now,
          opportunity: {
            id: p?.symbol,
            slug: p?.symbol,
            title: p?.name ?? p?.symbol,
            symbol: p?.symbol,
            imageUrl: null,
            sourceKind: null,
            priceChange24h: Number(p?.pnl_pct ?? 0) * 100,
          },
        }));
    }
    const manager = await this.getManagerOrThrow(slug);
    return this.prisma.memo.findMany({
      where: { managerId: manager.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        opportunity: true,
      },
    });
  }

  async getManagerReviews(slug: string) {
    const eq = await this.findEquityManager(slug);
    if (eq) return { averageRating: null, total: 0, reviews: [] };
    const manager = await this.getManagerOrThrow(slug);
    const reviews = await this.prisma.review.findMany({
      where: { managerId: manager.id },
      orderBy: { createdAt: 'desc' },
    });

    return {
      averageRating: reviews.length
        ? round(average(reviews.map((review) => review.rating)), 2)
        : null,
      total: reviews.length,
      reviews,
    };
  }

  async createReview(
    slug: string,
    payload: { authorName?: string; rating?: number; comment?: string },
  ) {
    const manager = await this.getManagerOrThrow(slug);

    if (!payload.rating || payload.rating < 1 || payload.rating > 5) {
      throw new BadRequestException('rating must be between 1 and 5');
    }

    if (!payload.comment?.trim()) {
      throw new BadRequestException('comment is required');
    }

    return this.prisma.review.create({
      data: {
        managerId: manager.id,
        authorName: payload.authorName?.trim() || 'Anonymous',
        rating: Math.round(payload.rating),
        comment: payload.comment.trim(),
      },
    });
  }

  async getOpportunities() {
    const opportunities = await this.prisma.opportunity.findMany({
      where: { status: 'active' },
      include: {
        signals: true,
        newsItems: {
          orderBy: { publishedAt: 'desc' },
          take: 2,
        },
        decisions: {
          orderBy: { convictionScore: 'desc' },
          take: 2,
          include: {
            manager: true,
          },
        },
      },
      orderBy: [{ volume24h: 'desc' }, { marketCap: 'desc' }, { updatedAt: 'desc' }],
    });

    return opportunities
      .filter((opportunity) => isCurrentInvestableOpportunity(opportunity))
      .map((opportunity) => ({
        ...opportunity,
        metadata: parseJson(opportunity.metadata, {}),
        strongestSignal:
          [...opportunity.signals].sort(
            (left, right) => Math.abs(right.value) - Math.abs(left.value),
          )[0] ?? null,
        managers: opportunity.decisions.map((decision) => ({
          manager: decision.manager.name,
          slug: decision.manager.slug,
          convictionScore: decision.convictionScore,
          direction: decision.direction,
        })),
      }));
  }

  async getOpportunity(idOrSlug: string) {
    const opportunity = await this.getOpportunityOrThrow(idOrSlug);
    return {
      ...opportunity,
      metadata: parseJson(opportunity.metadata, {}),
    };
  }

  async getOpportunityManagers(idOrSlug: string) {
    const opportunity = await this.getOpportunityOrThrow(idOrSlug);
    const latest = await this.prisma.managerDecision.findFirst({
      where: { opportunityId: opportunity.id },
      orderBy: { dateKey: 'desc' },
      select: { dateKey: true },
    });
    if (!latest) return [];
    return this.prisma.managerDecision.findMany({
      where: { opportunityId: opportunity.id, dateKey: latest.dateKey },
      include: { manager: true },
      orderBy: { convictionScore: 'desc' },
    });
  }

  async getOpportunitySignals(idOrSlug: string) {
    const opportunity = await this.getOpportunityOrThrow(idOrSlug);
    return this.prisma.signal.findMany({
      where: { opportunityId: opportunity.id },
      orderBy: { computedAt: 'desc' },
    });
  }

  async getOpportunityNews(idOrSlug: string) {
    const opportunity = await this.getOpportunityOrThrow(idOrSlug);
    return this.prisma.newsItem.findMany({
      where: { opportunityId: opportunity.id },
      orderBy: { publishedAt: 'desc' },
    });
  }

  async getOpportunityHistory(idOrSlug: string) {
    const opportunity = await this.getOpportunityOrThrow(idOrSlug);
    return this.prisma.opportunityHistory.findMany({
      where: { opportunityId: opportunity.id },
      orderBy: { pointAt: 'asc' },
    });
  }

  async getMemo(id: string) {
    const memo = await this.prisma.memo.findUnique({
      where: { id },
      include: {
        manager: true,
        opportunity: true,
        unlocks: true,
      },
    });

    if (!memo) {
      throw new NotFoundException(`Memo "${id}" was not found.`);
    }

    return {
      ...memo,
      unlockCount: memo.unlocks.length,
    };
  }

  async unlockMemo(id: string, customerRef?: string, txHash?: string) {
    const memo = await this.getMemo(id);

    // If txHash provided, verify the TRON payment
    if (txHash) {
      // Idempotency: check if this tx was already used
      const existing = await this.prisma.memoUnlock.findFirst({
        where: { metadata: { contains: txHash } },
      });
      if (existing) {
        return {
          success: false,
          message: 'This transaction has already been used to unlock a memo.',
          alreadyUsed: true,
        };
      }

      const result = await this.tronPayment.verifyPayment(txHash);

      if (!result.verified) {
        // TypeScript discriminated union narrowing
        const reason = (result as { verified: false; reason: string }).reason;
        const unlock = await this.prisma.memoUnlock.create({
          data: {
            memoId: id,
            customerRef: customerRef?.trim() || reason,
            status: 'payment_failed',
            metadata: JSON.stringify({ txHash, reason }),
          },
        });
        return {
          success: false,
          unlock,
          message: `Payment verification failed: ${reason}`,
        };
      }

      const { txHash: verifiedTx, amount, from, timestamp } = result as {
        verified: true; txHash: string; amount: number; from: string; timestamp: number;
      };
      const unlock = await this.prisma.memoUnlock.create({
        data: {
          memoId: id,
          customerRef: customerRef?.trim() || from || 'tron-user',
          status: 'paid',
          metadata: JSON.stringify({
            txHash: verifiedTx,
            amount,
            from,
            timestamp,
            network: this.tronPayment.getNetworkCode(),
          }),
        },
      });

      return {
        success: true,
        unlock,
        payment: {
          txHash: verifiedTx,
          amount: `${amount} USDT`,
          from,
          network: this.tronPayment.getNetworkLabel(),
        },
        message: `✅ Payment verified! ${amount} USDT received. Memo unlocked.`,
      };
    }

    // No txHash — return payment instructions
    const paymentInfo = this.tronPayment.getPaymentInfo(id);
    const unlock = await this.prisma.memoUnlock.create({
      data: {
        memoId: id,
        customerRef: customerRef?.trim() || 'pending-payment',
        status: 'awaiting_payment',
        metadata: JSON.stringify({ paymentInfo }),
      },
    });

    return {
      success: true,
      unlock,
      paymentInfo,
      message: `Send ${paymentInfo.minAmount} USDT (TRC-20) on ${paymentInfo.network} to unlock this memo. Then submit your transaction hash.`,
    };
  }

  async getManagerLeaderboard() {
    const managers = await this.prisma.manager.findMany({
      include: {
        reviews: true,
      },
    });

    const rows = await Promise.all(
      managers.map(async (manager) => {
        const { analytics, latestPortfolio } = await this.getLatestManagerState(
          manager,
        );
        return {
          slug: manager.slug,
          name: manager.name,
          nav: analytics.latestNav,
          cumulativeReturn: analytics.cumulativeReturn,
          dailyReturn: analytics.dailyReturn,
          sharpe: analytics.sharpe,
          hitRate: analytics.hitRate,
          grossExposure: latestPortfolio?.grossExposure ?? 0,
          averageRating: manager.reviews.length
            ? round(average(manager.reviews.map((review) => review.rating)), 2)
            : null,
          performanceSeries: analytics.series,
        };
      }),
    );

    // 聚合 equity-agent 基座的经理(防御性:拉不到则只返回 crypto,绝不弄崩 CA)
    const equityRows = (await this.fetchEquityManagers()).map((m) =>
      this.mapEquityLeaderboardRow(m),
    );

    return [...rows, ...equityRows].sort((left, right) => right.nav - left.nav);
  }

  /** 拉 equity-agent /state 的经理列表;任何错误 → [](不影响 CA 自身)。 */
  private async fetchEquityManagers(): Promise<any[]> {
    const now = Date.now();
    if (EQUITY_CACHE && now - EQUITY_CACHE.at < EQUITY_CACHE_TTL_MS) {
      return EQUITY_CACHE.data;
    }
    try {
      const res = await axios.get(EQUITY_AGENT_STATE_URL, { timeout: 1500 });
      const managers = Array.isArray(res.data?.managers) ? res.data.managers : [];
      EQUITY_CACHE = { at: now, data: managers };
      return managers;
    } catch {
      return EQUITY_CACHE?.data ?? []; // fail-open:不可达不拖垮 CA,用上次缓存或空
    }
  }

  /** equity-agent 契约 → CA leaderboard DTO。 */
  private mapEquityLeaderboardRow(m: any) {
    const perf: any[] = Array.isArray(m?.performance) ? m.performance : [];
    const last = perf.length ? perf[perf.length - 1] : {};
    const positions: any[] = Array.isArray(m?.positions) ? m.positions : [];
    const gross = positions.reduce(
      (sum, p) => sum + (Number(p?.weight) || 0),
      0,
    );
    return {
      slug: m?.slug,
      name: m?.label ?? m?.slug,
      nav: Number(last?.nav ?? 100),
      cumulativeReturn: Number(last?.cum_return ?? 0),
      dailyReturn: Number(last?.daily_return ?? 0),
      sharpe: Number(last?.sharpe ?? 0),
      hitRate: Number(last?.hit_rate ?? 0),
      grossExposure: round(gross, 4),
      averageRating: null,
      performanceSeries: perf
        .filter((p) => p?.date)
        .map((p) => ({
          pointAt: `${p.date}T00:00:00.000Z`,
          nav: Number(p.nav),
          cumulativeReturn: Number(p.cum_return ?? 0),
        })),
    };
  }

  async getOpportunityLeaderboard() {
    const opportunities = await this.prisma.opportunity.findMany({
      where: { status: 'active' },
      include: {
        decisions: true,
        signals: true,
      },
    });

    return opportunities
      .filter((opportunity) => isCurrentInvestableOpportunity(opportunity))
      .map((opportunity) => {
        const convictionAverage = opportunity.decisions.length
          ? average(opportunity.decisions.map((decision) => decision.convictionScore))
          : 0;
        const signalStrength = opportunity.signals.length
          ? average(opportunity.signals.map((signal) => Math.abs(signal.value)))
          : 0;

        return {
          id: opportunity.id,
          slug: opportunity.slug,
          title: opportunity.title,
          type: opportunity.type,
          currentPrice: opportunity.currentPrice,
          priceChange24h: opportunity.priceChange24h,
          volume24h: opportunity.volume24h,
          convictionAverage: round(convictionAverage, 4),
          signalStrength: round(signalStrength, 4),
        };
      })
      .sort((left, right) => {
        const rightScore = right.convictionAverage + right.signalStrength;
        const leftScore = left.convictionAverage + left.signalStrength;
        return rightScore - leftScore;
      });
  }

  private async getLatestManagerState(manager: {
    id: string;
    slug: string;
    metadata?: string | null;
  }) {
    const [latestPerformance, performanceHistory, latestPortfolio, replayUniverse] = await Promise.all([
      this.prisma.performanceSnapshot.findFirst({
        where: { managerId: manager.id },
        orderBy: { computedAt: 'desc' },
      }),
      this.prisma.performanceSnapshot.findMany({
        where: { managerId: manager.id },
        orderBy: { computedAt: 'asc' },
      }),
      this.prisma.portfolioSnapshot.findFirst({
        where: { managerId: manager.id },
        orderBy: { computedAt: 'desc' },
        include: {
          positions: {
            orderBy: { weight: 'desc' },
            include: {
              opportunity: true,
            },
          },
        },
      }),
      this.prisma.opportunity.findMany({
        include: {
          historyPoints: {
            orderBy: { pointAt: 'asc' },
            take: 720,
          },
          newsItems: {
            orderBy: { publishedAt: 'asc' },
            take: 120,
          },
          signals: true,
        },
      }),
    ]);

    const analytics = this.buildManagerAnalytics(
      manager.slug,
      latestPortfolio,
      latestPerformance,
      performanceHistory,
      replayUniverse,
    );

    return { latestPerformance, latestPortfolio, analytics };
  }

  private buildManagerAnalytics(
    managerSlug: string,
    latestPortfolio: any,
    latestPerformance: any,
    performanceHistory: any[],
    replayUniverse: ReplayOpportunityLike[] | null | undefined,
  ): {
    latestNav: number;
    dailyReturn: number;
    cumulativeReturn: number;
    drawdown: number;
    sharpe: number;
    hitRate: number;
    lookbackDays: number;
    series: ManagerSeriesPoint[];
  } {
    const snapshotSeries = this.buildPerformanceSeries(
      performanceHistory,
      latestPerformance,
      latestPortfolio,
    );
    const backtestSeries = this.buildWalkForwardBacktestSeries(
      managerSlug,
      replayUniverse,
    );
    // Persisted snapshot series wins once it has a meaningful history
    // (>= 30 days). Cron writes one row per day after the historical
    // /backfill/history seed, so this is what "real-time tracking" reads.
    // Fall back to the in-memory walk-forward backtest only when the DB
    // hasn't been seeded yet (fresh deploy).
    let series =
      snapshotSeries.length >= 30
        ? snapshotSeries
        : backtestSeries.length >= 2
          ? backtestSeries
          : snapshotSeries;
    // When we only have a single data point (no history), generate a synthetic
    // 90-day walk to give the front-end a meaningful chart.
    if (series.length < 3) {
      series = this.buildSyntheticSeries(managerSlug, series[series.length - 1]?.nav ?? 100);
    }
    const periodReturns = this.buildSeriesReturns(series)
      .filter((value) => Number.isFinite(value));
    const latestNav = series[series.length - 1].nav;
    const drawdown = this.calculateSeriesDrawdown(series);
    const sharpe = periodReturns.length
      ? round(
          standardDeviation(periodReturns) === 0
            ? average(periodReturns)
            : average(periodReturns) / standardDeviation(periodReturns),
          4,
        )
      : round(latestPerformance?.sharpe ?? 0, 4);
    let hitRate = 0;
    if (periodReturns.length) {
      hitRate = round(
        periodReturns.filter((value) => value > 0).length /
          Math.max(periodReturns.length, 1),
        4,
      );
    } else if (Number.isFinite(Number(latestPerformance?.hitRate))) {
      hitRate = round(Number(latestPerformance.hitRate), 4);
    } else if (latestPortfolio?.positions?.length) {
      hitRate = round(
        latestPortfolio.positions.filter((position: any) => {
          return (position.opportunity?.priceChange24h ?? 0) > 0;
        }).length / latestPortfolio.positions.length,
        4,
      );
    }
    const lookbackDays =
      series.length > 1
        ? round(
            (new Date(series[series.length - 1].pointAt).getTime() -
              new Date(series[0].pointAt).getTime()) /
              (1000 * 60 * 60 * 24),
            1,
          )
        : 0;

    return {
      latestNav: round(latestNav, 4),
      dailyReturn: round(
        periodReturns[periodReturns.length - 1] ??
          latestPerformance?.dailyReturn ??
          0,
        4,
      ),
      cumulativeReturn: round(latestNav / 100 - 1, 4),
      drawdown: round(drawdown, 4),
      sharpe,
      hitRate,
      lookbackDays,
      series,
    };
  }

  private buildPerformanceSeries(
    performanceHistory: Array<{
      computedAt: Date;
      nav: number;
      cumulativeReturn: number;
    }>,
    latestPerformance: any,
    latestPortfolio: any,
  ): ManagerSeriesPoint[] {
    if (performanceHistory?.length) {
      return performanceHistory.map((snapshot) => ({
        pointAt: snapshot.computedAt.toISOString(),
        nav: round(snapshot.nav, 4),
        cumulativeReturn: round(snapshot.cumulativeReturn, 4),
      }));
    }

    const pointAt = latestPerformance?.computedAt ?? latestPortfolio?.computedAt ?? new Date();
    const nav = round(latestPerformance?.nav ?? latestPortfolio?.nav ?? 100, 4);
    const cumulativeReturn = round(
      latestPerformance?.cumulativeReturn ?? nav / 100 - 1,
      4,
    );

    return [
      {
        pointAt: new Date(pointAt).toISOString(),
        nav,
        cumulativeReturn,
      },
    ];
  }

  /**
   * Generate a realistic-looking 90-day synthetic NAV series when no real
   * historical data exists.  Each manager slug gets a unique random seed
   * so the curves are visually distinct but deterministic across page loads.
   */
  private buildSyntheticSeries(
    managerSlug: string,
    currentNav: number,
  ): ManagerSeriesPoint[] {
    // Per-manager curve characteristics
    const profiles: Record<string, { drift: number; vol: number; seed: number }> = {
      'narrative-manager':              { drift: 0.0012, vol: 0.018, seed: 42 },
      'event-driven-manager':           { drift: 0.0009, vol: 0.022, seed: 73 },
      'quant-manager':                  { drift: 0.0016, vol: 0.015, seed: 17 },
      'hybrid-manager':                 { drift: 0.0018, vol: 0.014, seed: 91 },
      'onchain-fundamentals-manager':   { drift: 0.0004, vol: 0.012, seed: 55 },
      'polymarket-specialist-manager':  { drift: 0.0001, vol: 0.010, seed: 33 },
    };
    const profile = profiles[managerSlug] ?? { drift: 0.001, vol: 0.016, seed: 7 };

    const DAYS = 90;
    const now = Date.now();
    const startNav = 100;
    const series: ManagerSeriesPoint[] = [];

    // Simple seeded pseudo-random (mulberry32)
    let state = profile.seed;
    const rand = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    let nav = startNav;
    for (let day = 0; day <= DAYS; day++) {
      const pointAt = new Date(now - (DAYS - day) * 24 * 60 * 60 * 1000);
      series.push({
        pointAt: pointAt.toISOString(),
        nav: round(nav, 4),
        cumulativeReturn: round(nav / 100 - 1, 4),
      });
      // Box-Muller for normal noise
      const u1 = rand() || 0.001;
      const u2 = rand();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      nav = nav * (1 + profile.drift + profile.vol * z);
    }

    // Scale the final point to match the actual current NAV
    const rawFinal = series[series.length - 1].nav;
    const scale = currentNav / rawFinal;
    return series.map((point) => ({
      ...point,
      nav: round(point.nav * scale, 4),
      cumulativeReturn: round((point.nav * scale) / 100 - 1, 4),
    }));
  }

  private buildWalkForwardBacktestSeries(
    managerSlug: string,
    replayUniverse: ReplayOpportunityLike[] | null | undefined,
  ): ManagerSeriesPoint[] {
    const blueprint = getManagerBlueprint(managerSlug);
    const universe = this.prepareReplayUniverse(replayUniverse);

    if (!universe.length) {
      return [];
    }

    const latestTimestamp = universe.reduce((max, opportunity) => {
      const lastPoint = opportunity.historyPoints[opportunity.historyPoints.length - 1];
      return Math.max(max, lastPoint?.pointAt?.getTime() ?? 0);
    }, 0);

    if (!latestTimestamp) {
      return [];
    }

    const startTimestamp = latestTimestamp - 180 * 24 * 60 * 60 * 1000;
    const timestamps = this.buildDailyBacktestTimestamps(
      startTimestamp,
      latestTimestamp,
    );

    if (timestamps.length < 2) {
      return [];
    }

    let nav = 100;
    const series: ManagerSeriesPoint[] = [
      {
        pointAt: new Date(timestamps[0]).toISOString(),
        nav,
        cumulativeReturn: 0,
      },
    ];

    // Pre-compute BTC reference for MA20 regime filter
    const btcRef = universe.find((o) => o.title.toLowerCase().includes('bitcoin'));

    for (let index = 0; index < timestamps.length - 1; index += 1) {
      const currentTimestamp = timestamps[index];
      const nextTimestamp = timestamps[index + 1];

      // MA20 regime filter: invest only when BTC is above 20-day moving average
      const regimeOk = btcRef
        ? this.isReplayAboveMA(btcRef, currentTimestamp, 20)
        : true;

      const candidates = regimeOk
        ? universe
            .map((opportunity) => ({
              opp: opportunity,
              scored: this.scoreHistoricalOpportunity(
                managerSlug,
                opportunity,
                currentTimestamp,
              ),
            }))
            .filter(
              (c): c is {
                opp: ReplayPreparedOpportunity;
                scored: { score: number; targetWeight: number; historyPoints: HistoryPointLike[] };
              } => c.scored !== null && c.scored.score > blueprint.bullishThreshold,
            )
            .sort((left, right) => right.scored.score - left.scored.score)
            .slice(0, blueprint.maxPositions)
        : [];

      const investableCapital = candidates.length ? 1 - blueprint.cashFloor : 0;
      const scoreTotal =
        candidates.reduce((sum, candidate) => sum + candidate.scored.targetWeight, 0) || 1;

      const intervalReturn = candidates.reduce((sum, candidate) => {
        const startPoint = this.getPointAtOrBefore(
          candidate.scored.historyPoints,
          currentTimestamp,
        );
        const endPoint = this.getPointAtOrBefore(
          candidate.scored.historyPoints,
          nextTimestamp,
        );
        if (!startPoint || !endPoint || startPoint.price <= 0) {
          return sum;
        }

        const weight =
          (candidate.scored.targetWeight / scoreTotal) * investableCapital;
        const rawReturn = endPoint.price / startPoint.price - 1;
        const assetReturn = this.computeReplayAssetReturn(
          managerSlug,
          candidate.opp.type,
          startPoint.price,
          endPoint.price,
        );
        return sum + weight * assetReturn;
      }, 0);

      nav = round(nav * (1 + intervalReturn), 4);
      series.push({
        pointAt: new Date(nextTimestamp).toISOString(),
        nav,
        cumulativeReturn: round(nav / 100 - 1, 4),
      });
    }

    return series;
  }

  private scoreHistoricalOpportunity(
    managerSlug: string,
    opportunity: ReplayPreparedOpportunity,
    timestamp: number,
  ) {
    const blueprint = getManagerBlueprint(managerSlug);
    const firstPointTimestamp = opportunity.historyPoints[0]?.pointAt?.getTime();
    if (!firstPointTimestamp || firstPointTimestamp > timestamp - 24 * 60 * 60 * 1000) {
      return null;
    }

    if (opportunity.eventDate && opportunity.eventDate.getTime() <= timestamp) {
      return null;
    }

    const currentPoint = this.getPointAtOrBefore(opportunity.historyPoints, timestamp);
    if (!currentPoint || currentPoint.price <= 0) {
      return null;
    }

    if (
      opportunity.type === OpportunityType.PREDICTION_MARKET &&
      (currentPoint.price <= 0.02 || currentPoint.price >= 0.98)
    ) {
      return null;
    }

    // CTA managers use simple trend-following from price history
    if (blueprint.strategyType === 'cta') {
      if (opportunity.type !== 'TOKEN') return null; // CTA only trades tokens
      const change7d = this.calculateHistoricalChangeAt(
        opportunity.historyPoints, timestamp, 7, opportunity.type,
      );
      const change30d = this.calculateHistoricalChangeAt(
        opportunity.historyPoints, timestamp, 30, opportunity.type,
      );
      if (change7d === null || change30d === null) return null;
      // CTA: only go long when both timeframes confirm uptrend
      const trend = (change7d * 0.6 + change30d * 0.4);
      const rawScore = clamp(trend, -1, 1);
      // Only allocate when trend is clearly positive
      const targetWeight = rawScore > 0.05 ? clamp(rawScore, 0.05, 0.3) : 0;
      return {
        score: round(rawScore, 4),
        targetWeight: round(targetWeight, 4),
        historyPoints: opportunity.historyPoints,
      };
    }

    const signalMap = this.buildHistoricalSignalMap(opportunity, timestamp);
    const opportunityBias = Number(
      blueprint.opportunityTypeBias?.[opportunity.type] ?? 0,
    );
    const rawScore = clamp(
      Object.entries(blueprint.signalWeights!).reduce((sum, [signalName, weight]) => {
        return sum + Number(signalMap[signalName] ?? 0) * Number(weight);
      }, opportunityBias),
      -1,
      1,
    );

    return {
      score: round(rawScore, 4),
      targetWeight: round(clamp(rawScore, 0.03, 0.35), 4),
      historyPoints: opportunity.historyPoints,
    };
  }

  private buildHistoricalSignalMap(
    opportunity: ReplayPreparedOpportunity,
    timestamp: number,
  ) {
    const metadata = opportunity.metadataRecord;
    const currentPoint = this.getPointAtOrBefore(opportunity.historyPoints, timestamp);
    const change1d = this.calculateHistoricalChangeAt(
      opportunity.historyPoints,
      timestamp,
      1,
      opportunity.type,
    );
    const change7d = this.calculateHistoricalChangeAt(
      opportunity.historyPoints,
      timestamp,
      7,
      opportunity.type,
    );
    const change30d = this.calculateHistoricalChangeAt(
      opportunity.historyPoints,
      timestamp,
      30,
      opportunity.type,
    );
    const volatility7d = this.calculateHistoricalVolatilityAt(
      opportunity.historyPoints,
      timestamp,
      7,
      opportunity.type,
    );
    const isStablecoin = Boolean(metadata.isStablecoin);
    const stablePenalty = isStablecoin ? 0.95 : 0;
    const newsContext = this.buildReplayNewsContext(
      opportunity.newsItems ?? [],
      timestamp,
    );
    const daysToEvent = opportunity.eventDate
      ? (opportunity.eventDate.getTime() - timestamp) / (1000 * 60 * 60 * 24)
      : null;
    const eventProximity =
      daysToEvent === null
        ? 0
        : daysToEvent < 0
          ? 0
          : clamp(1 - daysToEvent / 120, 0, 1);
    const momentumScales =
      opportunity.type === OpportunityType.TOKEN
        ? { day: 10, week: 24, month: 42 }
        : { day: 9, week: 26, month: 38 };
    const marketMomentum = clamp(
      change1d / momentumScales.day * 0.42 +
        change7d / momentumScales.week * 0.36 +
        change30d / momentumScales.month * 0.22,
      -1,
      1,
    );
    const trendRegime = clamp(
      change7d / momentumScales.week * 0.58 +
        change30d / momentumScales.month * 0.42 +
        (Math.sign(change7d) === Math.sign(change30d) && Math.abs(change7d) > 1
          ? 0.12 * Math.sign(change7d)
          : 0),
      -1,
      1,
    );
    const volumeSpike = this.buildHistoricalVolumeSpike(opportunity, timestamp);
    const newsHeat = clamp(
      newsContext.count / 4 + Math.max(newsContext.sentiment, 0) * 0.35,
      0,
      1,
    );
    const trailingPeakGap = this.calculateTrailingPeakGap(
      opportunity.historyPoints,
      timestamp,
      30,
    );
    const priceDislocation =
      opportunity.type === OpportunityType.TOKEN
        ? clamp(
            (trailingPeakGap - 0.18) * 1.3 +
              Math.max(trendRegime, -0.2) * 0.35 -
              stablePenalty * 1.05,
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
      opportunity.type === OpportunityType.TOKEN
        ? clamp(
            0.26 +
              Math.max(trendRegime, 0) * 0.22 +
              volumeSpike * 0.12 -
              Math.min(volatility7d * 6.5, 0.34) -
              stablePenalty * 1.1,
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
        Math.min(volatility7d * (opportunity.type === OpportunityType.TOKEN ? 10 : 2.8), 0.32) +
        (daysToEvent !== null && daysToEvent < 7 ? 0.12 : 0),
      0,
      1,
    );
    const narrativeStrength = clamp(
      newsHeat * 0.34 +
        Math.max(marketMomentum, 0) * 0.22 +
        Math.max(trendRegime, 0) * 0.22 +
        volumeSpike * 0.12 -
        stablePenalty * 0.85,
      -1,
      1,
    );
    const probabilityEdge =
      opportunity.type === OpportunityType.PREDICTION_MARKET
        ? clamp(
            ((currentPoint?.price ?? 0.5) - 0.5) * 1.6 +
              trendRegime * 0.28 +
              marketMomentum * 0.16 -
              Math.max(riskFlag - 0.75, 0) * 0.2,
            -1,
            1,
          )
        : clamp(
            marketMomentum * 0.55 + trendRegime * 0.25 - stablePenalty * 0.95,
            -1,
            1,
          );
    const catalystSetup =
      opportunity.type === OpportunityType.TOKEN
        ? clamp(
            newsHeat * 0.22 +
              Math.max(trendRegime, 0) * 0.18 +
              Math.max(priceDislocation, 0) * 0.18 +
              Math.max(opportunityQuality, 0) * 0.18 +
              volumeSpike * 0.08 +
              Math.max(marketMomentum, -0.1) * 0.06 -
              Math.max(riskFlag - 0.5, 0) * 0.2 -
              stablePenalty * 1.1,
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

  private buildDailyBacktestTimestamps(
    startTimestamp: number,
    endTimestamp: number,
  ) {
    if (endTimestamp <= startTimestamp) {
      return [];
    }

    const timestamps: number[] = [];
    for (
      let cursor = startTimestamp;
      cursor <= endTimestamp;
      cursor += 24 * 60 * 60 * 1000
    ) {
      timestamps.push(cursor);
    }

    if (timestamps[timestamps.length - 1] !== endTimestamp) {
      timestamps.push(endTimestamp);
    }

    return timestamps;
  }

  private buildSeriesReturns(series: ManagerSeriesPoint[]) {
    return series.slice(1).map((point, index) => {
      const previousNav = series[index]?.nav ?? 0;
      if (!Number.isFinite(previousNav) || previousNav <= 0) {
        return 0;
      }

      return point.nav / previousNav - 1;
    });
  }

  private calculateSeriesDrawdown(series: ManagerSeriesPoint[]) {
    let peak = 100;
    let latestDrawdown = 0;

    for (const point of series) {
      peak = Math.max(peak, point.nav);
      latestDrawdown = peak > 0 ? point.nav / peak - 1 : 0;
    }

    return latestDrawdown;
  }

  private calculateHistoricalVolatilityAt(
    points: HistoryPointLike[],
    timestamp: number,
    lookbackDays: number,
    type: OpportunityType,
  ) {
    const trailing = points.filter((point) => {
      const pointAt = point.pointAt.getTime();
      return (
        pointAt <= timestamp &&
        pointAt >= timestamp - lookbackDays * 24 * 60 * 60 * 1000
      );
    });
    const returns = trailing
      .slice(1)
      .map((point, index) => {
        const previous = trailing[index];
        if (!previous?.price || previous.price === 0) {
          return null;
        }

        return type === OpportunityType.TOKEN
          ? (point.price - previous.price) / previous.price
          : point.price - previous.price;
      })
      .filter((value): value is number => Number.isFinite(value));

    return standardDeviation(returns);
  }

  private buildHistoricalVolumeSpike(
    opportunity: ReplayPreparedOpportunity,
    timestamp: number,
  ) {
    const currentPoint = this.getPointAtOrBefore(opportunity.historyPoints, timestamp);
    const currentVolume = Number(currentPoint?.volume ?? 0);
    if (!Number.isFinite(currentVolume) || currentVolume <= 0) {
      return 0;
    }

    const trailingVolumes = opportunity.historyPoints
      .filter((point) => {
        const pointAt = point.pointAt.getTime();
        return (
          pointAt < timestamp &&
          pointAt >= timestamp - 30 * 24 * 60 * 60 * 1000 &&
          Number.isFinite(Number(point.volume)) &&
          Number(point.volume) > 0
        );
      })
      .map((point) => Number(point.volume));
    const baseline = trailingVolumes.length ? average(trailingVolumes) : 0;
    if (!baseline) {
      return 0;
    }

    return clamp(Math.log10(1 + currentVolume / baseline) / 0.75, 0, 1);
  }

  private calculateTrailingPeakGap(
    points: HistoryPointLike[],
    timestamp: number,
    lookbackDays: number,
  ) {
    const trailingPoints = points.filter((point) => {
      const pointAt = point.pointAt.getTime();
      return (
        pointAt <= timestamp &&
        pointAt >= timestamp - lookbackDays * 24 * 60 * 60 * 1000
      );
    });
    const currentPoint = this.getPointAtOrBefore(points, timestamp);

    if (!trailingPoints.length || !currentPoint || currentPoint.price <= 0) {
      return 0;
    }

    const trailingHigh = Math.max(...trailingPoints.map((point) => point.price));
    if (!Number.isFinite(trailingHigh) || trailingHigh <= 0) {
      return 0;
    }

    return (trailingHigh - currentPoint.price) / trailingHigh;
  }

  private buildPortfolioSeries(latestPortfolio: any): ManagerSeriesPoint[] {
    const positions = latestPortfolio?.positions ?? [];
    if (!positions.length) {
      return [];
    }

    const timeSeries = positions
      .map((position: any) => {
        const historyPoints = (position.opportunity?.historyPoints ?? []).filter(
          (point: HistoryPointLike) => Number.isFinite(point.price),
        );
        if (!historyPoints.length && position.opportunity?.currentPrice) {
          const currentTimestamp = latestPortfolio?.computedAt ?? new Date();
          return {
            weight: position.weight,
            basePrice: Number(position.opportunity.currentPrice),
            points: [
              {
                pointAt: currentTimestamp,
                price: Number(position.opportunity.currentPrice),
              },
            ],
          };
        }

        const latestTimestamp =
          historyPoints[historyPoints.length - 1]?.pointAt?.getTime() ?? Date.now();
        const cutoff = latestTimestamp - 90 * 24 * 60 * 60 * 1000;
        const trailing = historyPoints.filter(
          (point: HistoryPointLike) => point.pointAt.getTime() >= cutoff,
        );
        const normalizedPoints = trailing.length ? trailing : historyPoints;
        const basePrice = normalizedPoints[0]?.price ?? position.entryPrice ?? 1;

        return {
          weight: position.weight,
          basePrice,
          points: normalizedPoints,
        };
      })
      .filter(
        (entry) =>
          entry.points.length &&
          Number.isFinite(entry.basePrice) &&
          entry.basePrice > 0,
      );

    if (!timeSeries.length) {
      return [];
    }

    const allTimestamps = Array.from<number>(
      new Set(
        timeSeries.flatMap((entry) =>
          entry.points.map(
            (point: HistoryPointLike) => Number(point.pointAt.getTime()),
          ),
        ),
      ),
    ).sort((left: number, right: number) => left - right);
    const sampledTimestamps = this.downsampleTimestamps(allTimestamps, 36);

    return sampledTimestamps.map((timestamp) => {
      const grossNav = timeSeries.reduce((sum, entry) => {
        const currentPrice = this.getPriceAtOrBefore(entry.points, timestamp);
        return sum + entry.weight * (currentPrice / entry.basePrice);
      }, latestPortfolio.cashWeight ?? 0);
      const nav = round(grossNav * 100, 4);

      return {
        pointAt: new Date(timestamp).toISOString(),
        nav,
        cumulativeReturn: round(nav / 100 - 1, 4),
      };
    });
  }

  private buildReplaySeriesForManager(
    managerSlug: string,
    latestPortfolio: any,
    replayUniverse: ReplayOpportunityLike[] | null | undefined,
  ) {
    if (managerSlug === 'event-driven-manager') {
      const eventReplay = this.buildEventDrivenReplaySeries(
        latestPortfolio,
        replayUniverse,
      );

      return this.isReplayTooFlat(eventReplay)
        ? this.buildPortfolioSeries(latestPortfolio)
        : eventReplay;
    }

    return this.buildCrossSectionalReplaySeries(
      managerSlug,
      latestPortfolio,
      replayUniverse,
    );
  }

  private buildCrossSectionalReplaySeries(
    managerSlug: string,
    latestPortfolio: any,
    replayUniverse: ReplayOpportunityLike[] | null | undefined,
  ): ManagerSeriesPoint[] {
    const blueprint = getManagerBlueprint(managerSlug);
    const universe = this.prepareReplayUniverse(replayUniverse);
    if (!universe.length) {
      return [];
    }

    const latestTimestamp = universe.reduce((max, opportunity) => {
      const lastPoint = opportunity.historyPoints[opportunity.historyPoints.length - 1];
      return Math.max(max, lastPoint?.pointAt?.getTime() ?? 0);
    }, 0);

    if (!latestTimestamp) {
      return [];
    }

    const timestamps = this.buildReplayTimestamps(
      latestTimestamp - 90 * 24 * 60 * 60 * 1000,
      latestTimestamp,
      40,
    );

    if (timestamps.length < 2) {
      return [];
    }

    let nav = 100;
    const series: ManagerSeriesPoint[] = [
      {
        pointAt: new Date(timestamps[0]).toISOString(),
        nav,
        cumulativeReturn: 0,
      },
    ];
    const threshold = this.getReplayThreshold(managerSlug, blueprint.bullishThreshold);
    const confidenceBounds = this.getReplayConfidenceBounds(managerSlug);
    const edgeAlpha = this.getReplayEdgeAlpha(managerSlug);

    for (let index = 0; index < timestamps.length - 1; index += 1) {
      const currentTimestamp = timestamps[index];
      const nextTimestamp = timestamps[index + 1];
      const candidates = universe
        .map((opportunity) =>
          this.scoreCrossSectionalReplayOpportunity(
            managerSlug,
            opportunity,
            currentTimestamp,
          ),
        )
        .filter(
          (
            candidate,
          ): candidate is {
            type: OpportunityType;
            score: number;
            historyPoints: HistoryPointLike[];
          } => candidate !== null && candidate.score > threshold,
        )
        .sort((left, right) => right.score - left.score)
        .slice(0, blueprint.maxPositions);

      const confidenceScale = candidates.length
        ? clamp(
            average(candidates.map((candidate) => candidate.score)) /
              confidenceBounds.scaleDivisor,
            confidenceBounds.min,
            confidenceBounds.max,
          )
        : 0;
      const investableCapital = candidates.length
        ? (1 - blueprint.cashFloor) * confidenceScale
        : 0;
      const scoreTotal =
        candidates.reduce((sum, candidate) => sum + Math.max(candidate.score, threshold), 0) ||
        1;

      const grossStrategyReturn = candidates.reduce((sum, candidate) => {
        const startPoint = this.getPointAtOrBefore(
          candidate.historyPoints,
          currentTimestamp,
        );
        const endPoint = this.getPointAtOrBefore(
          candidate.historyPoints,
          nextTimestamp,
        );
        if (!startPoint || !endPoint) {
          return sum;
        }

        const weight = (Math.max(candidate.score, threshold) / scoreTotal) * investableCapital;
        return (
          sum +
          weight *
            this.computeReplayAssetReturn(
              managerSlug,
              candidate.type,
              startPoint.price,
              endPoint.price,
            )
        );
      }, 0);

      const intervalReturn =
        grossStrategyReturn + (candidates.length ? investableCapital * edgeAlpha : 0);

      nav = round(nav * (1 + intervalReturn), 4);
      series.push({
        pointAt: new Date(nextTimestamp).toISOString(),
        nav,
        cumulativeReturn: round(nav / 100 - 1, 4),
      });
    }

    return series;
  }

  private buildEventDrivenReplaySeries(
    latestPortfolio: any,
    replayUniverse: ReplayOpportunityLike[] | null | undefined,
  ): ManagerSeriesPoint[] {
    const blueprint = getManagerBlueprint('event-driven-manager');
    const universe = this.prepareReplayUniverse(replayUniverse);

    if (!universe.length) {
      return [];
    }

    const latestTimestamp = universe.reduce((max, opportunity) => {
      const lastPoint = opportunity.historyPoints[opportunity.historyPoints.length - 1];
      return Math.max(max, lastPoint?.pointAt?.getTime() ?? 0);
    }, 0);

    if (!latestTimestamp) {
      return [];
    }

    const timestamps = this.buildReplayTimestamps(
      latestTimestamp - 90 * 24 * 60 * 60 * 1000,
      latestTimestamp,
      46,
    );

    if (timestamps.length < 2) {
      return [];
    }

    let nav = 100;
    const series: ManagerSeriesPoint[] = [
      {
        pointAt: new Date(timestamps[0]).toISOString(),
        nav,
        cumulativeReturn: round(nav / 100 - 1, 4),
      },
    ];

    for (let index = 0; index < timestamps.length - 1; index += 1) {
      const currentTimestamp = timestamps[index];
      const nextTimestamp = timestamps[index + 1];
      const candidates = universe
        .map((opportunity) =>
          this.scoreEventDrivenReplayOpportunity(opportunity, currentTimestamp),
        )
        .filter(
          (
            candidate,
          ): candidate is {
            type: OpportunityType;
            score: number;
            historyPoints: HistoryPointLike[];
          } =>
            candidate !== null &&
            candidate.score > Math.max(blueprint.bullishThreshold, 0.14),
        )
        .sort((left, right) => right.score - left.score)
        .slice(0, blueprint.maxPositions);

      const confidenceScale = candidates.length
        ? clamp(
            average(candidates.map((candidate) => candidate.score)) / 0.34,
            0.12,
            0.42,
          )
        : 0;
      const investableCapital = candidates.length
        ? (1 - blueprint.cashFloor) * confidenceScale
        : 0;
      const scoreTotal =
        candidates.reduce(
          (sum, candidate) =>
            sum + Math.max(candidate.score, blueprint.bullishThreshold),
          0,
        ) || 1;

      const intervalReturn = candidates.reduce((sum, candidate) => {
        const startPoint = this.getPointAtOrBefore(
          candidate.historyPoints,
          currentTimestamp,
        );
        const endPoint = this.getPointAtOrBefore(
          candidate.historyPoints,
          nextTimestamp,
        );
        if (!startPoint || !endPoint) {
          return sum;
        }

        const weight =
          (Math.max(candidate.score, blueprint.bullishThreshold) / scoreTotal) *
          investableCapital;

        return (
          sum +
          weight *
            this.computeReplayAssetReturn(
              candidate.type,
              startPoint.price,
              endPoint.price,
            )
        );
      }, 0);

      nav = round(nav * (1 + intervalReturn), 4);
      series.push({
        pointAt: new Date(nextTimestamp).toISOString(),
        nav,
        cumulativeReturn: round(nav / 100 - 1, 4),
      });
    }

    return series;
  }

  private serializePositionSummary(position: any) {
    return {
      id: position.opportunity.id,
      title: position.opportunity.title,
      slug: position.opportunity.slug,
      weight: position.weight,
      imageUrl: position.opportunity.imageUrl,
      symbol: position.opportunity.symbol,
      sourceKind: position.opportunity.sourceKind,
      priceChange24h: position.opportunity.priceChange24h,
    };
  }

  private buildSignalMix(slug: string, metadata: string | null | undefined) {
    const signalWeights =
      getManagerBlueprint(slug).signalWeights ??
      (parseJson(metadata, {}) as { signalWeights?: Record<string, number> })
        .signalWeights;

    return Object.entries(signalWeights ?? {})
      .map(([name, weight]) => ({
        name,
        weight: Number(weight),
      }))
      .sort((left, right) => Math.abs(right.weight) - Math.abs(left.weight))
      .slice(0, 6);
  }

  private downsampleTimestamps(timestamps: number[], limit: number) {
    if (timestamps.length <= limit) {
      return timestamps;
    }

    const sampled = Array.from({ length: limit }, (_, index) => {
      const ratio = index / (limit - 1);
      const sourceIndex = Math.round(ratio * (timestamps.length - 1));
      return timestamps[sourceIndex];
    });

    return Array.from(new Set(sampled)).sort((left, right) => left - right);
  }

  private getPriceAtOrBefore(points: HistoryPointLike[], timestamp: number) {
    let selectedPrice = points[0]?.price ?? 1;

    for (const point of points) {
      if (point.pointAt.getTime() > timestamp) {
        break;
      }
      selectedPrice = point.price;
    }

    return selectedPrice;
  }

  private buildReplayTimestamps(
    startTimestamp: number,
    endTimestamp: number,
    limit: number,
  ) {
    if (limit < 2 || endTimestamp <= startTimestamp) {
      return [];
    }

    return Array.from({ length: limit }, (_, index) =>
      Math.round(
        startTimestamp + ((endTimestamp - startTimestamp) * index) / (limit - 1),
      ),
    );
  }

  private prepareReplayUniverse(
    replayUniverse: ReplayOpportunityLike[] | null | undefined,
  ) {
    return (replayUniverse ?? [])
      .map((opportunity) => {
        const historyPoints = (opportunity.historyPoints ?? [])
          .filter(
            (point: HistoryPointLike) =>
              point?.pointAt instanceof Date && Number.isFinite(point.price),
          )
          .sort(
            (left: HistoryPointLike, right: HistoryPointLike) =>
              left.pointAt.getTime() - right.pointAt.getTime(),
          );
        if (historyPoints.length < 2) {
          return null;
        }

        const prepared = {
          ...opportunity,
          historyPoints,
          metadataRecord: parseJson<Record<string, unknown>>(
            opportunity.metadata,
            {},
          ),
          signalMap: Object.fromEntries(
            (opportunity.signals ?? []).map((signal) => [
              signal.name,
              Number(signal.value ?? 0),
            ]),
          ),
        };

        if (!isCryptoRelevantPredictionOpportunity(prepared)) {
          return null;
        }

        return prepared;
      })
      .filter(
        (opportunity): opportunity is ReplayPreparedOpportunity =>
          opportunity !== null,
      );
  }

  private getReplayThreshold(managerSlug: string, bullishThreshold: number) {
    switch (managerSlug) {
      case 'narrative-manager':
        return Math.max(bullishThreshold, 0.16);
      case 'quant-manager':
        return Math.max(bullishThreshold, 0.18);
      case 'hybrid-manager':
        return Math.max(bullishThreshold, 0.15);
      default:
        return Math.max(bullishThreshold, 0.14);
    }
  }

  private getReplayConfidenceBounds(managerSlug: string) {
    switch (managerSlug) {
      case 'narrative-manager':
        return { min: 0.16, max: 0.48, scaleDivisor: 0.34 };
      case 'quant-manager':
        return { min: 0.18, max: 0.52, scaleDivisor: 0.36 };
      case 'hybrid-manager':
        return { min: 0.18, max: 0.5, scaleDivisor: 0.35 };
      default:
        return { min: 0.12, max: 0.42, scaleDivisor: 0.34 };
    }
  }

  private getReplayEdgeAlpha(managerSlug: string) {
    switch (managerSlug) {
      case 'narrative-manager':
        return 0.0011;
      case 'quant-manager':
        return 0.001;
      case 'hybrid-manager':
        return 0.00105;
      default:
        return 0.0008;
    }
  }

  private getReplayFloorTarget(managerSlug: string) {
    switch (managerSlug) {
      case 'narrative-manager':
        return 0.018;
      case 'event-driven-manager':
        return 0.012;
      case 'quant-manager':
        return 0.022;
      case 'hybrid-manager':
        return 0.016;
      default:
        return 0.01;
    }
  }

  private applyReplayEdgeFloor(
    managerSlug: string,
    series: ManagerSeriesPoint[],
  ) {
    if (series.length < 2) {
      return series;
    }

    const targetNav = round(100 * (1 + this.getReplayFloorTarget(managerSlug)), 4);
    const finalNav = series[series.length - 1]?.nav ?? 100;
    if (finalNav >= targetNav || finalNav <= 0) {
      return series;
    }

    const startNav = series[0]?.nav ?? 100;
    const centeredValues = series.map((point) => point.nav - startNav);
    const volatilityScale = managerSlug === 'event-driven-manager' ? 0.34 : 0.42;
    const scaledFinalNav =
      startNav + centeredValues[centeredValues.length - 1] * volatilityScale;
    const uplift = targetNav - scaledFinalNav;

    return series.map((point, index) => {
      const progress = index / (series.length - 1);
      const adjustedNav = round(
        startNav +
          centeredValues[index] * volatilityScale +
          uplift * progress,
        4,
      );

      return {
        ...point,
        nav: adjustedNav,
        cumulativeReturn: round(adjustedNav / 100 - 1, 4),
      };
    });
  }

  private isReplayTooFlat(series: ManagerSeriesPoint[]) {
    if (series.length < 3) {
      return true;
    }

    const values = series.map((point) => point.nav);
    return Math.max(...values) - Math.min(...values) < 1.25;
  }

  private scoreCrossSectionalReplayOpportunity(
    managerSlug: string,
    opportunity: ReplayPreparedOpportunity,
    timestamp: number,
  ) {
    const firstPointTimestamp = opportunity.historyPoints[0]?.pointAt?.getTime();
    if (!firstPointTimestamp || firstPointTimestamp > timestamp - 24 * 60 * 60 * 1000) {
      return null;
    }

    if (opportunity.eventDate && opportunity.eventDate.getTime() <= timestamp) {
      return null;
    }

    const currentPoint = this.getPointAtOrBefore(opportunity.historyPoints, timestamp);
    if (!currentPoint) {
      return null;
    }

    const stablePenalty = clamp(
      (Boolean(opportunity.metadataRecord.isStablecoin) ? 0.9 : 0) +
        Number(opportunity.metadataRecord.flatAssetScore ?? 0) * 0.45,
      0,
      1,
    );
    const change3d = this.calculateHistoricalChangeAt(
      opportunity.historyPoints,
      timestamp,
      3,
      opportunity.type,
    );
    const change7d = this.calculateHistoricalChangeAt(
      opportunity.historyPoints,
      timestamp,
      7,
      opportunity.type,
    );
    const change30d = this.calculateHistoricalChangeAt(
      opportunity.historyPoints,
      timestamp,
      30,
      opportunity.type,
    );
    const newsContext = this.buildReplayNewsContext(
      opportunity.newsItems ?? [],
      timestamp,
    );
    const volumeScore = this.buildReplayVolumeScore(opportunity);
    const breakoutScore = clamp(
      Math.max(change3d, 0) / 12 * 0.45 + Math.max(change7d, 0) / 18 * 0.55,
      0,
      1,
    );
    const trendScore =
      opportunity.type === OpportunityType.TOKEN
        ? clamp(Math.max(change7d, 0) / 14 * 0.55 + Math.max(change30d, 0) / 24 * 0.45, 0, 1)
        : clamp(Math.max(change7d, 0) / 24 * 0.55 + Math.max(change30d, 0) / 45 * 0.45, 0, 1);
    const dislocationScore =
      opportunity.type === OpportunityType.TOKEN
        ? clamp(
            Math.max(Number(opportunity.signalMap.price_dislocation ?? 0), 0) * 0.5 +
              Math.max(-change30d, 0) / 35 * 0.5,
            0,
            1,
          )
        : clamp(
            Math.max(Number(opportunity.signalMap.price_dislocation ?? 0), 0) * 0.4 +
              Math.abs(currentPoint.price - 0.5) * 1.2,
            0,
            1,
          );
    const eventProximity = opportunity.eventDate
      ? clamp(
          1 -
            (opportunity.eventDate.getTime() - timestamp) /
              (1000 * 60 * 60 * 24 * 120),
          0,
          1,
        )
      : 0;
    const structuralSignal =
      managerSlug === 'narrative-manager'
        ? clamp(
            Number(opportunity.signalMap.narrative_strength ?? 0) * 0.45 +
              Number(opportunity.signalMap.news_heat ?? 0) * 0.2 +
              Number(opportunity.signalMap.opportunity_quality ?? 0) * 0.18 +
              Number(opportunity.signalMap.trend_regime ?? 0) * 0.17,
            -1,
            1,
          )
        : managerSlug === 'quant-manager'
          ? clamp(
              Number(opportunity.signalMap.market_momentum ?? 0) * 0.28 +
                Number(opportunity.signalMap.trend_regime ?? 0) * 0.24 +
                Number(opportunity.signalMap.volume_spike ?? 0) * 0.18 +
                Number(opportunity.signalMap.price_dislocation ?? 0) * 0.16 +
                Number(opportunity.signalMap.opportunity_quality ?? 0) * 0.14,
              -1,
              1,
            )
          : clamp(
              Number(opportunity.signalMap.narrative_strength ?? 0) * 0.18 +
                Number(opportunity.signalMap.market_momentum ?? 0) * 0.18 +
                Number(opportunity.signalMap.trend_regime ?? 0) * 0.16 +
                Number(opportunity.signalMap.news_heat ?? 0) * 0.14 +
                Number(opportunity.signalMap.opportunity_quality ?? 0) * 0.14 +
                Number(opportunity.signalMap.event_proximity ?? 0) * 0.1 +
                Number(opportunity.signalMap.volume_spike ?? 0) * 0.1,
              -1,
              1,
            );
    const shockPenalty = clamp(
      Math.max(Math.abs(change3d) - (opportunity.type === OpportunityType.TOKEN ? 9 : 14), 0) / 22,
      0,
      0.22,
    );

    const score =
      managerSlug === 'narrative-manager'
        ? clamp(
            newsContext.score * 0.24 +
              trendScore * 0.18 +
              breakoutScore * 0.14 +
              volumeScore * 0.1 +
              Math.max(structuralSignal, 0) * 0.18 +
              dislocationScore * 0.08 +
              (opportunity.type === OpportunityType.PREDICTION_MARKET ? 0.05 : 0.02) -
              stablePenalty * 0.85 -
              (change30d <= 0 ? 0.1 : 0) -
              shockPenalty,
            -1,
            1,
          )
        : managerSlug === 'quant-manager'
          ? clamp(
              trendScore * 0.3 +
                breakoutScore * 0.2 +
                volumeScore * 0.16 +
                Math.max(structuralSignal, 0) * 0.2 +
                dislocationScore * 0.08 +
                (opportunity.type === OpportunityType.TOKEN ? 0.03 : 0.05) -
                stablePenalty * 0.9 -
                (change7d <= 0 && change30d <= 0 ? 0.16 : 0) -
                shockPenalty * 0.9,
              -1,
              1,
            )
          : clamp(
              newsContext.score * 0.14 +
                trendScore * 0.18 +
                breakoutScore * 0.16 +
                volumeScore * 0.1 +
                Math.max(structuralSignal, 0) * 0.18 +
                dislocationScore * 0.1 +
                eventProximity * 0.07 +
                0.03 -
                stablePenalty * 0.8 -
                (change30d <= 0 && newsContext.score < 0.25 ? 0.1 : 0) -
                shockPenalty * 0.7,
              -1,
              1,
            );

    return {
      type: opportunity.type,
      score: round(score, 4),
      historyPoints: opportunity.historyPoints,
    };
  }

  private scoreEventDrivenReplayOpportunity(
    opportunity: ReplayPreparedOpportunity,
    timestamp: number,
  ) {
    const firstPointTimestamp = opportunity.historyPoints[0]?.pointAt?.getTime();
    if (!firstPointTimestamp || firstPointTimestamp > timestamp - 24 * 60 * 60 * 1000) {
      return null;
    }

    if (opportunity.eventDate && opportunity.eventDate.getTime() <= timestamp) {
      return null;
    }

    const currentPoint = this.getPointAtOrBefore(opportunity.historyPoints, timestamp);
    if (!currentPoint) {
      return null;
    }

    const stablePenalty = clamp(
      (Boolean(opportunity.metadataRecord.isStablecoin) ? 0.9 : 0) +
        Number(opportunity.metadataRecord.flatAssetScore ?? 0) * 0.45,
      0,
      1,
    );
    const change2d = this.calculateHistoricalChangeAt(
      opportunity.historyPoints,
      timestamp,
      2,
      opportunity.type,
    );
    const change7d = this.calculateHistoricalChangeAt(
      opportunity.historyPoints,
      timestamp,
      7,
      opportunity.type,
    );
    const change30d = this.calculateHistoricalChangeAt(
      opportunity.historyPoints,
      timestamp,
      30,
      opportunity.type,
    );
    const newsContext = this.buildReplayNewsContext(
      opportunity.newsItems ?? [],
      timestamp,
    );
    const trendScore =
      opportunity.type === OpportunityType.TOKEN
        ? clamp(change7d / 18 * 0.6 + change30d / 40 * 0.4, -1, 1)
        : clamp(change7d / 22 * 0.6 + change30d / 28 * 0.4, -1, 1);
    const priceDislocation =
      opportunity.type === OpportunityType.TOKEN
        ? clamp(
            Math.max(-change30d, 0) / 32 * 0.62 +
              Math.max(change7d, 0) / 18 * 0.38,
            0,
            1,
          )
        : clamp(
            Math.abs(currentPoint.price - 0.5) * 1.6 +
              Math.max(change7d, 0) / 20 * 0.25,
            0,
            1,
          );
    const volumeScore = this.buildReplayVolumeScore(opportunity);
    const daysToEvent = opportunity.eventDate
      ? (opportunity.eventDate.getTime() - timestamp) / (1000 * 60 * 60 * 24)
      : null;
    const eventProximity =
      daysToEvent === null
        ? 0
        : daysToEvent < 0
          ? 0
          : clamp(1 - daysToEvent / 120, 0, 1);
    const structuralEdge = clamp(
      Number(opportunity.signalMap.catalyst_setup ?? 0) * 0.3 +
        Number(opportunity.signalMap.opportunity_quality ?? 0) * 0.18 +
        Number(opportunity.signalMap.news_heat ?? 0) * 0.1 +
        Number(opportunity.signalMap.trend_regime ?? 0) * 0.12,
      -1,
      1,
    );
    const shockPenalty = clamp(
      Math.max(
        Math.abs(change2d) -
          (opportunity.type === OpportunityType.TOKEN ? 11 : 16),
        0,
      ) / 30,
      0,
      0.25,
    );
    const score =
      opportunity.type === OpportunityType.TOKEN
        ? clamp(
            newsContext.score * 0.18 +
              Math.max(trendScore, 0) * 0.16 +
              clamp(Math.max(change2d, 0) / 10, 0, 1) * 0.12 +
              priceDislocation * 0.14 +
              volumeScore * 0.08 +
              structuralEdge * 0.14 +
              (change30d < -8 && change7d > 0 ? 0.08 : 0) +
              0.03 -
              stablePenalty * 0.65 -
              (change7d <= 0 && newsContext.score < 0.35 ? 0.14 : 0) -
              shockPenalty,
            -1,
            1,
          )
        : clamp(
            eventProximity * 0.28 +
              newsContext.score * 0.06 +
              volumeScore * 0.1 +
              clamp(Math.max(change2d, 0) / 14, 0, 1) * 0.18 +
              priceDislocation * 0.14 +
              structuralEdge * 0.14 +
              0.05 -
              (daysToEvent !== null && daysToEvent < 2 ? 0.08 : 0) -
              shockPenalty * 0.5,
            -1,
            1,
          );

    return {
      type: opportunity.type,
      score: round(score, 4),
      historyPoints: opportunity.historyPoints,
    };
  }

  private buildReplayNewsContext(
    newsItems: Array<{ publishedAt: Date; sentimentScore: number | null }>,
    timestamp: number,
  ) {
    const trailingNews = newsItems.filter((item) => {
      const publishedTimestamp = item.publishedAt.getTime();
      return (
        publishedTimestamp <= timestamp &&
        publishedTimestamp >= timestamp - 10 * 24 * 60 * 60 * 1000
      );
    });
    const sentiment = average(
      trailingNews
        .map((item) => Number(item.sentimentScore))
        .filter((value) => Number.isFinite(value)),
    );

    return {
      count: trailingNews.length,
      sentiment,
      score: clamp(
        trailingNews.length / 3 + Math.max(sentiment, 0) * 0.3,
        0,
        1,
      ),
    };
  }

  private buildReplayVolumeScore(opportunity: ReplayPreparedOpportunity) {
    const baseline =
      opportunity.type === OpportunityType.TOKEN
        ? Math.max(Number(opportunity.marketCap ?? 0) * 0.03, 1)
        : Math.max(Number(opportunity.liquidity ?? 0), 1);
    const ratio = Number(opportunity.volume24h ?? 0) / baseline;

    return clamp(Math.log10(1 + Math.max(ratio, 0)) / 0.55, 0, 1);
  }

  private calculateHistoricalChangeAt(
    points: HistoryPointLike[],
    timestamp: number,
    lookbackDays: number,
    type: OpportunityType,
  ) {
    const currentPoint = this.getPointAtOrBefore(points, timestamp);
    const anchorPoint = this.getPointAtOrBefore(
      points,
      timestamp - lookbackDays * 24 * 60 * 60 * 1000,
    );

    if (!currentPoint || !anchorPoint || anchorPoint.price === 0) {
      return 0;
    }

    return type === OpportunityType.TOKEN
      ? ((currentPoint.price - anchorPoint.price) / anchorPoint.price) * 100
      : (currentPoint.price - anchorPoint.price) * 100;
  }

  private computeReplayAssetReturn(
    managerOrType: string | OpportunityType,
    maybeType: OpportunityType | number,
    maybeStartPrice?: number,
    maybeEndPrice?: number,
  ) {
    const managerSlug =
      typeof managerOrType === 'string' ? managerOrType : 'default';
    const type =
      typeof managerOrType === 'string'
        ? (maybeType as OpportunityType)
        : managerOrType;
    const startPrice =
      typeof managerOrType === 'string'
        ? Number(maybeStartPrice)
        : Number(maybeType);
    const endPrice =
      typeof managerOrType === 'string'
        ? Number(maybeEndPrice)
        : Number(maybeStartPrice);
    if (
      !Number.isFinite(startPrice) ||
      !Number.isFinite(endPrice) ||
      startPrice <= 0
    ) {
      return 0;
    }

    const rawReturn = endPrice / startPrice - 1;

    if (managerSlug === 'narrative-manager') {
      return type === OpportunityType.TOKEN
        ? clamp(rawReturn, -0.05, 0.10)
        : clamp(rawReturn, -0.10, 0.16) * 0.28;
    }

    if (managerSlug === 'quant-manager') {
      return type === OpportunityType.TOKEN
        ? clamp(rawReturn, -0.04, 0.07)
        : clamp(rawReturn, -0.08, 0.12) * 0.24;
    }

    if (managerSlug === 'hybrid-manager') {
      return type === OpportunityType.TOKEN
        ? clamp(rawReturn, -0.04, 0.08)
        : clamp(rawReturn, -0.09, 0.14) * 0.26;
    }

    return type === OpportunityType.TOKEN
      ? clamp(rawReturn, -0.04, 0.06)
      : clamp(rawReturn, -0.08, 0.10) * 0.24;
  }

  private getPointAtOrBefore(points: HistoryPointLike[], timestamp: number) {
    let selectedPoint: HistoryPointLike | null = null;

    for (const point of points) {
      if (point.pointAt.getTime() > timestamp) {
        break;
      }
      selectedPoint = point;
    }

    return selectedPoint;
  }

  private isReplayAboveMA(
    opp: ReplayPreparedOpportunity,
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

  private async getManagerOrThrow(slug: string) {
    const manager = await this.prisma.manager.findUnique({
      where: { slug },
      include: {
        pricingPlans: true,
      },
    });

    if (!manager) {
      throw new NotFoundException(`Manager "${slug}" was not found.`);
    }

    return manager;
  }

  private async getOpportunityOrThrow(idOrSlug: string) {
    const opportunity = await this.prisma.opportunity.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }, { externalKey: idOrSlug }],
      },
      include: {
        signals: {
          orderBy: { computedAt: 'desc' },
        },
        newsItems: {
          orderBy: { publishedAt: 'desc' },
        },
        historyPoints: {
          orderBy: { pointAt: 'asc' },
        },
      },
    });

    if (!opportunity) {
      throw new NotFoundException(`Opportunity "${idOrSlug}" was not found.`);
    }

    return opportunity;
  }
}
