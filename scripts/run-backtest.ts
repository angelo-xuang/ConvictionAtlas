const BASE_URL = process.env.APP_URL || 'http://localhost:3001';
const DAYS = Number(process.env.BACKTEST_DAYS || 180);

async function main() {
  console.log(`Running ${DAYS}-day backtest against ${BASE_URL}...`);

  const res = await fetch(`${BASE_URL}/api/internal/backtest/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days: DAYS }),
  });

  if (!res.ok) {
    console.error(`Backtest failed: ${res.status} ${res.statusText}`);
    const text = await res.text();
    console.error(text);
    process.exit(1);
  }

  const data = await res.json();
  console.log('\nBacktest Results:');
  console.log(`  Period: ${data.startDate} → ${data.endDate} (${data.days} days)`);
  console.log();

  for (const m of data.managers || []) {
    console.log(`  ${m.manager}:`);
    console.log(`    NAV: ${m.finalNav.toFixed(2)}  |  Return: ${(m.cumulativeReturn * 100).toFixed(1)}%`);
    console.log(`    Sharpe: ${m.sharpe.toFixed(2)}  |  MaxDD: ${(m.maxDrawdown * 100).toFixed(1)}%  |  HitRate: ${(m.hitRate * 100).toFixed(0)}%`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
