import Link from 'next/link';
import { HeroPerformanceChart } from '../components/hero-performance-chart';
import { ManagerCount } from '../components/manager-count';

const stats = [
  { label: 'AI 经理', value: '__MANAGER_COUNT__', detail: '不同的投资风格、风险偏好与评分引擎' },
  { label: '覆盖市场', value: '3', detail: 'A股 · 美股 · 加密市场' },
  { label: '追踪资产', value: '1500+', detail: '美股大中盘 + A股全市场 + 主流加密资产' },
];

const features = [
  {
    href: '/managers',
    index: '01',
    eyebrow: '组合',
    title: 'AI 基金经理组合',
    description: '专业 AI 经理团队，含实时组合、业绩曲线与投资备忘录。',
    meta: '净值 · 业绩 · 持仓',
  },
  {
    href: '/opportunities',
    index: '02',
    eyebrow: '市场',
    title: '市场机会',
    description: '所有追踪标的，含信号评分、价格走势与经理观点。',
    meta: '股票 · 加密资产',
  },
  {
    href: '/leaderboard',
    index: '03',
    eyebrow: '排行',
    title: '业绩排行',
    description: '按净值、夏普比率、命中率比较经理。查看哪些标的评分最强。',
    meta: '夏普 · 收益 · 评分',
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
            AI 基金经理实时分析全球市场并管理投资组合。
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
            <ManagerCount />
          </div>
          <HeroPerformanceChart />
        </div>
      </section>

      {/* Stats row */}
      <div className="landing-stats">
        {stats.map((s) => (
          <div key={s.label} className="landing-stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ margin: '6px 0' }}>
              {s.value === '__MANAGER_COUNT__' ? <ManagerCount valueOnly /> : s.value}
            </div>
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
