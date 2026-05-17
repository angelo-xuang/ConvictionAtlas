import { API_BASE_URL, buildReadApiUrl } from './runtime-config';

async function parseJsonResponse<T>(response: Response, path: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`API request failed for ${path}: ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function fetchPageData<T>(path: string): Promise<T> {
  const response = await fetch(buildReadApiUrl(path), {
    cache: 'no-store',
  });

  return parseJsonResponse<T>(response, path);
}

export async function fetchApi<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    cache: 'no-store',
  });

  return parseJsonResponse<T>(response, path);
}

export async function postApi<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed for ${path}: ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function safeFetchApi<T>(path: string): Promise<T | null> {
  try {
    return await fetchApi<T>(path);
  } catch (error) {
    console.error(error);
    return null;
  }
}

export function formatPercent(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '--';
  }

  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

export function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '--';
  }

  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

export function formatCompact(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '--';
  }

  return new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatReturn(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '--';
  }

  return formatPercent(value * 100, digits);
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) {
    return '--';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) {
    return '--';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

const SIGNAL_LABELS: Record<string, string> = {
  trend_regime: '趋势状态',
  risk_flag: '风险标志',
  opportunity_quality: '机会质量',
  volume_spike: '成交量异动',
  narrative_strength: '叙事强度',
  news_heat: '新闻热度',
  market_momentum: '市场动量',
  catalyst_setup: '催化布局',
  event_proximity: '事件临近',
  probability_edge: '概率优势',
  price_dislocation: '价格偏离',
};

export function formatSignalName(value: string) {
  return SIGNAL_LABELS[value] || value.replace(/_/g, ' ');
}

const DIRECTION_LABELS: Record<string, string> = {
  BULLISH: '看多',
  BEARISH: '看空',
  NEUTRAL: '中性',
};

export function formatDirection(direction: string | null | undefined): string {
  if (!direction) return '--';
  return DIRECTION_LABELS[direction] || direction;
}

export function getSignedClass(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) {
    return 'badge-neutral';
  }

  return value > 0 ? 'badge-positive' : 'badge-negative';
}

export function getDirectionClass(direction: string | null | undefined) {
  if (direction === 'BULLISH') {
    return 'badge-positive';
  }

  if (direction === 'BEARISH') {
    return 'badge-negative';
  }

  return 'badge-neutral';
}
