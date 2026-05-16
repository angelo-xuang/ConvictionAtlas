import ManagerDetailClient from './client';
import { API_BASE_URL } from '../../../lib/runtime-config';

export const dynamic = 'force-static';
export const dynamicParams = false;

export async function generateStaticParams() {
  try {
    const res = await fetch(`${API_BASE_URL}/managers`);
    const managers: { slug: string }[] = await res.json();
    return managers.map((m) => ({ slug: m.slug }));
  } catch {
    return [
      { slug: 'narrative-manager' },
      { slug: 'event-driven-manager' },
      { slug: 'quant-manager' },
      { slug: 'hybrid-manager' },
      { slug: 'onchain-fundamentals-manager' },
      { slug: 'polymarket-specialist-manager' },
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
