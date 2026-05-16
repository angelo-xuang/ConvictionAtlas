'use client';

import { useEffect, useState } from 'react';
import { MiniLine } from './Chart';
import { fetchPageData, formatReturn, getSignedClass } from '../lib/api';
import type { ManagerSummary } from '../lib/types';

export function HeroPerformanceChart() {
  const [managers, setManagers] = useState<ManagerSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPageData<ManagerSummary[]>('/managers')
      .then((data) => {
        setManagers(data ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="card"
            style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}
          >
            <div style={{ height: 14, background: 'var(--surface-strong)', borderRadius: 4, width: '60%' }} />
            <div style={{ height: 48, background: 'var(--bg-subtle)', borderRadius: 6 }} />
          </div>
        ))}
      </div>
    );
  }

  if (!managers.length) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <span className="muted">No manager data available</span>
      </div>
    );
  }

  const sorted = [...managers].sort(
    (a, b) => (b.cumulativeReturn ?? 0) - (a.cumulativeReturn ?? 0),
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {sorted.map((m) => {
        const ret = m.cumulativeReturn ?? 0;
        const tone = ret > 0 ? 'positive' : ret < 0 ? 'negative' : 'neutral';

        return (
          <div key={m.slug} className="card" style={{ padding: 16 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                {m.name}
              </span>
              <span className={`badge ${getSignedClass(ret)}`}>
                {formatReturn(ret)}
              </span>
            </div>
            <MiniLine
              points={m.performanceSeries.map((p) => p.nav)}
              height={48}
              tone={tone}
            />
          </div>
        );
      })}
    </div>
  );
}
