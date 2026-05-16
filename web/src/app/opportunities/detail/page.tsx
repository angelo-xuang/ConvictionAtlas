import { Suspense } from 'react';
import OpportunityDetailClient from './client';

export default function OpportunityDetailPage() {
  return (
    <Suspense fallback={<div className="loading">加载中...</div>}>
      <OpportunityDetailClient />
    </Suspense>
  );
}
