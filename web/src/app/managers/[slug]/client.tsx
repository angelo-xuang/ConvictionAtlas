'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PerfLine } from '../../../components/Chart';
import {
  fetchPageData,
  formatMoney,
  formatReturn,
  formatPercent,
  formatDateTime,
  formatDirection,
  getSignedClass,
  getDirectionClass,
} from '../../../lib/api';
import type {
  ManagerDetail,
  ManagerRebalance,
  ManagerReviewsResponse,
  Memo,
  PortfolioSnapshot,
} from '../../../lib/types';

// 股票类标的(US.AMD / SH.600519 等)没有 crypto 机会详情页, 渲染为纯文本不给链接
function hasOpportunityPage(slug?: string): boolean {
  return !!slug && !/^(US|SH|SZ|BJ|HK)\./i.test(slug);
}

function renderMarkdown(md: string): string {
  if (!md) return '';
  let html = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h4 style="font-size:0.85rem;font-weight:600;margin:10px 0 4px;color:var(--text)">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="font-size:0.9rem;font-weight:700;margin:12px 0 6px;color:var(--text)">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 style="font-size:0.95rem;font-weight:700;margin:14px 0 6px;color:var(--text)">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li style="margin:3px 0;padding-left:4px;font-size:0.82rem;line-height:1.6">$1</li>')
    .replace(/(<li[^>]*>.*?<\/li>\n?)+/g, (m) => '<ul style="padding-left:16px;margin:4px 0">' + m + '</ul>')
    .replace(/\n{2,}/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
  return html;
}

type Props = { slug: string };

export default function ManagerDetailClient({ slug }: Props) {
  const [manager, setManager] = useState<ManagerDetail | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [rebalances, setRebalances] = useState<ManagerRebalance[]>([]);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [reviews, setReviews] = useState<ManagerReviewsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    Promise.all([
      fetchPageData<ManagerDetail>(`/managers/${slug}`),
      fetchPageData<PortfolioSnapshot>(`/managers/${slug}/portfolio`),
      fetchPageData<ManagerRebalance[]>(`/managers/${slug}/rebalances`),
      fetchPageData<Memo[]>(`/managers/${slug}/memos`),
      fetchPageData<ManagerReviewsResponse>(`/managers/${slug}/reviews`),
    ])
      .then(([mgr, pf, rb, mm, rv]) => {
        setManager(mgr ?? null);
        setPortfolio(pf ?? null);
        setRebalances(rb ?? []);
        setMemos(mm ?? []);
        setReviews(rv ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="shell">
        <div style={{ padding: '120px 0', textAlign: 'center' }}>
          <div className="stat-value" style={{ color: 'var(--text-muted)' }}>加载中...</div>
        </div>
      </div>
    );
  }

  if (!manager) {
    return (
      <div className="shell">
        <div className="error-card mt-6">
          经理详情暂不可用，请确认 API 正在运行且管道已生成快照。
        </div>
      </div>
    );
  }

  const livePortfolio = portfolio ?? manager.latestPortfolio;
  const dp = manager.derivedPerformance;
  const reviewState = reviews ?? {
    averageRating: manager.ratingAverage,
    total: manager.reviews.length,
    reviews: manager.reviews,
  };

  const navPoints = manager.performanceSeries.map((p) => p.nav);
  const dateLabels = manager.performanceSeries.map((p) =>
    String(p.pointAt).slice(0, 10),
  );

  // 年化收益/年化波动:从净值序列推算(252 交易日年化),不足 2 个点时不显示
  const navClean = navPoints.filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0,
  );
  let annReturn: number | null = null;
  let annVol: number | null = null;
  if (navClean.length >= 2) {
    const n = navClean.length - 1;
    annReturn = Math.pow(navClean[n] / navClean[0], 252 / n) - 1;
    const rets: number[] = [];
    for (let i = 1; i < navClean.length; i++) rets.push(navClean[i] / navClean[i - 1] - 1);
    const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
    const variance =
      rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(rets.length - 1, 1);
    annVol = Math.sqrt(variance) * Math.sqrt(252);
  }

  // 逐年统计:收益 = 年末净值/上年末净值 - 1(首年以序列首点为基,末年为 YTD);
  // 波动 = 年内日收益 std × √252;Sharpe = 年内日收益均值 × 252 / 波动;回撤 = 年内最大回撤
  const yearlyStats: {
    year: string;
    ret: number;
    sharpe: number | null;
    vol: number | null;
    mdd: number;
  }[] = [];
  {
    const series = manager.performanceSeries
      .map((p) => ({ d: String(p.pointAt).slice(0, 10), nav: p.nav }))
      .filter((p) => Number.isFinite(p.nav) && p.nav > 0);
    const navsByYear = new Map<string, number[]>();
    for (const p of series) {
      const y = p.d.slice(0, 4);
      if (!navsByYear.has(y)) navsByYear.set(y, []);
      navsByYear.get(y)!.push(p.nav);
    }
    let prevEnd = series.length ? series[0].nav : null;
    for (const y of [...navsByYear.keys()].sort()) {
      const navs = navsByYear.get(y)!;
      const end = navs[navs.length - 1];
      if (prevEnd == null || prevEnd <= 0) {
        prevEnd = end;
        continue;
      }
      // 年内路径以上年末净值为起点,保证跨年缺口计入首日收益与回撤
      const path = [prevEnd, ...navs];
      const rets: number[] = [];
      for (let i = 1; i < path.length; i++) rets.push(path[i] / path[i - 1] - 1);
      let vol: number | null = null;
      let sharpe: number | null = null;
      if (rets.length >= 2) {
        const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
        const variance =
          rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
        const v = Math.sqrt(variance) * Math.sqrt(252);
        if (v > 0) {
          vol = v;
          sharpe = (mean * 252) / v;
        }
      }
      let peak = path[0];
      let mdd = 0;
      for (const nav of path) {
        if (nav > peak) peak = nav;
        mdd = Math.min(mdd, nav / peak - 1);
      }
      yearlyStats.push({ year: y, ret: end / prevEnd - 1, sharpe, vol, mdd });
      prevEnd = end;
    }
  }
  const recentYears = yearlyStats.slice(-6).reverse();
  const lastSeriesYear = dateLabels.length
    ? dateLabels[dateLabels.length - 1].slice(0, 4)
    : null;
  const perfTone: 'positive' | 'negative' | 'neutral' =
    dp.cumulativeReturn > 0 ? 'positive'
      : dp.cumulativeReturn < 0 ? 'negative'
        : 'neutral';
  const sharpeValue =
    annReturn != null && annVol != null && annVol > 0
      ? annReturn / annVol
      : dp.sharpe;
  const positions = livePortfolio?.positions ?? [];
  const maxAbsPositionWeight = Math.max(
    ...positions.map((pos) => Math.abs(pos.weight)),
    1e-4,
  );
  const lastUpdated =
    livePortfolio?.computedAt ?? manager.latestPerformance?.computedAt ?? manager.updatedAt;

  return (
    <div className="shell">
      <section className="manager-hero">
        <div className="breadcrumb manager-hero-breadcrumb">
          <Link href="/">首页</Link>
          <span>/</span>
          <Link href="/managers">基金经理</Link>
          <span>/</span>
          <span style={{ color: 'var(--text)' }}>{manager.name}</span>
        </div>

        <div className="manager-hero-grid">
          <div className="manager-identity">
            <div className="manager-initial">{manager.name.charAt(0)}</div>
            <div className="manager-copy">
              <div className="manager-kicker">经理档案</div>
              <h1>{manager.name}</h1>
              <div className="detail-tags">
                <span className="badge badge-accent">{manager.style}</span>
                <span className="badge badge-warning">{manager.riskProfile}</span>
                <span className="badge badge-neutral">{manager.rebalanceCadence}</span>
                {manager.universe && <span className="badge badge-neutral">{manager.universe}</span>}
              </div>
              <p className="manager-lede">{manager.description}</p>
              <div
                style={{
                  marginTop: 12,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '12px 28px',
                  padding: '10px 14px',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                }}
              >
                <div>
                  <span className="stat-label">NAV</span>
                  <strong className="tabular" style={{ display: 'block', fontSize: '1.05rem' }}>
                    {formatMoney(dp.nav, manager.baseCcy)}
                  </strong>
                </div>
                <div>
                  <span className="stat-label">累计收益</span>
                  <strong
                    className={`tabular ${getSignedClass(dp.cumulativeReturn)}`}
                    style={{ display: 'block', fontSize: '1.05rem' }}
                  >
                    {formatReturn(dp.cumulativeReturn)}
                  </strong>
                </div>
                <div>
                  <span className="stat-label">年化收益</span>
                  <strong
                    className={`tabular ${annReturn != null ? getSignedClass(annReturn) : ''}`}
                    style={{ display: 'block', fontSize: '1.05rem' }}
                  >
                    {annReturn != null ? formatReturn(annReturn) : '—'}
                  </strong>
                </div>
                <div>
                  <span className="stat-label">Sharpe</span>
                  <strong className="tabular" style={{ display: 'block', fontSize: '1.05rem' }}>
                    {sharpeValue.toFixed(2)}
                  </strong>
                </div>
                <div>
                  <span className="stat-label">年化波动</span>
                  <strong className="tabular" style={{ display: 'block', fontSize: '1.05rem' }}>
                    {annVol != null ? formatPercent(annVol * 100) : '—'}
                  </strong>
                </div>
                <div>
                  <span className="stat-label">回撤</span>
                  <strong className="tabular" style={{ display: 'block', fontSize: '1.05rem' }}>
                    {formatReturn(dp.drawdown)}
                  </strong>
                </div>
              </div>
            </div>
          </div>

          <div className="manager-scoreboard">
            <div className="scoreboard-primary" style={{ paddingBottom: 8 }}>
              <span className="stat-label">逐年表现</span>
              {recentYears.length > 0 ? (
                <table style={{ width: '100%', marginTop: 6, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['年份', '收益', 'Sharpe', '波动', '回撤'].map((h, i) => (
                        <th
                          key={h}
                          className="muted"
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: 500,
                            padding: '2px 0',
                            textAlign: i === 0 ? 'left' : 'right',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {recentYears.map(({ year, ret, sharpe, vol, mdd }) => (
                      <tr key={year} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td className="muted tabular" style={{ fontSize: '0.78rem', padding: '4px 0' }}>
                          {year}
                          {year === lastSeriesYear ? ' YTD' : ''}
                        </td>
                        <td
                          className={`tabular ${getSignedClass(ret)}`}
                          style={{ fontSize: '0.78rem', padding: '4px 0', textAlign: 'right', fontWeight: 600 }}
                        >
                          {formatReturn(ret)}
                        </td>
                        <td className="tabular" style={{ fontSize: '0.78rem', padding: '4px 0 4px 10px', textAlign: 'right' }}>
                          {sharpe != null ? sharpe.toFixed(2) : '—'}
                        </td>
                        <td className="tabular" style={{ fontSize: '0.78rem', padding: '4px 0 4px 10px', textAlign: 'right' }}>
                          {vol != null ? formatPercent(vol * 100) : '—'}
                        </td>
                        <td className="tabular" style={{ fontSize: '0.78rem', padding: '4px 0 4px 10px', textAlign: 'right' }}>
                          {formatReturn(mdd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <span className="muted text-xs">数据不足</span>
              )}
            </div>
          </div>
        </div>

        <div className="manager-meta-strip">
          <div>
            <span className="stat-label">命中率</span>
            <strong className="tabular">{formatPercent(dp.hitRate * 100)}</strong>
          </div>
          <div>
            <span className="stat-label">持仓数</span>
            <strong className="tabular">{positions.length}</strong>
          </div>
          <div>
            <span className="stat-label">总敞口</span>
            <strong className="tabular">
              {formatPercent((livePortfolio?.grossExposure ?? 0) * 100)}
            </strong>
          </div>
          <div>
            <span className="stat-label">更新时间</span>
            <strong className="tabular">{formatDateTime(lastUpdated)}</strong>
          </div>
        </div>
      </section>

      {/* ── Two-column layout ── */}
      <div className="detail-layout">
        {/* ── Main column ── */}
        <div className="detail-main">
          {/* Performance chart */}
          <div className="perf-card performance-card">
            <div className="card-header">
              <div>
                <h2>业绩曲线</h2>
                <span className="muted text-xs">净值曲线</span>
              </div>
              <span className="muted text-xs">
                {dp.lookbackDays ? `${dp.lookbackDays.toFixed(0)}天回溯` : '回测'}
              </span>
            </div>
            <div>
              <div className="performance-chart-panel">
                <div className="chart-area">
                  <PerfLine
                    points={navPoints}
                    dateLabels={dateLabels}
                    height={300}
                    tone={perfTone}
                    showArea
                  />
                </div>
                <div className="flex justify-between mt-2 text-xs muted">
                  {manager.performanceSeries[0] && (
                    <span>{formatDateTime(manager.performanceSeries[0].pointAt)}</span>
                  )}
                  {manager.performanceSeries[manager.performanceSeries.length - 1] && (
                    <span>{formatDateTime(manager.performanceSeries[manager.performanceSeries.length - 1].pointAt)}</span>
                  )}
                </div>
              </div>

            </div>
          </div>

          {/* Current decisions */}
          <div className="card">
            <div className="card-header">
              <h2>当前决策</h2>
              <span className="muted text-xs">按评分排序的模型输出</span>
            </div>
            {manager.latestDecisions.length > 0 ? (
              <div className="table-wrap decision-table-wrap">
                <table className="compact-table">
                  <thead>
                    <tr>
                      <th>标的</th>
                      <th>方向</th>
                      <th style={{ textAlign: 'right' }}>现价</th>
                      <th style={{ textAlign: 'right' }}>24h</th>
                      <th style={{ textAlign: 'right' }}>评分</th>
                    </tr>
                  </thead>
                  <tbody>
                    {manager.latestDecisions.map((d) => (
                      <tr key={d.id}>
                        <td>
                          {hasOpportunityPage(d.opportunity.slug) ? (
                            <Link
                              href={`/opportunities/detail?slug=${d.opportunity.slug}`}
                              className="table-link"
                            >
                              {d.opportunity.title}
                            </Link>
                          ) : (
                            <span className="table-link" style={{ cursor: 'default' }}>
                              {d.opportunity.title}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${getDirectionClass(d.direction)}`}>
                            {formatDirection(d.direction)}
                          </span>
                        </td>
                        <td className="tabular" style={{ textAlign: 'right' }}>
                          {d.opportunity.currentPrice != null
                            ? formatMoney(d.opportunity.currentPrice, manager.baseCcy)
                            : '—'}
                        </td>
                        <td className="tabular" style={{ textAlign: 'right' }}>
                          {d.opportunity.priceChange24h != null ? (
                            <span className={getSignedClass(d.opportunity.priceChange24h)}>
                              {formatPercent(d.opportunity.priceChange24h)}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="tabular muted" style={{ textAlign: 'right' }}>
                          {Number.isFinite(d.convictionScore) ? d.convictionScore.toFixed(3) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="muted text-sm">暂无活跃决策。</div>
            )}
          </div>

          {/* Memos */}
          <div className="card">
            <div className="card-header">
              <h2>研究备忘录</h2>
              <span className="muted text-xs">基于当前实时组合生成</span>
            </div>
            {memos.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {memos.map((memo) => (
                  <div key={memo.id} className="memo-card">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="badge badge-accent">{memo.generatedBy}</span>
                      <span className="badge badge-neutral">{memo.accessTier}</span>
                    </div>
                    <h3 style={{ fontSize: '0.92rem', marginBottom: 4 }}>{memo.title}</h3>
                    <p className="muted text-sm">{memo.summary}</p>
                    <div className="flex items-center justify-between mt-2 text-xs muted">
                      <span>{formatDateTime(memo.createdAt)}</span>
                      {memo.opportunity && hasOpportunityPage(memo.opportunity.slug) ? (
                        <Link href={`/opportunities/detail?slug=${memo.opportunity.slug}`}>
                          {memo.opportunity.title}
                        </Link>
                      ) : memo.opportunity ? (
                        <span>{memo.opportunity.title}</span>
                      ) : (
                        <span>无关联标的</span>
                      )}
                    </div>
                    {memo.content && memo.content.trim() !== (memo.summary || '').trim() && (
                      <div
                        className="memo-content"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(memo.content) }}
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted text-sm">尚未生成备忘录。</div>
            )}
          </div>
        </div>

        {/* ── Sidebar ── */}
        <div className="detail-sidebar">
          <div className="card portfolio-card">
            <div className="card-header">
              <div>
                <h2>投资组合</h2>
                <span className="muted text-xs">{positions.length} 个持仓</span>
              </div>
              <span className="badge badge-neutral">实时</span>
            </div>
            <div className="portfolio-summary-grid">
              <div>
                <span className="stat-label">总敞口</span>
                <strong className="tabular">
                  {formatPercent((livePortfolio?.grossExposure ?? 0) * 100)}
                </strong>
              </div>
              <div>
                <span className="stat-label">现金</span>
                <strong className="tabular">
                  {formatPercent((livePortfolio?.cashWeight ?? 0) * 100)}
                </strong>
              </div>
              <div>
                <span className="stat-label">风险</span>
                <strong className="tabular">{(livePortfolio?.riskScore ?? 0).toFixed(2)}</strong>
              </div>
              <div>
                <span className="stat-label">评分</span>
                <strong className="tabular">{reviewState.averageRating?.toFixed(2) ?? '--'}</strong>
              </div>
            </div>

            {positions.length ? (
              <div className="positions-list portfolio-list">
                {positions.map((pos) => {
                  const isShort = pos.weight < 0;
                  const barWidth = Math.max((Math.abs(pos.weight) / maxAbsPositionWeight) * 100, 3);
                  return (
                    <div key={pos.id} className="position-row portfolio-row">
                      <div className={`position-side ${isShort ? 'is-short' : 'is-long'}`} />
                      <div className="position-main">
                        {hasOpportunityPage(pos.opportunity.slug) ? (
                          <Link
                            href={`/opportunities/detail?slug=${pos.opportunity.slug}`}
                            className="position-symbol"
                          >
                            {pos.opportunity.title}
                          </Link>
                        ) : (
                          <span className="position-symbol" style={{ cursor: 'default' }}>
                            {pos.opportunity.title}
                          </span>
                        )}
                        <span className="muted text-xs tabular">
                          评分 {Number.isFinite(pos.convictionScore) ? pos.convictionScore.toFixed(3) : '--'}
                        </span>
                      </div>
                      <div className="position-numbers">
                        <strong className="tabular">{formatPercent(pos.weight * 100)}</strong>
                        {pos.opportunity.priceChange24h != null && (
                          <span className={`text-xs tabular ${getSignedClass(pos.opportunity.priceChange24h)}`}>
                            {formatPercent(pos.opportunity.priceChange24h)}
                          </span>
                        )}
                      </div>
                      <div className="weight-bar">
                        <div
                          className={`weight-bar-fill ${isShort ? 'is-short' : 'is-long'}`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="muted text-sm">暂无持仓。</div>
            )}
          </div>

          {/* Signal architecture */}
          <div className="card">
            <div className="card-header">
              <h2>信号架构与评分逻辑</h2>
            </div>
            <div className="signal-list">
              {manager.signalMix.map((sig, i) => (
                <div key={i} className="signal-item">
                  <span style={{ width: 100, fontSize: '0.78rem', flexShrink: 0 }}>{sig.name}</span>
                  <div className="signal-bar">
                    <div
                      className="signal-bar-fill"
                      style={{
                        width: `${Math.min(sig.weight * 100, 100)}%`,
                        background: `var(--accent)`,
                      }}
                    />
                  </div>
                  <span className="tabular text-xs" style={{ width: 36, textAlign: 'right' }}>
                    {(sig.weight * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
            {manager.blueprint && (
              <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--surface)', borderRadius: 6, fontSize: '0.78rem', lineHeight: 1.6, color: 'var(--text-muted)' }}>
                <strong style={{ color: 'var(--text)' }}>持仓逻辑</strong>
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {manager.blueprint.playbook?.length ? (
                    <>
                      {manager.blueprint.playbook.map((row, i) => (
                        <div key={i}>
                          <span style={{ color: 'var(--text)' }}>{row.label}：</span>
                          {row.value}
                        </div>
                      ))}
                    </>
                  ) : manager.blueprint.strategyType === 'cta' ? (
                    <>
                      <div>
                        <span style={{ color: 'var(--text)' }}>趋势过滤：</span>
                        ADX &gt; {manager.blueprint.ctaParams?.adxThreshold ?? 20} 才交易，否则空仓等待
                      </div>
                      <div>
                        <span style={{ color: 'var(--text)' }}>方向确认：</span>
                        均线多头排列 (MA7 &gt; MA25 &gt; MA99) + 动量 &gt; 0 → 做多
                      </div>
                      <div>
                        <span style={{ color: 'var(--text)' }}>仓位计算：</span>
                        风险平价 (单标的最大风险 {(manager.blueprint.ctaParams?.maxRiskPerPosition ?? 0.02) * 100}% / ATR)
                      </div>
                      <div>
                        <span style={{ color: 'var(--text)' }}>仓位约束：</span>
                        最多 {manager.blueprint.maxPositions} 个持仓，最低 {(manager.blueprint.cashFloor * 100).toFixed(0)}% 现金
                      </div>
                      <div style={{ marginTop: 4, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
                        纯量价系统：不看新闻、不听故事，只根据 K 线趋势强度、动量方向和波动率做决策。
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <span style={{ color: 'var(--text)' }}>偏好标的：</span>
                        {Object.entries(manager.blueprint.opportunityTypeBias).map(([type, bias]) => {
                          const label = type === 'TOKEN' ? '代币' : type === 'PREDICTION_MARKET' ? '预测市场' : type;
                          const biasVal = Number(bias);
                          return (
                            <span key={type} style={{ marginLeft: 8 }}>
                              <span style={{ color: biasVal >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
                                {label} {biasVal >= 0 ? '+' : ''}{(biasVal * 100).toFixed(0)}%
                              </span>
                            </span>
                          );
                        })}
                      </div>
                      <div>
                        <span style={{ color: 'var(--text)' }}>建仓门槛：</span>
                        评分 &gt; {(manager.blueprint.bullishThreshold * 100).toFixed(0)}% 纳入，&lt; {(manager.blueprint.bearishThreshold * 100).toFixed(0)}% 剔除
                      </div>
                      <div>
                        <span style={{ color: 'var(--text)' }}>仓位约束：</span>
                        最多 {manager.blueprint.maxPositions} 个持仓，最低 {(manager.blueprint.cashFloor * 100).toFixed(0)}% 现金
                      </div>
                      <div style={{ marginTop: 4, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
                        评分 = 加权信号值之和 + 标的类型偏好，范围 [-1, +1]。按评分比例分配权重。
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Rebalance history */}
          <div className="card">
            <div className="card-header">
              <h2>再平衡历史</h2>
              <span className="muted text-xs">近期变动</span>
            </div>
            {rebalances.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rebalances.slice(0, 8).map((rb) => (
                  <div key={rb.opportunityId} className="position-row" style={{ padding: '6px 10px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="truncate" style={{ fontWeight: 600, fontSize: '0.82rem' }}>
                        {rb.opportunityTitle}
                      </div>
                      <span className="muted text-xs">
                        {rb.delta > 0 ? '加仓' : rb.delta < 0 ? '减仓' : '无变动'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs tabular">
                      <span className="muted">{formatPercent(rb.previousWeight * 100)}</span>
                      <span className={getSignedClass(rb.delta)} style={{ fontWeight: 600 }}>
                        {rb.delta > 0 ? '+' : ''}{formatPercent(rb.delta * 100)}
                      </span>
                      <span>{formatPercent(rb.currentWeight * 100)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted text-sm">目前仅有一个快照。</div>
            )}
          </div>

          {/* Reviews */}
          <div className="card">
            <div className="card-header">
              <h2>评价</h2>
              <span className="muted text-xs">{reviewState.total} 条</span>
            </div>
            {reviewState.reviews.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {reviewState.reviews.map((rv) => (
                  <div key={rv.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{rv.authorName}</span>
                      <span className="text-xs muted">{formatDateTime(rv.createdAt)}</span>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="badge badge-accent">评分 {rv.rating}/5</span>
                    </div>
                    {rv.comment && <p className="muted text-sm">{rv.comment}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted text-sm">暂无评价。</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
