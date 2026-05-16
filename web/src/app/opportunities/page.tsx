'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchPageData, formatMoney, formatPercent, formatCompact, getSignedClass, formatSignalName } from '../../lib/api';
import type { OpportunitySummary, OpportunityLeaderboardEntry } from '../../lib/types';

export default function OpportunitiesPage() {
  const [opps, setOpps] = useState<OpportunitySummary[]>([]);
  const [leaders, setLeaders] = useState<OpportunityLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchPageData<OpportunitySummary[]>('/opportunities'),
      fetchPageData<OpportunityLeaderboardEntry[]>('/leaderboard/opportunities'),
    ])
      .then(([o, l]) => { setOpps(o); setLeaders(l); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="shell"><p className="muted" style={{ padding: '60px 0' }}>加载中...</p></div>;

  return (
    <div className="shell">
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <Link href="/">首页</Link>
            <span>/</span>
            <span>投资机会</span>
          </div>
          <h1>市场机会</h1>
          <p className="muted text-sm mt-2">所有追踪的代币和预测市场，含信号评分与价格走势。</p>
        </div>
        <div className="flex gap-3">
          <div className="stat-item">
            <span className="stat-value">{opps.length}</span>
            <span className="stat-label">总计</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{opps.filter(o => o.type === 'TOKEN').length}</span>
            <span className="stat-label">代币</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{opps.filter(o => o.type === 'PREDICTION_MARKET').length}</span>
            <span className="stat-label">市场</span>
          </div>
        </div>
      </div>

      <div className="opp-grid">
        {opps.map((opp) => {
          const signal = opp.strongestSignal;
          return (
            <Link href={`/opportunities/detail?id=${opp.id}`} key={opp.id} className="opp-card">
              <div className="opp-card-header">
                <div
                  className="avatar avatar-md"
                  style={opp.imageUrl ? { backgroundImage: `url(${opp.imageUrl})`, backgroundSize: 'cover' } : undefined}
                >
                  {!opp.imageUrl && (opp.symbol?.[0] || opp.title[0])}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 className="truncate">{opp.title}</h3>
                  <div className="flex gap-2">
                    <span className="badge badge-neutral">{opp.type === 'TOKEN' ? '代币' : '预测'}</span>
                    <span className="badge badge-neutral">{opp.sourceKind}</span>
                  </div>
                </div>
              </div>

              <div className="opp-card-data">
                <div className="opp-data-item">
                  <span className="label">价格</span>
                  <span className="value">{formatMoney(opp.currentPrice)}</span>
                </div>
                <div className="opp-data-item">
                  <span className="label">24h</span>
                  <span className={`value ${opp.priceChange24h !== null ? (opp.priceChange24h >= 0 ? 'positive' : 'negative') : ''}`}>
                    {formatPercent(opp.priceChange24h)}
                  </span>
                </div>
                <div className="opp-data-item">
                  <span className="label">成交量</span>
                  <span className="value">{formatCompact(opp.volume24h)}</span>
                </div>
                <div className="opp-data-item">
                  <span className="label">最强信号</span>
                  <span className="value text-sm">{signal ? formatSignalName(signal.name) : '--'}</span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {leaders.length > 0 && (
        <div className="section">
          <div className="section-header">
            <h2>排行榜</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>标的</th>
                  <th>价格</th>
                  <th>24h</th>
                  <th>成交量</th>
                  <th>信念</th>
                  <th>信号</th>
                </tr>
              </thead>
              <tbody>
                {leaders.map((l) => (
                  <tr key={l.id}>
                    <td><strong>{l.title}</strong> <span className="badge badge-neutral text-xs">{l.type === 'TOKEN' ? '代币' : 'PM'}</span></td>
                    <td className="tabular">{formatMoney(l.currentPrice)}</td>
                    <td className={`tabular ${l.priceChange24h !== null ? (l.priceChange24h >= 0 ? 'positive' : 'negative') : ''}`}>
                      {formatPercent(l.priceChange24h)}
                    </td>
                    <td className="tabular">{formatCompact(l.volume24h)}</td>
                    <td className="tabular">{l.convictionAverage.toFixed(1)}</td>
                    <td className="tabular">{l.signalStrength.toFixed(2)}</td>
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
