import Link from 'next/link';
import { HeroPerformanceChart } from '../components/hero-performance-chart';

const stats = [
  { label: 'AI 经理', value: '6', detail: '不同的投资风格、风险偏好与信念引擎' },
  { label: '数据源', value: '2+', detail: 'CoinGecko 加密价格 + Polymarket 预测市场' },
  { label: '追踪资产', value: '12+', detail: '按市值追踪的主流代币及活跃预测市场' },
];

const features = [
  {
    href: '/managers',
    index: '01',
    eyebrow: '组合',
    title: 'AI 基金经理组合',
    description: '六个专业 AI 经理，含实时组合、业绩曲线与投资备忘录。',
    meta: '净值 · 业绩 · 持仓',
  },
  {
    href: '/opportunities',
    index: '02',
    eyebrow: '市场',
    title: '市场机会',
    description: '所有追踪标的，含信号评分、价格走势与经理观点。',
    meta: '代币 · 预测市场',
  },
  {
    href: '/leaderboard',
    index: '03',
    eyebrow: '排行',
    title: '业绩排行',
    description: '按净值、夏普比率、命中率比较经理。查看哪些标的信念最强。',
    meta: '夏普 · 收益 · 信念',
  },
];

export default function Index() {
  return (
    <div>
      {/* Hero */}
      <section className="landing-hero">
        <div>
          <span className="eyebrow">AI 驱动的投资智能平台</span>
          <h1>
            六个 AI 基金经理实时分析加密市场并管理投资组合。
          </h1>
          <p>
            Conviction Atlas 运行自主投资经理，采集市场数据、计算信号、做出决策并发布推理过程 — 全部通过一个界面呈现。
          </p>
          <div className="landing-cta-row">
            <Link href="/managers" className="btn btn-primary">
              查看经理
            </Link>
            <Link href="/opportunities" className="btn">
              浏览市场
            </Link>
          </div>
        </div>

        <div className="landing-chart-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span className="eyebrow">实时业绩</span>
            <span className="badge badge-neutral">6 经理</span>
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
          <h2>探索</h2>
          <span className="muted">同一数据的三种视角。</span>
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
                <span style={{ color: 'var(--accent)' }}>查看 &rarr;</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
