const baseUrl = process.env.APP_URL ?? 'http://localhost:3001';
const skipMemos =
  process.env.SKIP_MEMOS === '1' || process.argv.includes('--skip-memos');

const steps = [
  '/api/internal/ingest/coingecko',
  '/api/internal/ingest/polymarket',
  '/api/internal/normalize/opportunities',
  '/api/internal/ingest/ohlcv',
  '/api/internal/ingest/news',
  '/api/internal/signals/recompute',
  '/api/internal/managers/run',
  '/api/internal/portfolio/rebalance',
  '/api/internal/performance/snapshot',
  ...(skipMemos ? [] : ['/api/internal/memos/generate']),
];

async function main() {
  for (const step of steps) {
    const response = await fetch(`${baseUrl}${step}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${step} failed: ${response.status} ${body}`);
    }

    const data = await response.json();
    console.log(step, JSON.stringify(data, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
