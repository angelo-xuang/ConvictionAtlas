import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';

export interface BridgeOhlcvRow {
  ts: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const DEFAULT_DUCKDB_PATH = '/data/crypto-data/meta.duckdb';

// ConvictionAtlas opportunity slug -> crypto-data symbol (Binance spot, USDT-quoted).
// Tokens not in this map fall back to the legacy CoinGecko path.
// Excludes hyperliquid-hype (no Binance spot pair — Binance only lists HYPE
// as a perp; falls back to CoinGecko OHLC for now).
const SLUG_TO_BINANCE_SYMBOL: Readonly<Record<string, string>> = Object.freeze({
  'bitcoin-btc': 'BTC-USDT',
  'ethereum-eth': 'ETH-USDT',
  'bnb-bnb': 'BNB-USDT',
  'solana-sol': 'SOL-USDT',
  'xrp-xrp': 'XRP-USDT',
  'dogecoin-doge': 'DOGE-USDT',
  'tron-trx': 'TRX-USDT',
  'usdc-usdc': 'USDC-USDT',
  'usds-usds': 'USDS-USDT',
  'zcash-zec': 'ZEC-USDT',
});

const SUPPORTED_TIMEFRAMES = new Set(['1d', '1h', '5m', '1m']);

@Injectable()
export class CryptoDataBridgeService {
  private readonly logger = new Logger(CryptoDataBridgeService.name);

  constructor(private readonly configService: ConfigService) {}

  resolveSymbol(slug: string): string | null {
    return SLUG_TO_BINANCE_SYMBOL[slug] ?? null;
  }

  /**
   * True only when the bridge has a symbol mapping AND meta.duckdb opens
   * successfully. Callers should treat false as "fall back to CoinGecko".
   */
  async isAvailable(slug: string): Promise<boolean> {
    if (!this.resolveSymbol(slug)) return false;
    try {
      await this.withConnection(async () => null);
      return true;
    } catch (err) {
      this.logger.warn(`bridge unavailable: ${(err as Error).message}`);
      return false;
    }
  }

  async fetchOhlcv(
    slug: string,
    timeframe: string,
    sinceMs: number,
    untilMs: number = Date.now(),
  ): Promise<BridgeOhlcvRow[]> {
    const symbol = this.resolveSymbol(slug);
    if (!symbol) return [];
    if (!SUPPORTED_TIMEFRAMES.has(timeframe)) {
      throw new Error(`crypto-data bridge: unsupported timeframe ${timeframe}`);
    }

    const view = `ohlcv_${timeframe}`;
    const sinceIso = new Date(sinceMs).toISOString();
    const untilIso = new Date(untilMs).toISOString();

    const rows = await this.withConnection(async (connection) => {
      const reader = await connection.run(
        `SELECT epoch_ms(ts) AS ts_ms, open, high, low, close, volume
         FROM ${view}
         WHERE symbol = $symbol
           AND ts >= TIMESTAMPTZ '${sinceIso}'
           AND ts <  TIMESTAMPTZ '${untilIso}'
         ORDER BY ts ASC`,
        { symbol },
      );
      return reader.getRowsJson();
    });

    if (!rows) return [];
    return rows.map((row) => ({
      ts: new Date(Number(row[0])),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }));
  }

  /**
   * Convenience: collapse OHLCV into the legacy
   * (pointAt, price, volume) shape that OpportunityHistory expects.
   */
  async fetchDailyHistory(
    slug: string,
    sinceMs: number,
    untilMs: number = Date.now(),
  ): Promise<Array<{ pointAt: Date; price: number; volume: number }>> {
    const rows = await this.fetchOhlcv(slug, '1d', sinceMs, untilMs);
    return rows.map((row) => ({
      pointAt: row.ts,
      price: row.close,
      volume: row.volume,
    }));
  }

  private duckdbPath(): string {
    return (
      this.configService.get<string>('CRYPTO_DATA_DUCKDB') ?? DEFAULT_DUCKDB_PATH
    );
  }

  /**
   * Open a short-lived DuckDB connection so we pick up any meta.duckdb
   * atomic-rename done by crypto-data's `build_views.py`. Holding a
   * long-lived connection would pin the old inode after a swap.
   * Both the connection and the instance must be closed in `finally` —
   * the instance owns the native file handle and isn't released by GC
   * in time on a long-running API process.
   */
  private async withConnection<T>(
    fn: (connection: DuckDBConnection) => Promise<T>,
  ): Promise<T> {
    const instance = await DuckDBInstance.create(this.duckdbPath(), {
      access_mode: 'READ_ONLY',
    });
    let connection: DuckDBConnection | null = null;
    try {
      connection = await instance.connect();
      return await fn(connection);
    } finally {
      try {
        connection?.closeSync();
      } catch (err) {
        this.logger.warn(`connection.closeSync failed: ${(err as Error).message}`);
      }
      try {
        instance.closeSync();
      } catch (err) {
        this.logger.warn(`instance.closeSync failed: ${(err as Error).message}`);
      }
    }
  }
}
