import axios from 'axios';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SourceKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  average,
  parseJson,
  round,
  serializeJson,
  standardDeviation,
  toSlug,
  truncate,
} from '../core/helpers';
import {
  isCryptoRelevantPolymarketMarket,
  isCryptoRelevantPredictionOpportunity,
} from '../core/opportunity-universe';

type CoinGeckoMarket = {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  total_volume: number;
  price_change_percentage_24h: number;
  ath_change_percentage: number;
  ath: number;
  last_updated: string;
  sparkline_in_7d?: { price: number[] };
};

type PolymarketMarket = {
  id: string;
  question: string;
  slug: string;
  description: string;
  image?: string;
  icon?: string;
  endDate?: string;
  liquidity?: string;
  liquidityNum?: number;
  volume24hr?: number;
  volume1wk?: number;
  volume1mo?: number;
  volume24hrClob?: number;
  volume1wkClob?: number;
  volume1moClob?: number;
  volumeNum?: number;
  lastTradePrice?: number;
  oneDayPriceChange?: number;
  oneWeekPriceChange?: number;
  oneMonthPriceChange?: number;
  spread?: number;
  bestBid?: number;
  bestAsk?: number;
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
  updatedAt?: string;
  active?: boolean;
  closed?: boolean;
  events?: Array<{
    title?: string;
    slug?: string;
    image?: string;
    series?: Array<{ title?: string; slug?: string }>;
  }>;
};

type NewsTargetOpportunity = {
  id: string;
  externalKey: string;
  title: string;
  symbol: string | null;
  type: 'TOKEN' | 'PREDICTION_MARKET';
};

type ProviderArticle = {
  externalId: string;
  provider: SourceKind;
  title: string;
  summary: string;
  url: string;
  imageUrl?: string;
  publishedAt: string;
  sourceName?: string;
  sentimentScore?: number | null;
  metadata?: Record<string, unknown>;
};

type PolymarketPriceHistory = {
  history?: Array<{
    t: number;
    p: number;
  }>;
};

type CoinGeckoMarketChart = {
  prices?: Array<[number, number]>;
  total_volumes?: Array<[number, number]>;
};

type NormalizedHistoryPoint = {
  pointAt: Date;
  price: number;
  volume: number | null;
  source: string;
};

@Injectable()
export class SourceIngestionService {
  private readonly execFileAsync = promisify(execFile);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async runBootstrap() {
    const coinGecko = await this.ingestCoinGecko();
    const polymarket = await this.ingestPolymarket();
    const normalized = await this.normalizeOpportunities();
    const news = await this.ingestNews();
    // Enrich opportunities with live DefiLlama on-chain TVL signals
    // Used by the onchain-fundamentals-manager blueprint
    const onchain = await this.enrichOnchainFundamentals().catch(() => ({ enriched: 0 }));

    return { coinGecko, polymarket, normalized, news, onchain };
  }

  /**
   * Enriches TOKEN opportunities with live DefiLlama TVL trend data.
   * Writes chain TVL 5-day momentum into opportunity metadata so the
   * on-chain-fundamentals-manager can weight trend_regime and opportunity_quality
   * using real blockchain data rather than price-derived proxies.
   *
   * No API key required — uses public DefiLlama endpoints.
   */
  async enrichOnchainFundamentals(): Promise<{ enriched: number }> {
    const DEFILLAMA_BASE = 'https://api.llama.fi';
    const MOBULA_BASE = 'https://api.mobula.io/api/1';
    const mobiKey = this.configService.get<string>('MOBULA_API_KEY');

    // ── 1. DefiLlama: 5-day chain TVL momentum ────────────────────────────
    const chains = ['Ethereum', 'Tron', 'Solana', 'Base'];
    const chainTvl: Record<string, { pct5d: number; latestTvl: number }> = {};

    await Promise.allSettled(
      chains.map(async (chain) => {
        const url = `${DEFILLAMA_BASE}/v2/historicalChainTvl/${chain}`;
        const data = await this.fetchJson<Array<{ date: number; tvl: number }>>(url);
        if (!Array.isArray(data) || data.length < 5) return;
        const latest = data[data.length - 1];
        const anchor = data[data.length - 5];
        chainTvl[chain.toLowerCase()] = {
          pct5d: ((latest.tvl - anchor.tvl) / anchor.tvl) * 100,
          latestTvl: latest.tvl,
        };
      }),
    );

    // ── 2. DefiLlama: protocol 24h fee revenue ────────────────────────────
    const feesData = await this.fetchJson<{
      protocols: Array<{ name: string; total24h: number | null }>;
    }>(
      `${DEFILLAMA_BASE}/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyFees`,
    ).catch(() => ({ protocols: [] }));

    const feeMap: Record<string, number> = {};
    for (const p of feesData.protocols ?? []) {
      if (p.total24h) {
        feeMap[p.name.toLowerCase()] = p.total24h;
      }
    }

    // ── 3. Mobula: smart-money whale wallet netflow ───────────────────────
    // Track well-known smart-money addresses; compute net 24h change
    // as a proxy for accumulation (positive) vs. distribution (negative).
    const WHALE_WALLETS = [
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // Vitalik
      '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503', // Binance cold wallet
    ];
    const whaleNetflow: Record<string, number> = {};  // symbol -> net pct change
    if (mobiKey) {
      await Promise.allSettled(
        WHALE_WALLETS.map(async (wallet) => {
          const url = `${MOBULA_BASE}/wallet/portfolio?wallet=${wallet}`;
          const data = await this.fetchJson<{
            data?: { assets?: Array<{ asset: { symbol: string }; realized_pnl_24h?: number; estimated_balance?: number }> };
          }>(url, { Authorization: mobiKey }).catch(() => null);
          for (const asset of data?.data?.assets ?? []) {
            const sym = (asset.asset?.symbol ?? '').toLowerCase();
            const pnl24h = Number(asset.realized_pnl_24h ?? 0);
            const balance = Number(asset.estimated_balance ?? 1);
            // Accumulation score: positive pnl / balance => smart money in profit & holding
            whaleNetflow[sym] = (whaleNetflow[sym] ?? 0) + pnl24h / Math.max(balance, 1);
          }
        }),
      );
    }

    // ── 4. Apply enrichment to TOKEN opportunities ────────────────────────
    const tokenChainMap: Record<string, string> = {
      ethereum: 'ethereum',
      bitcoin: 'ethereum',
      solana: 'solana',
      tron: 'tron',
    };
    const maxFee = Math.max(...Object.values(feeMap), 1);

    const tokens = await this.prisma.opportunity.findMany({
      where: { type: 'TOKEN' },
      select: { id: true, symbol: true, metadata: true },
    });

    let enriched = 0;
    for (const token of tokens) {
      const sym = (token.symbol ?? '').toLowerCase();
      const chain = tokenChainMap[sym] ?? 'ethereum';
      const tvlSignal = chainTvl[chain];
      if (!tvlSignal) continue;

      const feeScore = (feeMap[sym] ?? 0) / maxFee;
      const whaleScore = Math.max(-1, Math.min(1, whaleNetflow[sym] ?? 0));
      const existing = parseJson<Record<string, unknown>>(token.metadata, {});

      await this.prisma.opportunity.update({
        where: { id: token.id },
        data: {
          metadata: serializeJson({
            ...existing,
            chain_tvl_pct5d: Math.round(tvlSignal.pct5d * 100) / 100,
            chain_tvl_latest_usd: Math.round(tvlSignal.latestTvl),
            fee_score_24h: Math.round(feeScore * 1000) / 1000,
            whale_netflow_score: Math.round(whaleScore * 1000) / 1000,
            onchain_enriched_at: new Date().toISOString(),
          }),
        },
      });
      enriched++;
    }

    return { enriched };
  }

  async ingestCoinGecko(limit?: number) {
    const marketLimit =
      limit ??
      Number(this.configService.get('COINGECKO_MARKET_LIMIT') ?? '12');
    const historyLimit = Number(
      this.configService.get('COINGECKO_HISTORY_LIMIT') ?? '4',
    );
    const baseUrl = this.configService.get<string>('COINGECKO_BASE_URL')!;
    const url = this.buildUrl(baseUrl, 'coins/markets');

    url.searchParams.set('vs_currency', 'usd');
    url.searchParams.set('order', 'market_cap_desc');
    url.searchParams.set('per_page', String(marketLimit));
    url.searchParams.set('page', '1');
    url.searchParams.set('sparkline', 'true');
    url.searchParams.set('price_change_percentage', '24h');

    const marketsResponse = await this.fetchJson<CoinGeckoMarket[] | CoinGeckoMarket>(
      url.toString(),
    );
    const markets = Array.isArray(marketsResponse)
      ? marketsResponse
      : [marketsResponse].filter(Boolean);
    let ingested = 0;

    for (const market of markets) {
      const longWindowEligible =
        market.market_cap_rank <= historyLimit &&
        !['usdt', 'usdc', 'usds', 'dai', 'usde', 'fdusd'].includes(
          market.symbol.toLowerCase(),
        );
      const historyPoints = longWindowEligible
        ? await this.fetchCoinGeckoHistory(market.id)
        : [];
      const normalizedHistory = historyPoints.length
        ? historyPoints
        : this.mapCoinGeckoSparkline(market);
      const historyMetrics = this.summarizeCoinGeckoHistory(
        market,
        normalizedHistory,
      );
      const historyMetadata = {
        marketCapRank: market.market_cap_rank,
        ath: market.ath,
        athGap: Math.abs((market.ath_change_percentage ?? 0) / 100),
        ...historyMetrics,
      };

      await this.prisma.rawIngestion.create({
        data: {
          sourceKind: SourceKind.COINGECKO,
          externalId: market.id,
          opportunityExternalKey: `coingecko:${market.id}`,
          itemType: 'market',
          payload: serializeJson(market),
        },
      });

      const opportunity = await this.prisma.opportunity.upsert({
        where: { externalKey: `coingecko:${market.id}` },
        update: {
          sourceKind: SourceKind.COINGECKO,
          type: 'TOKEN',
          slug: toSlug(`${market.name}-${market.symbol}`),
          title: market.name,
          symbol: market.symbol.toUpperCase(),
          summary: `${market.name} ranks #${market.market_cap_rank} by market cap with ${round(
            market.price_change_percentage_24h ?? 0,
            2,
          )}% 24h move.`,
          description: `${market.name} is tracked from CoinGecko market data.`,
          imageUrl: market.image,
          sourceUrl: `https://www.coingecko.com/en/coins/${market.id}`,
          status: 'active',
          category: 'token',
          currentPrice: market.current_price,
          priceChange24h: market.price_change_percentage_24h,
          volume24h: market.total_volume,
          marketCap: market.market_cap,
          liquidity: market.total_volume,
          lastUpdatedAt: new Date(market.last_updated),
          metadata: serializeJson(historyMetadata),
        },
        create: {
          externalKey: `coingecko:${market.id}`,
          sourceKind: SourceKind.COINGECKO,
          type: 'TOKEN',
          slug: toSlug(`${market.name}-${market.symbol}`),
          title: market.name,
          symbol: market.symbol.toUpperCase(),
          summary: `${market.name} ranks #${market.market_cap_rank} by market cap with ${round(
            market.price_change_percentage_24h ?? 0,
            2,
          )}% 24h move.`,
          description: `${market.name} is tracked from CoinGecko market data.`,
          imageUrl: market.image,
          sourceUrl: `https://www.coingecko.com/en/coins/${market.id}`,
          status: 'active',
          category: 'token',
          currentPrice: market.current_price,
          priceChange24h: market.price_change_percentage_24h,
          volume24h: market.total_volume,
          marketCap: market.market_cap,
          liquidity: market.total_volume,
          lastUpdatedAt: new Date(market.last_updated),
          metadata: serializeJson(historyMetadata),
        },
      });

      if (normalizedHistory.length > 1) {
        await this.prisma.opportunityHistory.deleteMany({
          where: { opportunityId: opportunity.id },
        });

        await this.prisma.opportunityHistory.createMany({
          data: normalizedHistory.map((point) => ({
            opportunityId: opportunity.id,
            pointAt: point.pointAt,
            price: round(point.price, 6),
            volume: point.volume ?? market.total_volume,
            metadata: serializeJson({ source: point.source }),
          })),
        });
      }

      ingested += 1;
    }

    return { source: 'coingecko', ingested };
  }

  async ingestPolymarket(limit?: number) {
    const marketLimit =
      limit ??
      Number(this.configService.get('POLYMARKET_MARKET_LIMIT') ?? '12');
    const baseUrl = this.configService.get<string>('POLYMARKET_GAMMA_BASE_URL')!;
    const url = this.buildUrl(baseUrl, 'markets');

    url.searchParams.set('limit', String(marketLimit));
    url.searchParams.set('closed', 'false');
    url.searchParams.set('archived', 'false');
    // Sort by 24h volume descending for highest-quality, most liquid markets
    url.searchParams.set('order', 'volume24hrClob');
    url.searchParams.set('ascending', 'false');
    // Only crypto/web3 related prediction markets — skip sports/politics noise
    url.searchParams.set('tag_slug', 'crypto');

    const marketsResponse = await this.fetchJson<
      PolymarketMarket[] | PolymarketMarket
    >(url.toString());
    const markets = Array.isArray(marketsResponse)
      ? marketsResponse
      : [marketsResponse].filter(Boolean);
    let ingested = 0;

    for (const market of markets) {
      if (!isCryptoRelevantPolymarketMarket(market)) {
        continue;
      }

      const outcomes = parseJson<string[]>(market.outcomes, []);
      const outcomePrices = parseJson<string[]>(market.outcomePrices, []);
      const clobTokenIds = parseJson<string[]>(market.clobTokenIds, []);
      const currentPrice =
        market.lastTradePrice ?? Number(outcomePrices[0] ?? 0.5);
      const event = market.events?.[0];
      const sourceUrl = `https://polymarket.com/event/${event?.slug ?? market.slug}`;

      await this.prisma.rawIngestion.create({
        data: {
          sourceKind: SourceKind.POLYMARKET,
          externalId: market.id,
          opportunityExternalKey: `polymarket:${market.id}`,
          itemType: 'market',
          payload: serializeJson(market),
        },
      });

      const opportunity = await this.prisma.opportunity.upsert({
        where: { externalKey: `polymarket:${market.id}` },
        update: {
          sourceKind: SourceKind.POLYMARKET,
          type: 'PREDICTION_MARKET',
          slug: market.slug,
          title: market.question,
          summary: truncate(
            market.description?.replace(/\s+/g, ' ') ?? market.question,
            180,
          ),
          description: market.description,
          imageUrl: market.image ?? market.icon ?? event?.image ?? null,
          sourceUrl,
          status: market.closed ? 'closed' : market.active ? 'active' : 'pending',
          category: event?.title ? truncate(event.title, 80) : 'prediction',
          currentPrice,
          priceChange24h: Number(market.oneDayPriceChange ?? 0) * 100,
          volume24h: Number(
            market.volume24hr ?? market.volume24hrClob ?? market.volumeNum ?? 0,
          ),
          liquidity: Number(market.liquidityNum ?? market.liquidity ?? 0),
          eventDate: market.endDate ? new Date(market.endDate) : null,
          lastUpdatedAt: market.updatedAt ? new Date(market.updatedAt) : new Date(),
          metadata: serializeJson({
            outcomes,
            outcomePrices,
            spread: market.spread ?? null,
            bestBid: market.bestBid ?? null,
            bestAsk: market.bestAsk ?? null,
            eventTitle: event?.title ?? null,
            clobTokenId: clobTokenIds[0] ?? null,
            oneWeekPriceChange: market.oneWeekPriceChange ?? null,
            oneMonthPriceChange: market.oneMonthPriceChange ?? null,
            volume1wk:
              market.volume1wk ?? market.volume1wkClob ?? null,
            volume1mo:
              market.volume1mo ?? market.volume1moClob ?? null,
            seriesTitle: event?.series?.[0]?.title ?? null,
            seriesSlug: event?.series?.[0]?.slug ?? null,
            seriesTitles: (event?.series ?? [])
              .map((series) => series.title)
              .filter((value): value is string => Boolean(value)),
            seriesSlugs: (event?.series ?? [])
              .map((series) => series.slug)
              .filter((value): value is string => Boolean(value)),
          }),
        },
        create: {
          externalKey: `polymarket:${market.id}`,
          sourceKind: SourceKind.POLYMARKET,
          type: 'PREDICTION_MARKET',
          slug: market.slug,
          title: market.question,
          summary: truncate(
            market.description?.replace(/\s+/g, ' ') ?? market.question,
            180,
          ),
          description: market.description,
          imageUrl: market.image ?? market.icon ?? event?.image ?? null,
          sourceUrl,
          status: market.closed ? 'closed' : market.active ? 'active' : 'pending',
          category: event?.title ? truncate(event.title, 80) : 'prediction',
          currentPrice,
          priceChange24h: Number(market.oneDayPriceChange ?? 0) * 100,
          volume24h: Number(
            market.volume24hr ?? market.volume24hrClob ?? market.volumeNum ?? 0,
          ),
          liquidity: Number(market.liquidityNum ?? market.liquidity ?? 0),
          eventDate: market.endDate ? new Date(market.endDate) : null,
          lastUpdatedAt: market.updatedAt ? new Date(market.updatedAt) : new Date(),
          metadata: serializeJson({
            outcomes,
            outcomePrices,
            spread: market.spread ?? null,
            bestBid: market.bestBid ?? null,
            bestAsk: market.bestAsk ?? null,
            eventTitle: event?.title ?? null,
            clobTokenId: clobTokenIds[0] ?? null,
            oneWeekPriceChange: market.oneWeekPriceChange ?? null,
            oneMonthPriceChange: market.oneMonthPriceChange ?? null,
            volume1wk:
              market.volume1wk ?? market.volume1wkClob ?? null,
            volume1mo:
              market.volume1mo ?? market.volume1moClob ?? null,
            seriesTitle: event?.series?.[0]?.title ?? null,
            seriesSlug: event?.series?.[0]?.slug ?? null,
            seriesTitles: (event?.series ?? [])
              .map((series) => series.title)
              .filter((value): value is string => Boolean(value)),
            seriesSlugs: (event?.series ?? [])
              .map((series) => series.slug)
              .filter((value): value is string => Boolean(value)),
          }),
        },
      });

      await this.prisma.opportunityHistory.deleteMany({
        where: { opportunityId: opportunity.id },
      });

      const historyPoints = await this.fetchPolymarketHistory(
        clobTokenIds[0],
        market.updatedAt,
      );
      const fallbackSnapshotTime = market.updatedAt
        ? new Date(market.updatedAt)
        : new Date();
      const fallbackSnapshot =
        Number.isFinite(currentPrice) && currentPrice > 0
          ? [
              {
                opportunityId: opportunity.id,
                pointAt: fallbackSnapshotTime,
                price: round(Math.max(0, Math.min(1, currentPrice)), 6),
                volume: Number(
                  market.volume24hr ?? market.volume24hrClob ?? market.volumeNum ?? 0,
                ),
                metadata: serializeJson({ source: 'current_market_snapshot' }),
              },
            ]
          : [];

      await this.prisma.opportunityHistory.createMany({
        data: historyPoints.length
          ? historyPoints.map((point) => ({
              opportunityId: opportunity.id,
              pointAt: new Date(point.t * 1000),
              price: round(point.p, 6),
              volume: null,
              metadata: serializeJson({
                source: 'clob_prices_history',
                tokenId: clobTokenIds[0] ?? null,
              }),
            }))
          : fallbackSnapshot,
      });

      ingested += 1;
    }

    await this.deactivateNonCryptoPolymarketMarkets();

    return { source: 'polymarket', ingested };
  }

  async normalizeOpportunities() {
    const opportunities = await this.prisma.opportunity.findMany();
    let normalized = 0;

    for (const opportunity of opportunities) {
      const nextStatus =
        opportunity.eventDate && opportunity.eventDate.getTime() < Date.now()
          ? 'expired'
          : opportunity.status ?? 'active';

      await this.prisma.opportunity.update({
        where: { id: opportunity.id },
        data: {
          status: nextStatus,
          category:
            opportunity.category ??
            (opportunity.type === 'TOKEN' ? 'token' : 'prediction'),
          summary:
            opportunity.summary ??
            truncate(opportunity.description ?? opportunity.title, 180),
        },
      });

      normalized += 1;
    }

    return { normalized };
  }

  async ingestNews(limitPerOpportunity?: number) {
    const cryptoPanicKey = this.configService.get<string>('CRYPTOPANIC_API_KEY');
    const gNewsKey = this.configService.get<string>('GNEWS_API_KEY');
    const newsApiKey = this.configService.get<string>('NEWSAPI_KEY');
    const providers = [
      {
        provider: SourceKind.CRYPTOPANIC,
        perOpportunity:
          limitPerOpportunity ??
          Number(
            this.configService.get('CRYPTOPANIC_RESULTS_PER_QUERY') ?? '3',
          ),
        skipped: !cryptoPanicKey,
        reason: cryptoPanicKey
          ? undefined
          : 'CRYPTOPANIC_API_KEY not configured.',
        fetchArticles: cryptoPanicKey
          ? (opportunity: NewsTargetOpportunity, query: string, limit: number) =>
              this.fetchCryptoPanicArticles(
                opportunity,
                query,
                limit,
                cryptoPanicKey,
              )
          : undefined,
      },
      {
        provider: SourceKind.GNEWS,
        perOpportunity:
          limitPerOpportunity ??
          Number(this.configService.get('GNEWS_RESULTS_PER_QUERY') ?? '3'),
        skipped: !gNewsKey,
        reason: gNewsKey ? undefined : 'GNEWS_API_KEY not configured.',
        fetchArticles: gNewsKey
          ? (_opportunity: NewsTargetOpportunity, query: string, limit: number) =>
              this.fetchGNewsArticles(query, limit)
          : undefined,
      },
      {
        provider: SourceKind.NEWSAPI,
        perOpportunity:
          limitPerOpportunity ??
          Number(this.configService.get('NEWSAPI_RESULTS_PER_QUERY') ?? '3'),
        skipped: !newsApiKey,
        reason: newsApiKey ? undefined : 'NEWSAPI_KEY not configured.',
        fetchArticles: newsApiKey
          ? (_opportunity: NewsTargetOpportunity, query: string, limit: number) =>
              this.fetchNewsApiArticles(query, limit, newsApiKey)
          : undefined,
      },
      {
        provider: 'GOOGLE_NEWS_RSS' as any,
        perOpportunity:
          limitPerOpportunity ??
          Number(this.configService.get('GOOGLE_NEWS_RSS_RESULTS_PER_QUERY') ?? '4'),
        skipped:
          String(
            this.configService.get('GOOGLE_NEWS_RSS_ENABLED') ?? 'true',
          ).toLowerCase() === 'false',
        reason:
          String(
            this.configService.get('GOOGLE_NEWS_RSS_ENABLED') ?? 'true',
          ).toLowerCase() === 'false'
            ? 'GOOGLE_NEWS_RSS_ENABLED=false.'
            : undefined,
        fetchArticles: (
          opportunity: NewsTargetOpportunity,
          query: string,
          limit: number,
        ) => this.fetchGoogleNewsRssArticles(opportunity, query, limit),
      },
    ];

    const activeProviders = providers.filter(
      (provider) => !provider.skipped && provider.fetchArticles,
    );

    if (!activeProviders.length) {
      return {
        ingested: 0,
        skipped: true,
        reason:
          'No news provider is active. Configure CRYPTOPANIC_API_KEY, GNEWS_API_KEY, NEWSAPI_KEY, or enable Google News RSS.',
        providers: providers.map(({ provider, skipped, reason }) => ({
          provider,
          ingested: 0,
          skipped,
          reason,
        })),
      };
    }

    const opportunities = await this.prisma.opportunity.findMany({
      orderBy: [{ volume24h: 'desc' }, { marketCap: 'desc' }, { updatedAt: 'desc' }],
      take: 6,
    });

    let ingested = 0;
    const providerSummaries = providers.map(({ provider, skipped, reason }) => ({
      provider,
      ingested: 0,
      skipped,
      reason,
      error: undefined as string | undefined,
    }));
    const summaryByProvider = new Map(
      providerSummaries.map((summary) => [summary.provider, summary]),
    );

    for (const opportunity of opportunities) {
      const query = this.buildOpportunityNewsQuery(opportunity);

      for (const provider of activeProviders) {
        const summary = summaryByProvider.get(provider.provider)!;
        if (summary.error) {
          continue;
        }

        try {
          const articles = await provider.fetchArticles!(
            opportunity,
            query,
            provider.perOpportunity,
          );

          for (const article of articles) {
            await this.persistNewsArticle(opportunity, query, article);
            ingested += 1;
            summary.ingested += 1;
          }
        } catch (error) {
          summary.error = this.describeProviderError(error);
        }
      }
    }

    return { ingested, providers: providerSummaries };
  }

  private async persistNewsArticle(
    opportunity: NewsTargetOpportunity,
    query: string,
    article: ProviderArticle,
  ) {
    await this.prisma.rawIngestion.create({
      data: {
        sourceKind: article.provider,
        externalId: article.externalId,
        opportunityExternalKey: opportunity.externalKey,
        itemType: 'article',
        payload: serializeJson(article),
      },
    });

    const metadata = serializeJson({
      query,
      matchedOpportunity: opportunity.title,
      providerMetadata: article.metadata ?? null,
    });
    const existingByUrl = await this.prisma.newsItem.findUnique({
      where: { url: article.url },
    });

    if (
      existingByUrl &&
      !(
        existingByUrl.provider === article.provider &&
        existingByUrl.externalId === article.externalId
      )
    ) {
      await this.prisma.newsItem.update({
        where: { id: existingByUrl.id },
        data: {
          opportunityId: opportunity.id,
          title: article.title,
          summary: article.summary,
          imageUrl: article.imageUrl ?? existingByUrl.imageUrl,
          publishedAt: new Date(article.publishedAt),
          sourceName: article.sourceName ?? existingByUrl.sourceName,
          sentimentScore: article.sentimentScore ?? existingByUrl.sentimentScore,
          metadata,
        },
      });

      return;
    }

    await this.prisma.newsItem.upsert({
      where: {
        provider_externalId: {
          provider: article.provider,
          externalId: article.externalId,
        },
      },
      update: {
        opportunityId: opportunity.id,
        title: article.title,
        summary: article.summary,
        url: article.url,
        imageUrl: article.imageUrl ?? null,
        publishedAt: new Date(article.publishedAt),
        sourceName: article.sourceName ?? null,
        sentimentScore: article.sentimentScore ?? null,
        metadata,
      },
      create: {
        provider: article.provider,
        externalId: article.externalId,
        opportunityId: opportunity.id,
        title: article.title,
        summary: article.summary,
        url: article.url,
        imageUrl: article.imageUrl ?? null,
        publishedAt: new Date(article.publishedAt),
        sourceName: article.sourceName ?? null,
        sentimentScore: article.sentimentScore ?? null,
        metadata,
      },
    });
  }

  private async fetchCryptoPanicArticles(
    opportunity: NewsTargetOpportunity,
    query: string,
    limit: number,
    apiKey: string,
  ): Promise<ProviderArticle[]> {
    const baseUrl = this.configService.get<string>('CRYPTOPANIC_BASE_URL')!;
    const url = this.buildUrl(baseUrl, 'posts/');
    const currencyCode = this.getCryptoPanicCurrencyCode(opportunity);

    url.searchParams.set('auth_token', apiKey);
    url.searchParams.set('kind', 'news');
    if (currencyCode) {
      url.searchParams.set('currencies', currencyCode);
    }

    const response = await this.fetchJson<{
      results?: Array<{
        id?: number | string;
        title?: string;
        url?: string;
        published_at?: string;
        created_at?: string;
        domain?: string;
        kind?: string;
        source?: { title?: string; domain?: string };
        metadata?: { description?: string; image?: string };
        currencies?: Array<{ code?: string; title?: string; slug?: string }>;
        votes?: { positive?: number; negative?: number; important?: number };
      }>;
    }>(url.toString());

    const mappedArticles = (response.results ?? [])
      .filter((article) => Boolean(article.url))
      .map((article) => ({
        externalId: String(article.id ?? article.url),
        provider: SourceKind.CRYPTOPANIC,
        title: article.title ?? 'Untitled CryptoPanic article',
        summary: article.metadata?.description ?? '',
        url: article.url!,
        imageUrl: article.metadata?.image,
        publishedAt:
          article.published_at ??
          article.created_at ??
          new Date().toISOString(),
        sourceName: article.source?.title ?? article.source?.domain ?? article.domain,
        sentimentScore: this.deriveCryptoPanicSentiment(article.votes),
        metadata: {
          currencies:
            article.currencies?.map(
              (currency) => currency.code ?? currency.title ?? currency.slug,
            ) ?? [],
          domain: article.domain ?? null,
          kind: article.kind ?? 'news',
          votes: article.votes ?? null,
        },
      }));

    return mappedArticles
      .map((article) => ({
        article,
        score: this.scoreNewsArticleMatch(opportunity, article),
      }))
      .filter(({ article, score }) => Boolean(currencyCode) || score > 0 || query.length < 12)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map(({ article }) => article);
  }

  private async fetchGNewsArticles(
    query: string,
    limit: number,
  ): Promise<ProviderArticle[]> {
    const baseUrl = this.configService.get<string>('GNEWS_BASE_URL')!;
    const apiKey = this.configService.get<string>('GNEWS_API_KEY')!;
    const url = this.buildUrl(baseUrl, 'search');

    url.searchParams.set('q', query);
    url.searchParams.set('lang', 'en');
    url.searchParams.set('max', String(limit));
    url.searchParams.set('apikey', apiKey);

    const response = await this.fetchJson<{
      articles?: Array<{
        title: string;
        description?: string;
        url: string;
        image?: string;
        publishedAt: string;
        source?: { name?: string };
      }>;
    }>(url.toString());

    return (response.articles ?? []).map((article) => ({
      externalId: article.url,
      provider: SourceKind.GNEWS,
      title: article.title,
      summary: article.description ?? '',
      url: article.url,
      imageUrl: article.image,
      publishedAt: article.publishedAt,
      sourceName: article.source?.name,
      metadata: null,
    }));
  }

  private async fetchNewsApiArticles(
    query: string,
    limit: number,
    apiKey: string,
  ): Promise<ProviderArticle[]> {
    const baseUrl = this.configService.get<string>('NEWSAPI_BASE_URL')!;
    const url = this.buildUrl(baseUrl, 'everything');

    url.searchParams.set('q', query);
    url.searchParams.set('language', 'en');
    url.searchParams.set('pageSize', String(limit));
    url.searchParams.set('sortBy', 'publishedAt');
    url.searchParams.set('apiKey', apiKey);

    const response = await this.fetchJson<{
      articles?: Array<{
        title: string;
        description?: string;
        url: string;
        urlToImage?: string;
        publishedAt: string;
        source?: { name?: string };
      }>;
    }>(url.toString());

    return (response.articles ?? []).map((article) => ({
      externalId: article.url,
      provider: SourceKind.NEWSAPI,
      title: article.title,
      summary: article.description ?? '',
      url: article.url,
      imageUrl: article.urlToImage,
      publishedAt: article.publishedAt,
      sourceName: article.source?.name,
      metadata: null,
    }));
  }

  private async fetchGoogleNewsRssArticles(
    opportunity: NewsTargetOpportunity,
    query: string,
    limit: number,
  ): Promise<ProviderArticle[]> {
    const feedUrl = new URL('https://news.google.com/rss/search');
    feedUrl.searchParams.set('q', query);
    feedUrl.searchParams.set('hl', 'en-US');
    feedUrl.searchParams.set('gl', 'US');
    feedUrl.searchParams.set('ceid', 'US:en');

    const xml = await this.fetchText(feedUrl.toString());
    const items = this.parseGoogleNewsRss(xml);

    return items
      .map((article) => ({
        article,
        score: this.scoreNewsArticleMatch(opportunity, article),
      }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map(({ article }) => article);
  }

  private async fetchCoinGeckoHistory(coinId: string) {
    const baseUrl = this.configService.get<string>('COINGECKO_BASE_URL')!;
    const url = this.buildUrl(baseUrl, `coins/${coinId}/market_chart`);

    url.searchParams.set('vs_currency', 'usd');
    url.searchParams.set('days', '180');
    url.searchParams.set('interval', 'daily');

    try {
      const response = await this.fetchJson<CoinGeckoMarketChart>(url.toString());
      const volumeByTimestamp = new Map(
        (response.total_volumes ?? []).map(([timestamp, volume]) => [
          Number(timestamp),
          Number(volume),
        ]),
      );

      return (response.prices ?? [])
        .map(([timestamp, price]) => ({
          pointAt: new Date(Number(timestamp)),
          price: Number(price),
          volume: volumeByTimestamp.get(Number(timestamp)) ?? null,
          source: 'market_chart_180d',
        }))
        .filter(
          (point) =>
            Number.isFinite(point.pointAt.getTime()) &&
            Number.isFinite(point.price),
        );
    } catch {
      return [];
    }
  }

  private mapCoinGeckoSparkline(market: CoinGeckoMarket): NormalizedHistoryPoint[] {
    const sparkline = market.sparkline_in_7d?.price ?? [];
    if (sparkline.length <= 1) {
      return [];
    }

    const now = new Date(market.last_updated);
    const spacingMs =
      (7 * 24 * 60 * 60 * 1000) / Math.max(sparkline.length - 1, 1);

    return sparkline.map((price, index) => ({
      pointAt: new Date(now.getTime() - (sparkline.length - index - 1) * spacingMs),
      price: Number(price),
      volume: market.total_volume,
      source: 'sparkline_7d',
    }));
  }

  private summarizeCoinGeckoHistory(
    market: CoinGeckoMarket,
    points: NormalizedHistoryPoint[],
  ) {
    const latestPrice = points[points.length - 1]?.price ?? market.current_price;
    const latestTimestamp =
      points[points.length - 1]?.pointAt.getTime() ??
      new Date(market.last_updated).getTime();
    const price7d = this.findClosestPrice(points, latestTimestamp - 7 * 24 * 60 * 60 * 1000);
    const price30d = this.findClosestPrice(
      points,
      latestTimestamp - 30 * 24 * 60 * 60 * 1000,
    );
    const prices = points.map((point) => point.price);
    const trailing7d = points.filter(
      (point) => latestTimestamp - point.pointAt.getTime() <= 7 * 24 * 60 * 60 * 1000,
    );
    const trailing7dReturns = trailing7d
      .slice(1)
      .map((point, index) =>
        this.computePercentChange(point.price, trailing7d[index].price) / 100,
      )
      .filter((value) => Number.isFinite(value));
    const priceRange30d =
      prices.length > 1
        ? (Math.max(...prices) - Math.min(...prices)) / Math.max(latestPrice, 1e-9)
        : 0;
    const priceRange7d =
      trailing7d.length > 1
        ? (Math.max(...trailing7d.map((point) => point.price)) -
            Math.min(...trailing7d.map((point) => point.price))) /
          Math.max(latestPrice, 1e-9)
        : 0;
    const stablecoinSymbols = new Set([
      'USDT',
      'USDC',
      'USDS',
      'DAI',
      'FDUSD',
      'USDE',
      'BUSD',
      'PYUSD',
      'TUSD',
      'USDD',
    ]);
    const sevenDayPriceChange =
      price7d !== null
        ? this.computePercentChange(latestPrice, price7d)
        : round(market.price_change_percentage_24h ?? 0, 4);
    const thirtyDayPriceChange =
      price30d !== null ? this.computePercentChange(latestPrice, price30d) : sevenDayPriceChange;
    const averageVolume7d = average(
      trailing7d
        .map((point) => Number(point.volume ?? 0))
        .filter((value) => Number.isFinite(value) && value > 0),
    );
    const averageVolume30d = average(
      points
        .map((point) => Number(point.volume ?? 0))
        .filter((value) => Number.isFinite(value) && value > 0),
    );
    const volatility7d = standardDeviation(trailing7dReturns);
    const flatAssetScore = Math.min(
      1,
      Math.max(
        0,
        1 -
          Math.min(Math.abs(sevenDayPriceChange) / 6, 1) -
          Math.min(priceRange7d / 0.08, 1) * 0.5,
      ),
    );
    const isStablecoin =
      stablecoinSymbols.has(market.symbol.toUpperCase()) ||
      (latestPrice >= 0.95 &&
        latestPrice <= 1.05 &&
        Math.abs(sevenDayPriceChange) < 2.5 &&
        priceRange30d < 0.12);

    return {
      sevenDayPriceChange: round(sevenDayPriceChange, 4),
      thirtyDayPriceChange: round(thirtyDayPriceChange, 4),
      volatility7d: round(volatility7d, 6),
      priceRange30d: round(priceRange30d, 4),
      averageVolume7d: round(averageVolume7d, 2),
      averageVolume30d: round(averageVolume30d, 2),
      flatAssetScore: round(flatAssetScore, 4),
      isStablecoin,
    };
  }

  private async fetchPolymarketHistory(
    clobTokenId?: string,
    _marketUpdatedAt?: string,
  ) {
    if (!clobTokenId) {
      return [];
    }

    const clobBaseUrl =
      this.configService.get<string>('POLYMARKET_CLOB_BASE_URL') ??
      'https://clob.polymarket.com';
    const url = this.buildUrl(clobBaseUrl, 'prices-history');

    url.searchParams.set('market', clobTokenId);
    url.searchParams.set('interval', 'max');
    url.searchParams.set('fidelity', '240');

    try {
      const response = await this.fetchJson<PolymarketPriceHistory>(url.toString());
      return (response.history ?? []).filter(
        (point) => Number.isFinite(point.t) && Number.isFinite(point.p),
      );
    } catch {
      return [];
    }
  }

  private async deactivateNonCryptoPolymarketMarkets() {
    const opportunities = await this.prisma.opportunity.findMany({
      where: {
        sourceKind: SourceKind.POLYMARKET,
        type: 'PREDICTION_MARKET',
        status: 'active',
      },
      select: {
        id: true,
        type: true,
        sourceKind: true,
        title: true,
        summary: true,
        description: true,
        category: true,
        metadata: true,
      },
    });

    for (const opportunity of opportunities) {
      if (isCryptoRelevantPredictionOpportunity(opportunity)) {
        continue;
      }

      const metadata = parseJson<Record<string, unknown>>(
        opportunity.metadata,
        {},
      );

      await this.prisma.opportunity.update({
        where: { id: opportunity.id },
        data: {
          status: 'inactive',
          metadata: serializeJson({
            ...metadata,
            universeExclusion: 'non_crypto_polymarket',
          }),
        },
      });
    }
  }

  private findClosestPrice(points: NormalizedHistoryPoint[], targetTimestamp: number) {
    if (!points.length) {
      return null;
    }

    let closestPoint = points[0];
    let closestDistance = Math.abs(points[0].pointAt.getTime() - targetTimestamp);

    for (const point of points.slice(1)) {
      const distance = Math.abs(point.pointAt.getTime() - targetTimestamp);
      if (distance < closestDistance) {
        closestPoint = point;
        closestDistance = distance;
      }
    }

    return closestPoint.price;
  }

  private computePercentChange(current: number, previous: number) {
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
      return 0;
    }

    return ((current - previous) / previous) * 100;
  }

  private async fetchJson<T>(url: string, extraHeaders?: Record<string, string>): Promise<T> {
    try {
      const response = await axios.get<T>(url, {
        headers: { Accept: 'application/json', ...extraHeaders },
        timeout: 20_000,
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        throw error;
      }

      if (process.platform !== 'win32') {
        throw error;
      }

      const psScript = [
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
        "$ProgressPreference = 'SilentlyContinue'",
        `(Invoke-RestMethod -Uri '${url.replace(/'/g, "''")}') | ConvertTo-Json -Depth 100`,
      ].join('; ');

      const { stdout } = await this.execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-Command', psScript],
        {
          maxBuffer: 20 * 1024 * 1024,
        },
      );

      return JSON.parse(stdout) as T;
    }
  }

  private async fetchText(
    url: string,
    extraHeaders?: Record<string, string>,
  ): Promise<string> {
    const response = await axios.get<string>(url, {
      headers: { Accept: 'application/xml,text/xml,text/plain,*/*', ...extraHeaders },
      timeout: 20_000,
      responseType: 'text',
    });

    return response.data;
  }

  private buildOpportunityNewsQuery(opportunity: NewsTargetOpportunity) {
    return opportunity.type === 'TOKEN' && opportunity.symbol
      ? `\"${opportunity.title}\" OR \"${opportunity.symbol}\" crypto`
      : `\"${opportunity.title}\" crypto OR web3`;
  }

  private getCryptoPanicCurrencyCode(opportunity: NewsTargetOpportunity) {
    if (opportunity.type !== 'TOKEN' || !opportunity.symbol) {
      return null;
    }

    const code = opportunity.symbol.trim().toUpperCase();
    return /^[A-Z0-9]{2,10}$/.test(code) ? code : null;
  }

  private scoreNewsArticleMatch(
    opportunity: NewsTargetOpportunity,
    article: Pick<ProviderArticle, 'title' | 'summary' | 'metadata'>,
  ) {
    const haystack = [
      article.title,
      article.summary,
      ...(Array.isArray(article.metadata?.currencies)
        ? article.metadata.currencies
        : []),
    ]
      .join(' ')
      .toLowerCase();
    const keywords = opportunity.title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 3);
    let score = 0;

    if (haystack.includes(opportunity.title.toLowerCase())) {
      score += 4;
    }

    if (opportunity.symbol && haystack.includes(opportunity.symbol.toLowerCase())) {
      score += 3;
    }

    for (const keyword of keywords.slice(0, 5)) {
      if (haystack.includes(keyword)) {
        score += 1;
      }
    }

    return score;
  }

  private deriveCryptoPanicSentiment(votes?: {
    positive?: number;
    negative?: number;
    important?: number;
  }) {
    const positive = Number(votes?.positive ?? 0);
    const negative = Number(votes?.negative ?? 0);
    const important = Number(votes?.important ?? 0);
    const total = positive + negative + important;

    if (!total) {
      return null;
    }

    return round((positive - negative + important * 0.25) / total, 4);
  }

  private parseGoogleNewsRss(xml: string): ProviderArticle[] {
    const items = Array.from(xml.matchAll(/<item\b[\s\S]*?<\/item>/gi));

    const articles: Array<ProviderArticle | null> = items.map((match) => {
        const itemXml = match[0];
        const title = this.decodeHtmlEntities(
          this.extractXmlTag(itemXml, 'title') ?? '',
        ).replace(/\s+-\s+[^-]+$/, '');
        const url = this.decodeHtmlEntities(
          this.extractXmlTag(itemXml, 'link') ?? '',
        );
        const publishedAt =
          this.decodeHtmlEntities(this.extractXmlTag(itemXml, 'pubDate') ?? '') ||
          new Date().toUTCString();
        const publishedDate = new Date(publishedAt);
        const sourceName =
          this.decodeHtmlEntities(
            this.extractXmlTag(itemXml, 'source') ??
              this.extractXmlTag(itemXml, 'author') ??
              'Google News',
          ) || 'Google News';
        const descriptionHtml = this.extractXmlTag(itemXml, 'description') ?? '';
        const summary = this.decodeHtmlEntities(
          descriptionHtml
            .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, ' ')
            .replace(/<img\b[^>]*>/gi, ' ')
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<\/?[^>]+>/g, ' '),
        )
          .replace(/\s+/g, ' ')
          .trim();

        if (!title || !url) {
          return null;
        }

        return {
          externalId: url,
          provider: 'GOOGLE_NEWS_RSS' as any,
          title,
          summary,
          url,
          publishedAt: Number.isFinite(publishedDate.getTime())
            ? publishedDate.toISOString()
            : new Date().toISOString(),
          sourceName,
          metadata: {
            feed: 'google-news-rss',
          },
        };
      });

    return articles.filter(
      (article): article is ProviderArticle => article !== null,
    );
  }

  private extractXmlTag(xml: string, tagName: string) {
    const match = xml.match(
      new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'),
    );
    return match?.[1]?.trim() ?? null;
  }

  private decodeHtmlEntities(value: string) {
    return value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#x2F;/gi, '/')
      .replace(/&#(\d+);/g, (_match, code) =>
        String.fromCharCode(Number(code)),
      )
      .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
        String.fromCharCode(parseInt(code, 16)),
      );
  }

  private describeProviderError(error: unknown) {
    if (axios.isAxiosError(error)) {
      const statusCode = error.response?.status;
      const errorInfo =
        typeof error.response?.data === 'string'
          ? error.response.data
          : error.response?.data?.info ?? error.response?.data?.message;

      return [statusCode ? `HTTP ${statusCode}` : null, errorInfo ?? error.message]
        .filter(Boolean)
        .join(' ');
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Unknown provider error';
  }


  /**
   * Ingest OHLCV candle data from CoinGecko for all active TOKEN opportunities.
   * CoinGecko /coins/{id}/ohlc returns [timestamp, open, high, low, close] arrays.
   * Rate limited: 2s between requests, 60s backoff on 429.
   */
  async ingestOHLCV(timeframe: string = '1d', days: number = 180) {
    const baseUrl = this.configService.get<string>('COINGECKO_BASE_URL')!;
    const opportunities = await this.prisma.opportunity.findMany({
      where: { type: 'TOKEN', status: 'active' },
    });

    let ingested = 0;
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    for (const opp of opportunities) {
      const coinId = opp.externalKey.replace('coingecko:', '');
      if (!coinId || opp.externalKey === opp.slug) continue;

      const url = this.buildUrl(baseUrl, `coins/${coinId}/ohlc`);
      url.searchParams.set('vs_currency', 'usd');
      url.searchParams.set('days', String(Math.min(days, 365)));

      try {
        if (ingested > 0) await sleep(2000);

        const candles = await this.fetchJson<number[][]>(url.toString());
        if (!Array.isArray(candles) || candles.length === 0) continue;

        for (const [ts, open, high, low, close] of candles) {
          const timestamp = new Date(ts);
          if (isNaN(timestamp.getTime())) continue;

          await this.prisma.candle.upsert({
            where: {
              opportunityId_timeframe_timestamp: {
                opportunityId: opp.id,
                timeframe,
                timestamp,
              },
            },
            update: { open, high, low, close, volume: 0 },
            create: {
              opportunityId: opp.id,
              timeframe,
              timestamp,
              open,
              high,
              low,
              close,
              volume: 0,
            },
          });
        }
        ingested++;
        console.log(`OHLCV: ${coinId} -> ${candles.length} candles`);
      } catch (error: any) {
        console.warn(`OHLCV ingest failed for ${coinId}:`, error?.message);
        if (error?.response?.status === 429) {
          console.log('Rate limited, waiting 60s...');
          await sleep(60000);
        }
      }
    }

    return { source: 'ohlcv', ingested, timeframe, candlesPerAsset: days };
  }

  private buildUrl(baseUrl: string, path: string) {
    const url = new URL(baseUrl);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
    return url;
  }
}
