import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InternalController } from './controllers/internal.controller';
import { LeaderboardController } from './controllers/leaderboard.controller';
import { ManagersController } from './controllers/managers.controller';
import { MemosController } from './controllers/memos.controller';
import { OpportunitiesController } from './controllers/opportunities.controller';
import { PrismaService } from './prisma/prisma.service';
import { ManagerEngineService } from './services/manager-engine.service';
import { MemoService } from './services/memo.service';
import { PerformanceService } from './services/performance.service';
import { PortfolioService } from './services/portfolio.service';
import { QueryService } from './services/query.service';
import { SignalEngineService } from './services/signal-engine.service';
import { SourceIngestionService } from './services/source-ingestion.service';
import { LlmService } from './services/llm.service';
import { TronPaymentService } from './services/tron-payment.service';
import { BacktestService } from './services/backtest.service';
import { CryptoDataBridgeService } from './services/crypto-data-bridge.service';
import { CtaBackfillService } from './services/cta-backfill.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [
    AppController,
    ManagersController,
    OpportunitiesController,
    LeaderboardController,
    MemosController,
    InternalController,
  ],
  providers: [
    AppService,
    PrismaService,
    QueryService,
    SourceIngestionService,
    SignalEngineService,
    ManagerEngineService,
    PortfolioService,
    PerformanceService,
    MemoService,
    LlmService,
    TronPaymentService,
    BacktestService,
    CryptoDataBridgeService,
    CtaBackfillService,
  ],
})
export class AppModule {}
