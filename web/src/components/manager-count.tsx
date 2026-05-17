'use client';

import { useEffect, useState } from 'react';
import { fetchPageData } from '../lib/api';

type ManagerSummary = { id: string };

export function ManagerCount({ valueOnly }: { valueOnly?: boolean }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    fetchPageData<ManagerSummary[]>('/managers')
      .then((data) => setCount(data?.length ?? 0))
      .catch(() => setCount(0));
  }, []);

  if (count === null) return <span>--</span>;

  if (valueOnly) return <span>{count}</span>;

  return <span className="badge badge-neutral">{count} 经理</span>;
}
