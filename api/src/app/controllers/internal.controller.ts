import { Body, Controller, Post } from '@nestjs/common';
import { BacktestService } from '../services/backtest.service';
import { ManagerEngineService } from '../services/manager-engine.service';
import { MemoService } from '../services/memo.service';
import { PerformanceService } from '../services/performance.service';
import { PortfolioService } from '../services/portfolio.service';
import { SignalEngineService } from '../services/signal-engine.service';
import { SourceIngestionService } from '../services/source-ingestion.service';

@Controller('internal')
export class InternalController {
  constructor(
    private readonly sourceIngestionService: SourceIngestionService,
    private readonly signalEngineService: SignalEngineService,
    private readonly managerEngineService: ManagerEngineService,
    private readonly portfolioService: PortfolioService,
    private readonly performanceService: PerformanceService,
    private readonly memoService: MemoService,
    private readonly backtestService: BacktestService,
  ) {}

  @Post('bootstrap')
  async bootstrap(@Body() payload?: { managerSlug?: string; withMemos?: boolean }) {
    const sources = await this.sourceIngestionService.runBootstrap();
    const signals = await this.signalEngineService.recomputeSignals();
    const managers = await this.managerEngineService.runManagers();
    const portfolios = await this.portfolioService.rebalancePortfolios();
    const performance = await this.performanceService.snapshotPerformance();
    const memos =
      payload?.withMemos === false
        ? { skipped: true }
        : await this.memoService.generateMemos(payload?.managerSlug);

    return { sources, signals, managers, portfolios, performance, memos };
  }

  @Post('ingest/coingecko')
  ingestCoinGecko(@Body() payload?: { limit?: number }) {
    return this.sourceIngestionService.ingestCoinGecko(payload?.limit);
  }

  @Post('ingest/polymarket')
  ingestPolymarket(@Body() payload?: { limit?: number }) {
    return this.sourceIngestionService.ingestPolymarket(payload?.limit);
  }

  @Post('ingest/news')
  ingestNews(@Body() payload?: { limitPerOpportunity?: number }) {
    return this.sourceIngestionService.ingestNews(payload?.limitPerOpportunity);
  }

  @Post('normalize/opportunities')
  normalizeOpportunities() {
    return this.sourceIngestionService.normalizeOpportunities();
  }

  @Post('signals/recompute')
  recomputeSignals() {
    return this.signalEngineService.recomputeSignals();
  }

  @Post('managers/run')
  runManagers() {
    return this.managerEngineService.runManagers();
  }

  @Post('portfolio/rebalance')
  rebalancePortfolio() {
    return this.portfolioService.rebalancePortfolios();
  }

  @Post('performance/snapshot')
  snapshotPerformance() {
    return this.performanceService.snapshotPerformance();
  }

  @Post('memos/generate')
  generateMemos(@Body() payload?: { managerSlug?: string }) {
    return this.memoService.generateMemos(payload?.managerSlug);
  }

  @Post('backtest/run')
  runBacktest(@Body() payload?: { days?: number }) {
    return this.backtestService.runBacktest(payload?.days ?? 180);
  }
}
