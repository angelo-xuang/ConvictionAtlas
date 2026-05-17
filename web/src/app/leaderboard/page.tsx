'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchPageData, formatMoney, formatReturn, formatCompact } from '../../lib/api';
import type { ManagerLeaderboardEntry, OpportunityLeaderboardEntry } from '../../lib/types';
import { MiniLine } from '../../components/Chart';

export default function LeaderboardPage() {
  const [managers, setManagers] = useState<ManagerLeaderboardEntry[]>([]);
  const [opportunities, setOpportunities] = useState<OpportunityLeaderboardEntry[]>([]);
  const [tab, setTab] = useState<'managers' | 'opportunities'>('managers');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchPageData<ManagerLeaderboardEntry[]>('/leaderboard/managers'),
      fetchPageData<OpportunityLeaderboardEntry[]>('/leaderboard/opportunities'),
    ])
      .then(([m, o]) => { setManagers(m); setOpportunities(o); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="shell"><p className="muted" style={{ padding: '60px 0' }}>加载中...</p></div>;

  return (
    <div className="shell">
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <Link href="/">首页</Link><span>/</span><span>排行榜</span>
          </div>
          <h1>业绩排行</h1>
          <p className="muted text-sm mt-2">按关键指标比较经理与投资标的。</p>
        </div>
        <div className="flex gap-3">
          <div className="stat-item"><span className="stat-value">{managers.length}</span><span className="stat-label">经理</span></div>
          <div className="stat-item"><span className="stat-value">{opportunities.length}</span><span className="stat-label">标的</span></div>
        </div>
      </div>

      <div className="leaderboard-tabs">
        <button className={`leaderboard-tab ${tab === 'managers' ? 'active' : ''}`} onClick={() => setTab('managers')}>经理</button>
        <button className={`leaderboard-tab ${tab === 'opportunities' ? 'active' : ''}`} onClick={() => setTab('opportunities')}>标的</button>
      </div>

      {tab === 'managers' && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>经理</th>
                <th>曲线</th>
                <th>NAV</th>
                <th>累计</th>
                <th>Sharpe</th>
                <th>命中率</th>
              </tr>
            </thead>
            <tbody>
              {managers.sort((a, b) => b.cumulativeReturn - a.cumulativeReturn).map((m, i) => {
                const navPoints = m.performanceSeries?.map(p => p.nav) || [];
                return (
                  <tr key={m.slug}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span className="text-xs muted font-mono">#{i + 1}</span>
                        <Link href={`/managers/${m.slug}`} style={{ fontWeight: 600 }}>{m.name}</Link>
                      </div>
                    </td>
                    <td style={{ width: 120 }}>
                      {navPoints.length > 1 && <MiniLine points={navPoints} height={32} tone={m.cumulativeReturn >= 0 ? 'positive' : 'negative'} />}
                    </td>
                    <td className="tabular">{formatMoney(m.nav)}</td>
                    <td className={`tabular ${m.cumulativeReturn >= 0 ? 'positive' : 'negative'}`}>{formatReturn(m.cumulativeReturn)}</td>
                    <td className="tabular">{m.sharpe.toFixed(2)}</td>
                    <td className="tabular">{(m.hitRate * 100).toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'opportunities' && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>标的</th>
                <th>价格</th>
                <th>24h</th>
                <th>成交量</th>
                <th>评分</th>
                <th>信号</th>
              </tr>
            </thead>
            <tbody>
              {opportunities.sort((a, b) => b.signalStrength - a.signalStrength).map((o, i) => (
                <tr key={o.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <span className="text-xs muted font-mono">#{i + 1}</span>
                      <Link href={`/opportunities/detail?id=${o.id}`} style={{ fontWeight: 600 }}>{o.title}</Link>
                      <span className="badge badge-neutral">{o.type === 'TOKEN' ? 'Token' : 'PM'}</span>
                    </div>
                  </td>
                  <td className="tabular">{formatMoney(o.currentPrice)}</td>
                  <td className={`tabular ${o.priceChange24h !== null ? (o.priceChange24h >= 0 ? 'positive' : 'negative') : ''}`}>{formatReturn(o.priceChange24h)}</td>
                  <td className="tabular">{formatCompact(o.volume24h)}</td>
                  <td className="tabular">{o.convictionAverage.toFixed(1)}</td>
                  <td className="tabular">{o.signalStrength.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
