import Link from "next/link";
import HeroPerformanceChart from "../components/hero-performance-chart";
import { API_DOCS_URL } from "../lib/runtime-config";

const landingStats = [
  {
    label: "AI Managers",
    value: "6",
    detail: "Each with a distinct investment style, risk profile, and conviction engine.",
  },
  {
    label: "Data Sources",
    value: "2+",
    detail: "Live crypto prices from CoinGecko and prediction markets from Polymarket.",
  },
  {
    label: "Assets Tracked",
    value: "12+",
    detail: "Top tokens by market cap plus active crypto prediction markets.",
  },
];

const landingInfoCards = [
  ...landingStats,
  {
    label: "Signals",
    title: "11 quantitative signals per asset",
    detail:
      "Momentum, trend, volume, news sentiment, catalyst proximity, and more.",
  },
  {
    label: "Transparency",
    title: "Full portfolio visibility",
    detail:
      "See every position, weight, conviction score, and rebalance in real time.",
  },
];

const landingSurfaces = [
  {
    href: "/managers",
    index: "01",
    title: "AI Manager Portfolios",
    description:
      "Six specialized AI managers with live portfolios, performance curves, and investment memos.",
    eyebrow: "Portfolios",
    meta: "NAV · Performance · Positions",
  },
  {
    href: "/opportunities",
    index: "02",
    title: "Market Opportunities",
    description:
      "All tracked assets with signal scores, price action, and which managers are bullish or bearish.",
    eyebrow: "Markets",
    meta: "Tokens · Prediction Markets",
  },
  {
    href: "/leaderboard",
    index: "03",
    title: "Performance Rankings",
    description:
      "Compare managers by NAV, Sharpe ratio, and hit rate. See which opportunities carry the most conviction.",
    eyebrow: "Rankings",
    meta: "Sharpe · Returns · Conviction",
  },
];

export default function Index() {
  return (
    <div className="page-stack landing-page">
      <section className="hero landing-hero">
        <div className="landing-copy-column">
          <div className="tag-row">
            <span className="hero-kicker">AI-Powered Investment Intelligence</span>
            <span className="chip">Crypto tokens and prediction markets</span>
          </div>

          <div className="landing-copy-block">
            <h1 className="detail-headline landing-headline">
              Six AI managers analyzing crypto markets and managing portfolios in real
              time.
            </h1>
            <p className="detail-copy landing-copy-lead">
              Conviction Atlas runs autonomous investment managers that ingest market data,
              compute signals, make decisions, and publish their reasoning — all visible
              through a single interface.
            </p>
          </div>

          <div className="cta-row">
            <Link href="/managers" className="button-link primary">
              View managers
            </Link>
            <Link href="/opportunities" className="button-link">
              Browse markets
            </Link>
            <a
              href={API_DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className="button-link"
            >
              API docs
            </a>
          </div>
        </div>

        <div className="landing-scene-panel">
          <div className="mini-metrics">
            <span className="eyebrow">Live performance</span>
            <span className="chip">6 managers · 90d backtest</span>
          </div>

          <div className="landing-chart-frame">
            <HeroPerformanceChart />
          </div>
        </div>

        <div className="landing-hero-info-grid">
          {landingInfoCards.map((item) => (
            <div key={item.label} className="panel landing-info-card">
              <div className="eyebrow">{item.label}</div>
              {"value" in item ? (
                <div className="stat-value">{item.value}</div>
              ) : (
                <strong className="landing-info-title">{item.title}</strong>
              )}
              <p className="muted">{item.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-header">
          <h2 className="section-title">Explore</h2>
          <span className="muted">
            Three views into the same data — managers, markets, and rankings.
          </span>
        </div>

        <div className="landing-feature-grid">
          {landingSurfaces.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="panel landing-feature-card"
            >
              <div className="landing-feature-top">
                <div>
                  <div className="eyebrow">{item.eyebrow}</div>
                  <h3>{item.title}</h3>
                </div>
                <span className="landing-feature-index">{item.index}</span>
              </div>
              <p className="detail-copy">{item.description}</p>
              <div className="landing-feature-meta">
                <span>{item.meta}</span>
                <span className="landing-feature-arrow">Open</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
