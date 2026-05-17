'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MiniLine } from '../../components/Chart';
import {
  fetchPageData,
  formatMoney,
  formatReturn,
  formatPercent,
  getSignedClass,
  getDirectionClass,
} from '../../lib/api';
import type {
  ManagerSummary,
  ManagerLeaderboardEntry,
} from '../../lib/types';

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

export default function ManagersPage() {
  const [managers, setManagers] = useState<ManagerSummary[]>([]);
  const [leaderboard, setLeaderboard] = useState<ManagerLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([
      fetchPageData<ManagerSummary[]>('/managers'),
      fetchPageData<ManagerLeaderboardEntry[]>('/leaderboard/managers'),
    ])
      .then(([m, lb]) => {
        setManagers(m ?? []);
        setLeaderboard(lb ?? []);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="shell">
        <div style={{ padding: '120px 0', textAlign: 'center' }}>
          <div className="stat-value" style={{ color: 'var(--text-muted)' }}>加载中...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="shell">
        <div className="error-card mt-6">
          经理数据暂不可用，请启动 API、运行管道后刷新。
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      {/* Page header */}
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <Link href="/">首页</Link>
            <span>/</span>
            <span style={{ color: 'var(--text)' }}>基金经理</span>
          </div>
          <h1>AI 基金经理</h1>
          <p className="muted" style={{ marginTop: 6, maxWidth: 560 }}>
            六个自主交易台，各自读取实时代币行情和加密预测市场。每个交易台拥有独立的业绩曲线、持仓分布、信号偏好与包装风格。
          </p>
        </div>
        <Link href="/leaderboard" className="btn btn-primary">
          排行榜
        </Link>
      </div>

      {/* Manager grid */}
      {managers.length === 0 ? (
        <div className="error-card">
          暂无经理数据，请先运行管道。
        </div>
      ) : (
        <div className="manager-grid">
          {managers.map((mgr) => (
            <ManagerCard key={mgr.slug} manager={mgr} />
          ))}
        </div>
      )}

      {/* Leaderboard */}
      {leaderboard.length > 0 && (
        <div className="section">
          <div className="section-header">
            <h2>排行榜</h2>
            <Link href="/leaderboard" className="muted text-sm">完整排行 &rarr;</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>经理</th>
                  <th style={{ width: 140 }}>曲线</th>
                  <th>NAV</th>
                  <th>累计收益</th>
                  <th>总敞口</th>
                  <th>Sharpe</th>
                  <th>命中率</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((entry) => (
                  <tr key={entry.slug}>
                    <td>
                      <Link href={`/managers/${entry.slug}`} style={{ fontWeight: 600 }}>
                        {entry.name}
                      </Link>
                    </td>
                    <td>
                      <MiniLine
                        points={entry.performanceSeries.map((p) => p.nav)}
                        height={36}
                        tone={
                          entry.cumulativeReturn > 0 ? 'positive'
                            : entry.cumulativeReturn < 0 ? 'negative'
                              : 'neutral'
                        }
                      />
                    </td>
                    <td className="tabular">{formatMoney(entry.nav)}</td>
                    <td>
                      <span className={`${getSignedClass(entry.cumulativeReturn)} tabular`}>
                        {formatReturn(entry.cumulativeReturn)}
                      </span>
                    </td>
                    <td className="tabular">{formatPercent(entry.grossExposure * 100)}</td>
                    <td className="tabular">{entry.sharpe.toFixed(2)}</td>
                    <td className="tabular">{formatPercent(entry.hitRate * 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Manager card sub-component ─── */

function ManagerCard({ manager }: { manager: ManagerSummary }) {
  const navPoints = manager.performanceSeries.map((p) => p.nav);
  const tone: 'positive' | 'negative' | 'neutral' =
    manager.cumulativeReturn > 0 ? 'positive'
      : manager.cumulativeReturn < 0 ? 'negative'
        : 'neutral';

  const topPos = manager.topPositions.slice(0, 2);

  return (
    <Link href={`/managers/${manager.slug}`} className="manager-card" style={{ display: 'block' }}>
      {/* Header */}
      <div className="manager-card-header">
        <div
          className="avatar avatar-lg"
          style={{ background: `linear-gradient(135deg, var(--accent), #6366f1)` }}
        >
          {manager.name.charAt(0)}
        </div>
        <div className="info">
          <h3>{manager.name}</h3>
          <span className="badge badge-accent" style={{ marginTop: 4 }}>{manager.style}</span>
          <div style={{ marginTop: 6, fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {manager.description}
          </div>
        </div>
      </div>

      {/* Mini chart */}
      <div style={{ margin: '12px 0' }}>
        <MiniLine points={navPoints} height={72} tone={tone} />
      </div>

      {/* Metric tiles */}
      <div className="manager-card-metrics">
        <div className="metric-item">
          <div className="value tabular">{formatMoney(manager.latestNav)}</div>
          <div className="label">NAV</div>
        </div>
        <div className="metric-item">
          <div className={`value tabular ${getSignedClass(manager.cumulativeReturn)}`}>
            {formatReturn(manager.cumulativeReturn)}
          </div>
          <div className="label">累计收益</div>
        </div>
        <div className="metric-item">
          <div className="value tabular">{formatReturn(manager.drawdown)}</div>
          <div className="label">回撤</div>
        </div>
        <div className="metric-item">
          <div className="value tabular">{manager.sharpe.toFixed(2)}</div>
          <div className="label">Sharpe</div>
        </div>
      </div>

      {/* Top positions preview */}
      {topPos.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="stat-label" style={{ marginBottom: 6 }}>主要持仓</div>
          <div className="positions-list">
            {topPos.map((pos) => (
              <div key={pos.id} className="position-row">
                <div className="avatar avatar-sm">{pos.title.charAt(0)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="truncate" style={{ fontWeight: 600, fontSize: '0.82rem' }}>{pos.title}</div>
                </div>
                <div className="tabular" style={{ fontSize: '0.78rem', fontWeight: 600, width: 48, textAlign: 'right' }}>
                  {(pos.weight * 100).toFixed(1)}%
                </div>
                <div className="weight-bar" style={{ width: 60 }}>
                  <div
                    className="weight-bar-fill"
                    style={{ width: `${Math.min(pos.weight * 100, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Link>
  );
}
