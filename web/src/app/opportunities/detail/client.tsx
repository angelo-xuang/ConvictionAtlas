'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { fetchPageData, formatMoney, formatPercent, formatCompact, formatDate, formatSignalName, formatDirection, getDirectionClass } from '../../../lib/api';
import type { OpportunityDetail, ManagerDecision, Signal, NewsItem, OpportunityHistoryPoint } from '../../../lib/types';
import { PerfLine } from '../../../components/Chart';

export default function OpportunityDetailClient() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id') || searchParams.get('slug');

  const [detail, setDetail] = useState<OpportunityDetail | null>(null);
  const [decisions, setDecisions] = useState<ManagerDecision[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [history, setHistory] = useState<OpportunityHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetchPageData<OpportunityDetail>(`/opportunities/${id}`),
      fetchPageData<ManagerDecision[]>(`/opportunities/${id}/managers`),
      fetchPageData<Signal[]>(`/opportunities/${id}/signals`),
      fetchPageData<NewsItem[]>(`/opportunities/${id}/news`),
      fetchPageData<OpportunityHistoryPoint[]>(`/opportunities/${id}/history`),
    ])
      .then(([d, m, s, n, h]) => {
        setDetail(d);
        setDecisions(m);
        setSignals(s);
        setNews(n);
        setHistory(h);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="shell"><p className="muted" style={{ padding: '60px 0' }}>加载中...</p></div>;
  if (!detail) return <div className="shell"><div className="error-card">未找到该标的。</div></div>;

  // Use /history endpoint data first, fall back to metadata.priceHistory
  const metaPrices: number[] = (detail as any)?.metadata?.priceHistory ?? [];
  const priceHistoryPoints = history.length > 0
    ? history.map(h => h.price).reverse()
    : metaPrices;
  const historyDates = history.length > 0
    ? history.map(h => formatDate(h.pointAt)).reverse()
    : metaPrices.map((_, i) => `T+${i + 1}`);

  const priceTrend = priceHistoryPoints.length >= 2
    ? priceHistoryPoints[priceHistoryPoints.length - 1] - priceHistoryPoints[0]
    : 0;

  return (
    <div className="shell">
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <Link href="/">首页</Link><span>/</span>
            <Link href="/opportunities">投资机会</Link><span>/</span>
            <span>{detail.title}</span>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <div className="avatar avatar-lg">
              {detail.imageUrl
                ? <img src={detail.imageUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                : (detail.symbol?.[0] || detail.title[0])}
            </div>
            <div>
              <h1>{detail.title}</h1>
              <div className="flex gap-2 mt-2">
                <span className="badge badge-neutral">{detail.type === 'TOKEN' ? '代币' : '预测市场'}</span>
                <span className="badge badge-neutral">{detail.sourceKind}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ minWidth: 200 }}>
          <div className="stat-grid">
            <div className="stat-item"><span className="stat-value">{formatMoney(detail.currentPrice)}</span><span className="stat-label">价格</span></div>
            <div className="stat-item"><span className={`stat-value ${detail.priceChange24h !== null ? (detail.priceChange24h >= 0 ? 'positive' : 'negative') : ''}`}>{formatPercent(detail.priceChange24h)}</span><span className="stat-label">24h</span></div>
            <div className="stat-item"><span className="stat-value">{formatCompact(detail.volume24h)}</span><span className="stat-label">成交量</span></div>
          </div>
        </div>
      </div>

      {priceHistoryPoints.length > 1 && (
        <div className="card mb-4">
          <div className="card-header">
            <span className="eyebrow">价格走势</span>
            <span className={`text-sm font-semibold ${priceTrend >= 0 ? 'positive' : 'negative'}`}>
              {priceTrend >= 0 ? '+' : ''}{((priceTrend / priceHistoryPoints[0]) * 100).toFixed(1)}%
            </span>
          </div>
          <PerfLine points={priceHistoryPoints} dateLabels={historyDates} height={200} tone={priceTrend >= 0 ? 'positive' : 'negative'} />
        </div>
      )}

      <div className="detail-layout">
        <div className="detail-main">
          {signals.length > 0 && (
            <div className="card">
              <div className="eyebrow mb-4">信号 ({signals.length})</div>
              <div className="decision-grid">
                {signals.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).map(s => (
                  <div key={s.id} className="decision-card">
                    <div className="flex justify-between items-center mb-2">
                      <strong className="text-sm">{formatSignalName(s.name)}</strong>
                      <span className={`badge ${s.value >= 0 ? 'badge-positive' : 'badge-negative'}`}>{s.value.toFixed(2)}</span>
                    </div>
                    <div className="flex gap-2 text-xs muted">
                      <span>置信度: {(s.confidence * 100).toFixed(0)}%</span>
                      <span className={`badge ${getDirectionClass(s.direction)}`}>{formatDirection(s.direction)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {decisions.length > 0 && (
            <div className="card">
              <div className="eyebrow mb-4">经理观点</div>
              <div className="decision-grid">
                {decisions.map(d => (
                  <div key={d.id} className="decision-card">
                    <div className="flex justify-between items-center">
                      <strong className="text-sm">{d.manager.name}</strong>
                      <span className={`badge ${getDirectionClass(d.direction)}`}>{formatDirection(d.direction)}</span>
                    </div>
                    <div className="text-xs muted mt-2">评分: {d.convictionScore.toFixed(2)} | 目标: {(d.targetWeight * 100).toFixed(1)}%</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {news.length > 0 && (
            <div className="card">
              <div className="eyebrow mb-4">新闻</div>
              <div className="flex flex-col gap-3">
                {news.map(n => (
                  <a key={n.id} href={n.url} target="_blank" rel="noreferrer" className="decision-card" style={{ display: 'block' }}>
                    <strong className="text-sm">{n.title}</strong>
                    {n.summary && <p className="text-xs muted mt-2">{n.summary}</p>}
                    <div className="text-xs muted mt-2">{n.sourceName} · {formatDate(n.publishedAt)}</div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="detail-sidebar">
          {history.length > 0 && (
            <div className="card">
              <div className="eyebrow mb-4">近期历史</div>
              <div className="table-wrap" style={{ border: 'none' }}>
                <table>
                  <thead><tr><th>日期</th><th>价格</th><th>量</th></tr></thead>
                  <tbody>
                    {history.slice(0, 10).map(h => (
                      <tr key={h.id}>
                        <td className="text-xs">{formatDate(h.pointAt)}</td>
                        <td className="tabular text-sm">{formatMoney(h.price)}</td>
                        <td className="tabular text-sm">{formatCompact(h.volume)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
