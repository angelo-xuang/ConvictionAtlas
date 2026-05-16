import Link from 'next/link';
import { HeroPerformanceChart } from '../components/hero-performance-chart';

const stats = [
  { label: 'AI Managers', value: '6', detail: 'Distinct investment styles, risk profiles, and conviction engines.' },
  { label: 'Data Sources', value: '2+', detail: 'Live crypto prices from CoinGecko and prediction markets from Polymarket.' },
  { label: 'Assets Tracked', value: '12+', detail: 'Top tokens by market cap plus active crypto prediction markets.' },
];

const features = [
  {
    href: '/managers',
    index: '01',
    eyebrow: 'Portfolios',
    title: 'AI Manager Portfolios',
    description: 'Six specialized AI managers with live portfolios, performance curves, and investment memos.',
    meta: 'NAV · Performance · Positions',
  },
  {
    href: '/opportunities',
    index: '02',
    eyebrow: 'Markets',
    title: 'Market Opportunities',
    description: 'All tracked assets with signal scores, price action, and which managers are bullish or bearish.',
    meta: 'Tokens · Prediction Markets',
  },
  {
    href: '/leaderboard',
    index: '03',
    eyebrow: 'Rankings',
    title: 'Performance Rankings',
    description: 'Compare managers by NAV, Sharpe ratio, and hit rate. See which opportunities carry the most conviction.',
    meta: 'Sharpe · Returns · Conviction',
  },
];

export default function Index() {
  return (
    <div>
      {/* Hero */}
      <section className="landing-hero">
        <div>
          <span className="eyebrow">AI-Powered Investment Intelligence</span>
          <h1>
            Six AI managers analyzing crypto markets and managing portfolios in real time.
          </h1>
          <p>
            Conviction Atlas runs autonomous investment managers that ingest market data,
            compute signals, make decisions, and publish their reasoning — all visible
            through a single interface.
          </p>
          <div className="landing-cta-row">
            <Link href="/managers" className="btn btn-primary">
              View Managers
            </Link>
            <Link href="/opportunities" className="btn">
              Browse Markets
            </Link>
          </div>
        </div>

        <div className="landing-chart-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span className="eyebrow">Live Performance</span>
            <span className="badge badge-neutral">6 managers</span>
          </div>
          <HeroPerformanceChart />
        </div>
      </section>

      {/* Stats row */}
      <div className="landing-stats">
        {stats.map((s) => (
          <div key={s.label} className="landing-stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ margin: '6px 0' }}>{s.value}</div>
            <div className="text-sm muted">{s.detail}</div>
          </div>
        ))}
      </div>

      {/* Feature grid */}
      <section className="section">
        <div className="section-header">
          <h2>Explore</h2>
          <span className="muted">Three views into the same data.</span>
        </div>

        <div className="feature-grid">
          {features.map((f) => (
            <Link key={f.href} href={f.href} className="feature-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="eyebrow">{f.eyebrow}</div>
                  <h3 style={{ marginTop: 6 }}>{f.title}</h3>
                </div>
                <span className="feature-index">{f.index}</span>
              </div>
              <p>{f.description}</p>
              <div className="feature-meta">
                <span>{f.meta}</span>
                <span style={{ color: 'var(--accent)' }}>Open &rarr;</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
