'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PerfLine, MiniLine, BarChart } from '../../../components/Chart';
import {
  fetchPageData,
  formatMoney,
  formatReturn,
  formatPercent,
  formatDateTime,
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

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
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
          <div className="stat-value" style={{ color: 'var(--text-muted)' }}>Loading...</div>
        </div>
      </div>
    );
  }

  if (!manager) {
    return (
      <div className="shell">
        <div className="error-card mt-6">
          Manager detail is not available. Confirm the API is running and the pipeline has produced snapshots.
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
  const dateLabels = manager.performanceSeries.map((p) => formatShortDate(p.pointAt));
  const perfTone: 'positive' | 'negative' | 'neutral' =
    dp.cumulativeReturn > 0 ? 'positive'
      : dp.cumulativeReturn < 0 ? 'negative'
        : 'neutral';

  return (
    <div className="shell">
      {/* ── Header ── */}
      <div className="page-header" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div className="breadcrumb">
          <Link href="/">Home</Link>
          <span>/</span>
          <Link href="/managers">Managers</Link>
          <span>/</span>
          <span style={{ color: 'var(--text)' }}>{manager.name}</span>
        </div>

        <div className="flex items-center gap-4 mb-2">
          <div className="avatar avatar-lg">{manager.name.charAt(0)}</div>
          <div>
            <h1 style={{ marginBottom: 4 }}>{manager.name}</h1>
            <div className="detail-tags">
              <span className="badge badge-accent">{manager.style}</span>
              <span className="badge badge-warning">{manager.riskProfile}</span>
              <span className="badge badge-neutral">{manager.rebalanceCadence}</span>
              {manager.universe && <span className="badge badge-neutral">{manager.universe}</span>}
            </div>
          </div>
        </div>

        <p className="muted" style={{ marginTop: 8, maxWidth: 640 }}>
          {manager.description}
        </p>

        {/* Quick stats row */}
        <div className="stat-grid mt-4" style={{ maxWidth: 720 }}>
          <div className="stat-item">
            <span className="stat-label">NAV</span>
            <span className="stat-value tabular">{formatMoney(dp.nav)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Cum. Return</span>
            <span className={`stat-value tabular ${getSignedClass(dp.cumulativeReturn)}`}>
              {formatReturn(dp.cumulativeReturn)}
            </span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Drawdown</span>
            <span className="stat-value tabular">{formatReturn(dp.drawdown)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Sharpe</span>
            <span className="stat-value tabular">{dp.sharpe.toFixed(2)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Hit Rate</span>
            <span className="stat-value tabular">{formatPercent(dp.hitRate * 100)}</span>
          </div>
        </div>
      </div>

      {/* ── Two-column layout ── */}
      <div className="detail-layout">
        {/* ── Main column ── */}
        <div className="detail-main">
          {/* Performance chart */}
          <div className="perf-card">
            <div className="card-header">
              <h2 style={{ fontSize: '0.95rem' }}>Performance Curve</h2>
              <span className="muted text-xs">
                {dp.lookbackDays ? `${dp.lookbackDays.toFixed(0)}d lookback` : 'Backtest'}
              </span>
            </div>
            <div className="chart-area">
              <PerfLine
                points={navPoints}
                dateLabels={dateLabels}
                height={220}
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

          {/* Current decisions */}
          <div className="card">
            <div className="card-header">
              <h2 style={{ fontSize: '0.95rem' }}>Current Decisions</h2>
              <span className="muted text-xs">Top model outputs by conviction</span>
            </div>
            {manager.latestDecisions.length > 0 ? (
              <div className="decision-grid">
                {manager.latestDecisions.map((d) => (
                  <div key={d.id} className="decision-card">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`badge ${getDirectionClass(d.direction)}`}>
                        {d.direction}
                      </span>
                      <span className="text-xs tabular muted">
                        {formatPercent(d.targetWeight * 100)} weight
                      </span>
                    </div>
                    <Link href={`/opportunities/detail?slug=${d.opportunity.slug}`} style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                      {d.opportunity.title}
                    </Link>
                    <div className="flex items-center justify-between mt-2 text-xs">
                      <span className="muted">
                        Conviction {d.convictionScore.toFixed(3)}
                      </span>
                      {d.opportunity.currentPrice != null && (
                        <span className="tabular">{formatMoney(d.opportunity.currentPrice)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted text-sm">No active decisions.</div>
            )}
          </div>

          {/* Memos */}
          <div className="card">
            <div className="card-header">
              <h2 style={{ fontSize: '0.95rem' }}>Research Memos</h2>
              <span className="muted text-xs">Generated from current live portfolio</span>
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
                      {memo.opportunity ? (
                        <Link href={`/opportunities/detail?slug=${memo.opportunity.slug}`}>
                          {memo.opportunity.title}
                        </Link>
                      ) : (
                        <span>No linked opportunity</span>
                      )}
                    </div>
                    {memo.content && (
                      <div
                        className="memo-content"
                        dangerouslySetInnerHTML={{ __html: memo.content }}
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted text-sm">No memos generated yet.</div>
            )}
          </div>
        </div>

        {/* ── Sidebar ── */}
        <div className="detail-sidebar">
          {/* Portfolio stats */}
          <div className="card">
            <div className="card-header">
              <h2 style={{ fontSize: '0.95rem' }}>Portfolio Stats</h2>
              <span className="muted text-xs">{livePortfolio?.positions?.length ?? 0} positions</span>
            </div>
            <div className="stat-grid">
              <div className="stat-item">
                <span className="stat-label">Gross</span>
                <span className="stat-value" style={{ fontSize: '1.1rem' }}>
                  {formatPercent((livePortfolio?.grossExposure ?? 0) * 100)}
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Cash</span>
                <span className="stat-value" style={{ fontSize: '1.1rem' }}>
                  {formatPercent((livePortfolio?.cashWeight ?? 0) * 100)}
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Risk</span>
                <span className="stat-value" style={{ fontSize: '1.1rem' }}>
                  {(livePortfolio?.riskScore ?? 0).toFixed(2)}
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Rating</span>
                <span className="stat-value" style={{ fontSize: '1.1rem' }}>
                  {reviewState.averageRating?.toFixed(2) ?? '--'}
                </span>
              </div>
            </div>
          </div>

          {/* Positions list */}
          <div className="card">
            <div className="card-header">
              <h2 style={{ fontSize: '0.95rem' }}>Positions</h2>
            </div>
            {livePortfolio?.positions?.length ? (
              <div className="positions-list">
                {livePortfolio.positions.map((pos) => (
                  <div key={pos.id} className="position-row">
                    <div className="avatar avatar-sm">{pos.opportunity.title.charAt(0)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Link
                        href={`/opportunities/detail?slug=${pos.opportunity.slug}`}
                        className="truncate"
                        style={{ fontWeight: 600, fontSize: '0.82rem', display: 'block' }}
                      >
                        {pos.opportunity.title}
                      </Link>
                      <span className="muted text-xs">
                        Conviction {pos.convictionScore.toFixed(3)}
                      </span>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div className="tabular" style={{ fontWeight: 600, fontSize: '0.82rem' }}>
                        {formatPercent(pos.weight * 100)}
                      </div>
                      {pos.opportunity.priceChange24h != null && (
                        <div className={`text-xs tabular ${getSignedClass(pos.opportunity.priceChange24h)}`}>
                          {formatPercent(pos.opportunity.priceChange24h)}
                        </div>
                      )}
                    </div>
                    <div className="weight-bar" style={{ width: 48 }}>
                      <div
                        className="weight-bar-fill"
                        style={{ width: `${Math.min(pos.weight * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted text-sm">No positions.</div>
            )}
          </div>

          {/* Signal architecture */}
          <div className="card">
            <div className="card-header">
              <h2 style={{ fontSize: '0.95rem' }}>Signal Architecture</h2>
              <span className="muted text-xs">Model bias</span>
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
          </div>

          {/* Rebalance history */}
          <div className="card">
            <div className="card-header">
              <h2 style={{ fontSize: '0.95rem' }}>Rebalance History</h2>
              <span className="muted text-xs">Recent changes</span>
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
                        {rb.delta > 0 ? 'Added risk' : rb.delta < 0 ? 'Trimmed risk' : 'No change'}
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
              <div className="muted text-sm">Only one snapshot exists so far.</div>
            )}
          </div>

          {/* Reviews */}
          <div className="card">
            <div className="card-header">
              <h2 style={{ fontSize: '0.95rem' }}>Reviews</h2>
              <span className="muted text-xs">{reviewState.total} total</span>
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
                      <span className="badge badge-accent">Rating {rv.rating}/5</span>
                    </div>
                    {rv.comment && <p className="muted text-sm">{rv.comment}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted text-sm">No reviews yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
