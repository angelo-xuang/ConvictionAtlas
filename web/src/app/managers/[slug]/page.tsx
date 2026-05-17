import ManagerDetailClient from './client';
import { API_BASE_URL } from '../../../lib/runtime-config';

export const dynamic = 'force-static';
export const dynamicParams = false;

export async function generateStaticParams() {
  // During build, NEXT_PUBLIC_API_BASE_URL may be a relative path (/atlas/api)
  // which cannot be fetched server-side. Fall back to localhost.
  const buildUrl = API_BASE_URL.startsWith('/')
    ? 'http://localhost:3001/api'
    : API_BASE_URL;
  try {
    const res = await fetch(`${buildUrl}/managers`);
    const managers: { slug: string }[] = await res.json();
    return managers.map((m) => ({ slug: m.slug }));
  } catch {
    return [
      { slug: 'narrative-manager' },
      { slug: 'event-driven-manager' },
      { slug: 'onchain-fundamentals-manager' },
      { slug: 'crypto-cta' },
      { slug: 'prediction-market-manager' },
    ];
  }
}

export default async function ManagerDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ManagerDetailClient slug={slug} />;
}
