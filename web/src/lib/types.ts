export type Direction = 'BULLISH' | 'NEUTRAL' | 'BEARISH';
export type OpportunityType = 'TOKEN' | 'PREDICTION_MARKET';
export type SourceKind =
  | 'COINGECKO'
  | 'POLYMARKET'
  | 'CRYPTOPANIC'
  | 'GNEWS'
  | 'NEWSAPI'
  | 'GOOGLE_NEWS_RSS';

export interface PricingPlan {
  id: string;
  managerId: string;
  name: string;
  cadence: string;
  amountUsd: number;
  description: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Review {
  id: string;
  managerId: string;
  authorName: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface Signal {
  id: string;
  opportunityId: string;
  name: string;
  value: number;
  direction: Direction;
  confidence: number;
  rationale: string;
  metadata: string;
  computedAt: string;
}

export interface NewsItem {
  id: string;
  provider: SourceKind;
  externalId: string;
  opportunityId: string | null;
  title: string;
  summary: string | null;
  url: string;
  imageUrl: string | null;
  publishedAt: string;
  sourceName: string | null;
}

export interface OpportunityHistoryPoint {
  id: string;
  opportunityId: string;
  pointAt: string;
  price: number;
  volume: number | null;
  metadata: string;
}

export interface PerformanceSeriesPoint {
  pointAt: string;
  nav: number;
  cumulativeReturn: number;
}

export interface SignalMixItem {
  name: string;
  weight: number;
}

export interface OpportunityManagerView {
  manager: string;
  slug: string;
  convictionScore: number;
  direction: Direction;
}

export interface ManagerRecord {
  id: string;
  slug: string;
  name: string;
  description: string;
  style: string;
  riskProfile: string;
  rebalanceCadence: string;
  memoStyle: string;
  universe: string;
  pricingSummary: string | null;
  metadata: string;
  createdAt: string;
  updatedAt: string;
}

export interface OpportunitySummary {
  id: string;
  externalKey: string;
  sourceKind: SourceKind;
  type: OpportunityType;
  slug: string;
  title: string;
  symbol: string | null;
  summary: string | null;
  description: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  status: string | null;
  category: string | null;
  currentPrice: number | null;
  priceChange24h: number | null;
  volume24h: number | null;
  marketCap: number | null;
  liquidity: number | null;
  eventDate: string | null;
  lastUpdatedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  signals: Signal[];
  newsItems: NewsItem[];
  strongestSignal: Signal | null;
  managers: OpportunityManagerView[];
}

export interface OpportunityDetail extends OpportunitySummary {
  historyPoints: OpportunityHistoryPoint[];
}

export interface Position {
  id: string;
  portfolioSnapshotId: string;
  opportunityId: string;
  weight: number;
  convictionScore: number;
  entryPrice: number | null;
  note: string | null;
  opportunity: OpportunitySummary;
}

export interface PortfolioSnapshot {
  id: string;
  managerId: string;
  cashWeight: number;
  grossExposure: number;
  netExposure: number;
  riskScore: number;
  nav: number;
  metadata: string;
  computedAt: string;
  positions: Position[];
}

export interface PerformanceSnapshot {
  id: string;
  managerId: string;
  portfolioSnapshotId: string | null;
  nav: number;
  dailyReturn: number;
  cumulativeReturn: number;
  drawdown: number;
  sharpe: number;
  hitRate: number;
  metadata: string;
  computedAt: string;
}

export interface Memo {
  id: string;
  managerId: string;
  opportunityId: string | null;
  title: string;
  summary: string;
  content: string;
  isPremium: boolean;
  accessTier: string;
  generatedBy: string;
  createdAt: string;
  opportunity?: OpportunitySummary | null;
}

export interface MemoUnlockResult {
  success: boolean;
  message: string;
}


export interface CTABlueprintParams {
  adxThreshold: number;
  maxRiskPerPosition: number;
  onlyTokenTypes: boolean;
}

export interface ManagerBlueprintInfo {
  strategyType: 'linear' | 'cta' | 'score' | 'rule';
  opportunityTypeBias: Partial<Record<string, number>>;
  bullishThreshold: number;
  bearishThreshold: number;
  cashFloor: number;
  maxPositions: number;
  ctaParams?: CTABlueprintParams;
  // 量化经理:逐条策略参数(信号源/调仓/约束/成本/止损)。存在时前端直接渲染,
  // 覆盖 cta/score 那套 crypto 口径的持仓逻辑文案。
  playbook?: { label: string; value: string }[];
}

export interface ManagerSummary {
  id: string;
  slug: string;
  name: string;
  style: string;
  riskProfile: string;
  description: string;
  pricingSummary: string | null;
  latestNav: number;
  dailyReturn: number;
  cumulativeReturn: number;
  drawdown: number;
  sharpe: number;
  hitRate: number;
  grossExposure: number;
  cashWeight: number;
  riskScore: number;
  averageRating: number | null;
  topPositions: Array<{
    id: string;
    title: string;
    slug: string;
    weight: number;
    imageUrl: string | null;
    symbol: string | null;
    sourceKind: SourceKind;
    priceChange24h: number | null;
  }>;
  performanceSeries: PerformanceSeriesPoint[];
  signalMix: SignalMixItem[];
  blueprint: ManagerBlueprintInfo;
  pricingPlans: PricingPlan[];
}

export interface ManagerDetail {
  id: string;
  slug: string;
  name: string;
  description: string;
  style: string;
  riskProfile: string;
  baseCcy?: string;
  rebalanceCadence: string;
  memoStyle: string;
  universe: string;
  pricingSummary: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  pricingPlans: PricingPlan[];
  latestPerformance: PerformanceSnapshot | null;
  latestPortfolio: PortfolioSnapshot | null;
  reviews: Review[];
  ratingAverage: number | null;
  performanceSeries: PerformanceSeriesPoint[];
  derivedPerformance: {
    nav: number;
    dailyReturn: number;
    cumulativeReturn: number;
    drawdown: number;
    sharpe: number;
    hitRate: number;
    lookbackDays: number;
  };
  signalMix: SignalMixItem[];
  blueprint: ManagerBlueprintInfo;
  latestDecisions: Array<{
    id: string;
    direction: Direction;
    convictionScore: number;
    targetWeight: number;
    rationale: string;
    opportunity: {
      id: string;
      slug: string;
      title: string;
      summary: string | null;
      imageUrl: string | null;
      symbol: string | null;
      sourceKind: SourceKind;
      priceChange24h: number | null;
      currentPrice: number | null;
    };
  }>;
}

export interface ManagerRebalance {
  opportunityId: string;
  opportunityTitle: string;
  opportunitySlug?: string;
  opportunityImageUrl?: string | null;
  opportunitySymbol?: string | null;
  currentWeight: number;
  previousWeight: number;
  delta: number;
}

export interface ManagerReviewsResponse {
  averageRating: number | null;
  total: number;
  reviews: Review[];
}

export interface ManagerDecision {
  id: string;
  managerId: string;
  opportunityId: string;
  direction: Direction;
  convictionScore: number;
  targetWeight: number;
  rationale: string;
  metadata: string;
  computedAt: string;
  manager: ManagerRecord;
}

export interface ManagerLeaderboardEntry {
  slug: string;
  name: string;
  nav: number;
  dailyReturn: number;
  cumulativeReturn: number;
  sharpe: number;
  hitRate: number;
  grossExposure: number;
  averageRating: number | null;
  performanceSeries: PerformanceSeriesPoint[];
}

export interface OpportunityLeaderboardEntry {
  id: string;
  slug: string;
  title: string;
  type: OpportunityType;
  currentPrice: number | null;
  priceChange24h: number | null;
  volume24h: number | null;
  convictionAverage: number;
  signalStrength: number;
}
