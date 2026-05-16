'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { fetchPageData, formatMoney, formatPercent, formatCompact, formatDate, formatSignalName, getDirectionClass } from '../../../lib/api';
import type { OpportunityDetail, ManagerDecision, Signal, NewsItem, OpportunityHistoryPoint } from '../../../lib/types';
import { PerfLine } from '../../../components/Chart';

export default function OpportunityDetailClient() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');

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

  if (loading) return <div className="shell"><p className="muted" style={{ padding: '60px 0' }}>Loading...</p></div>;
  if (!detail) return <div className="shell"><div className="error-card">Opportunity not found.</div></div>;

  const priceHistoryPoints = history.map(h => h.price).reverse();
  const historyDates = history.map(h => formatDate(h.pointAt)).reverse();

  return (
    <div className="shell">
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <Link href="/">Home</Link><span>/</span>
            <Link href="/opportunities">Opportunities</Link><span>/</span>
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
                <span className="badge badge-neutral">{detail.type === 'TOKEN' ? 'Token' : 'Prediction Market'}</span>
                <span className="badge badge-neutral">{detail.sourceKind}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ minWidth: 200 }}>
          <div className="stat-grid">
            <div className="stat-item"><span className="stat-value">{formatMoney(detail.currentPrice)}</span><span className="stat-label">Price</span></div>
            <div className="stat-item"><span className={`stat-value ${detail.priceChange24h !== null ? (detail.priceChange24h >= 0 ? 'positive' : 'negative') : ''}`}>{formatPercent(detail.priceChange24h)}</span><span className="stat-label">24h</span></div>
            <div className="stat-item"><span className="stat-value">{formatCompact(detail.volume24h)}</span><span className="stat-label">Volume</span></div>
          </div>
        </div>
      </div>

      {priceHistoryPoints.length > 0 && (
        <div className="card mb-4">
          <div className="eyebrow mb-2">Price History</div>
          <PerfLine points={priceHistoryPoints} dateLabels={historyDates} height={200} tone={detail.priceChange24h !== null && detail.priceChange24h < 0 ? 'negative' : 'positive'} />
        </div>
      )}

      <div className="detail-layout">
        <div className="detail-main">
          {signals.length > 0 && (
            <div className="card">
              <div className="eyebrow mb-4">Signals ({signals.length})</div>
              <div className="decision-grid">
                {signals.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).map(s => (
                  <div key={s.id} className="decision-card">
                    <div className="flex justify-between items-center mb-2">
                      <strong className="text-sm">{formatSignalName(s.name)}</strong>
                      <span className={`badge ${s.value >= 0 ? 'badge-positive' : 'badge-negative'}`}>{s.value.toFixed(2)}</span>
                    </div>
                    <div className="flex gap-2 text-xs muted">
                      <span>Confidence: {(s.confidence * 100).toFixed(0)}%</span>
                      <span className={`badge ${getDirectionClass(s.direction)}`}>{s.direction}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {decisions.length > 0 && (
            <div className="card">
              <div className="eyebrow mb-4">Manager Views</div>
              <div className="decision-grid">
                {decisions.map(d => (
                  <div key={d.id} className="decision-card">
                    <div className="flex justify-between items-center">
                      <strong className="text-sm">{d.manager.name}</strong>
                      <span className={`badge ${getDirectionClass(d.direction)}`}>{d.direction}</span>
                    </div>
                    <div className="text-xs muted mt-2">Conviction: {d.convictionScore.toFixed(2)} | Target: {(d.targetWeight * 100).toFixed(1)}%</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {news.length > 0 && (
            <div className="card">
              <div className="eyebrow mb-4">News</div>
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
              <div className="eyebrow mb-4">Recent History</div>
              <div className="table-wrap" style={{ border: 'none' }}>
                <table>
                  <thead><tr><th>Date</th><th>Price</th><th>Vol</th></tr></thead>
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
