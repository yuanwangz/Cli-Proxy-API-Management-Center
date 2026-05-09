import type { UsageDetail, UsagePayload, UsageTimeRange } from '@/types/usage';

export interface UsageEvent {
  id: string;
  endpoint: string;
  method: string;
  path: string;
  model: string;
  provider: string;
  account: string;
  source: string;
  timestamp: string;
  timestampMs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
  latencyMs: number | null;
  failed: boolean;
  cost: number;
}

export interface UsageSummary {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  averageLatencyMs: number | null;
  p95LatencyMs: number | null;
  successRate: number;
  failureRate: number;
  estimatedCost: number;
}

export interface TimeBucket {
  label: string;
  startMs: number;
  success: number;
  failure: number;
  inputTokens: number;
  outputTokens: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  p99LatencyMs: number | null;
}

export interface GroupRow {
  key: string;
  label: string;
  provider: string;
  requests: number;
  success: number;
  failure: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  averageLatencyMs: number | null;
  p95LatencyMs: number | null;
  successRate: number;
  failureRate: number;
  cost: number;
}

export interface RecentUsageRow {
  id: string;
  time: string;
  status: string;
  provider: string;
  model: string;
  endpoint: string;
  account: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number | null;
  error: string;
  failed: boolean;
}

export interface UsageAnalyticsData {
  events: UsageEvent[];
  filteredEvents: UsageEvent[];
  summary: UsageSummary;
  buckets: TimeBucket[];
  modelRows: GroupRow[];
  accountRows: GroupRow[];
  endpointRows: GroupRow[];
  providerRows: GroupRow[];
  recentRows: RecentUsageRow[];
  providerOptions: string[];
  modelOptions: string[];
  accountOptions: string[];
  endpointOptions: string[];
}

export const USAGE_TIME_RANGE_OPTIONS: ReadonlyArray<{ value: UsageTimeRange; label: string }> = [
  { value: '1h', label: '1小时' },
  { value: '6h', label: '6小时' },
  { value: '24h', label: '24小时' },
  { value: '7d', label: '7天' },
  { value: '30d', label: '30天' },
  { value: 'all', label: '全部' },
];

const RANGE_MS: Partial<Record<UsageTimeRange, number>> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const BUCKET_COUNT: Record<UsageTimeRange, number> = {
  '1h': 12,
  '6h': 24,
  '24h': 24,
  '7d': 28,
  '30d': 30,
  all: 30,
};

const MODEL_PRICES: Array<{ pattern: RegExp; input: number; output: number }> = [
  { pattern: /opus/i, input: 15, output: 75 },
  { pattern: /sonnet/i, input: 3, output: 15 },
  { pattern: /haiku/i, input: 0.8, output: 4 },
  { pattern: /gpt-4\.1|gpt-4o|o3/i, input: 2.5, output: 10 },
  { pattern: /gpt-5|o4/i, input: 1.25, output: 10 },
  { pattern: /gemini.*pro/i, input: 1.25, output: 5 },
  { pattern: /gemini/i, input: 0.3, output: 1.2 },
  { pattern: /deepseek|qwen|glm|kimi|moonshot/i, input: 0.25, output: 1 },
];

const FALLBACK_PRICE = { input: 0.5, output: 1.5 };

const toFiniteNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const safeText = (value: unknown, fallback = '-'): string => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return fallback;
  }
  const text = String(value).trim();
  return text || fallback;
};

const parseTimestampMs = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const endpointParts = (endpoint: string): { method: string; path: string } => {
  const match = endpoint.match(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(.+)$/i);
  if (!match) {
    return { method: '', path: endpoint };
  }
  return { method: match[1].toUpperCase(), path: match[2] };
};

export const inferProvider = (model: string, account: string, endpoint = ''): string => {
  const text = `${model} ${account} ${endpoint}`.toLowerCase();
  if (text.includes('anthropic') || text.includes('claude')) return 'Anthropic';
  if (text.includes('gemini') || text.includes('google') || text.includes('vertex')) return 'Google';
  if (text.includes('codex') || text.includes('openai') || text.includes('gpt') || text.includes('o3')) return 'OpenAI';
  if (text.includes('antigravity')) return 'Antigravity';
  if (text.includes('kimi') || text.includes('moonshot')) return 'Kimi';
  if (text.includes('azure')) return 'Azure OpenAI';
  return 'Other';
};

const priceForModel = (model: string) =>
  MODEL_PRICES.find((price) => price.pattern.test(model)) ?? FALLBACK_PRICE;

const estimateCost = (model: string, inputTokens: number, outputTokens: number): number => {
  const price = priceForModel(model);
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
};

const percentile = (values: number[], pct: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index];
};

export const flattenUsageEvents = (payload: UsagePayload | null | undefined): UsageEvent[] => {
  const apis = payload?.apis;
  if (!apis) return [];

  const events: UsageEvent[] = [];
  Object.entries(apis).forEach(([endpointName, apiEntry]) => {
    const models = apiEntry?.models;
    if (!models) return;
    const { method, path } = endpointParts(endpointName);

    Object.entries(models).forEach(([modelName, modelEntry]) => {
      const details = Array.isArray(modelEntry?.details) ? modelEntry.details : [];
      details.forEach((detail: UsageDetail, index) => {
        const timestampMs = parseTimestampMs(detail.timestamp);
        const tokens = detail.tokens ?? {};
        const inputTokens = Math.max(0, toFiniteNumber(tokens.input_tokens));
        const outputTokens = Math.max(0, toFiniteNumber(tokens.output_tokens));
        const reasoningTokens = Math.max(0, toFiniteNumber(tokens.reasoning_tokens));
        const cachedTokens = Math.max(
          toFiniteNumber(tokens.cached_tokens),
          toFiniteNumber(tokens.cache_tokens)
        );
        const totalTokens = Math.max(
          0,
          toFiniteNumber(tokens.total_tokens) || inputTokens + outputTokens
        );
        const account = safeText(detail.auth_index, safeText(detail.source, '未标记账号'));
        const source = safeText(detail.source, account);
        const latencyValue = toFiniteNumber(detail.latency_ms);
        const latencyMs = latencyValue > 0 ? latencyValue : null;
        const provider = inferProvider(modelName, account, endpointName);

        events.push({
          id: `${endpointName}:${modelName}:${timestampMs}:${index}`,
          endpoint: endpointName,
          method,
          path,
          model: safeText(modelName, '-'),
          provider,
          account,
          source,
          timestamp: safeText(detail.timestamp, ''),
          timestampMs,
          inputTokens,
          outputTokens,
          reasoningTokens,
          cachedTokens,
          totalTokens,
          latencyMs,
          failed: detail.failed === true,
          cost: estimateCost(modelName, inputTokens, outputTokens),
        });
      });
    });
  });

  return events.sort((a, b) => b.timestampMs - a.timestampMs);
};

export const rangeStartMs = (events: UsageEvent[], range: UsageTimeRange, nowMs = Date.now()): number => {
  if (range !== 'all') {
    return nowMs - (RANGE_MS[range] ?? RANGE_MS['24h'] ?? 0);
  }
  const oldest = events.reduce((min, event) => {
    if (!event.timestampMs) return min;
    return Math.min(min, event.timestampMs);
  }, Number.POSITIVE_INFINITY);
  return Number.isFinite(oldest) ? oldest : nowMs - (RANGE_MS['24h'] ?? 0);
};

export const filterEvents = (
  events: UsageEvent[],
  filters: {
    range: UsageTimeRange;
    provider: string;
    model: string;
    account: string;
    endpoint: string;
    failedOnly: boolean;
  },
  nowMs = Date.now()
): UsageEvent[] => {
  const startMs = rangeStartMs(events, filters.range, nowMs);
  return events.filter((event) => {
    if (event.timestampMs && event.timestampMs < startMs) return false;
    if (event.timestampMs && event.timestampMs > nowMs + 60_000) return false;
    if (filters.provider !== 'all' && event.provider !== filters.provider) return false;
    if (filters.model !== 'all' && event.model !== filters.model) return false;
    if (filters.account !== 'all' && event.account !== filters.account) return false;
    if (filters.endpoint !== 'all' && event.endpoint !== filters.endpoint) return false;
    if (filters.failedOnly && !event.failed) return false;
    return true;
  });
};

export const summarizeEvents = (events: UsageEvent[]): UsageSummary => {
  const latencyValues: number[] = [];
  const summary = events.reduce<UsageSummary>(
    (next, event) => {
      next.totalRequests += 1;
      if (event.failed) {
        next.failureCount += 1;
      } else {
        next.successCount += 1;
      }
      next.totalTokens += event.totalTokens;
      next.inputTokens += event.inputTokens;
      next.outputTokens += event.outputTokens;
      next.cachedTokens += event.cachedTokens;
      next.reasoningTokens += event.reasoningTokens;
      next.estimatedCost += event.cost;
      if (event.latencyMs !== null) latencyValues.push(event.latencyMs);
      return next;
    },
    {
      totalRequests: 0,
      successCount: 0,
      failureCount: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      averageLatencyMs: null,
      p95LatencyMs: null,
      successRate: 100,
      failureRate: 0,
      estimatedCost: 0,
    }
  );

  const total = summary.totalRequests || 1;
  summary.successRate = (summary.successCount / total) * 100;
  summary.failureRate = (summary.failureCount / total) * 100;
  if (latencyValues.length > 0) {
    summary.averageLatencyMs =
      latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length;
    summary.p95LatencyMs = percentile(latencyValues, 95);
  }
  return summary;
};

const bucketLabel = (startMs: number, range: UsageTimeRange): string => {
  const date = new Date(startMs);
  if (range === '1h' || range === '6h' || range === '24h') {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
};

export const buildTimeBuckets = (
  events: UsageEvent[],
  range: UsageTimeRange,
  nowMs = Date.now()
): TimeBucket[] => {
  const count = BUCKET_COUNT[range];
  const startMs = rangeStartMs(events, range, nowMs);
  const endMs = Math.max(nowMs, startMs + 1);
  const bucketSize = Math.max(1, Math.ceil((endMs - startMs) / count));
  const latencySamples: number[][] = Array.from({ length: count }, () => []);
  const buckets: TimeBucket[] = Array.from({ length: count }, (_, index) => {
    const bucketStart = startMs + index * bucketSize;
    return {
      label: bucketLabel(bucketStart, range),
      startMs: bucketStart,
      success: 0,
      failure: 0,
      inputTokens: 0,
      outputTokens: 0,
      p50LatencyMs: null,
      p95LatencyMs: null,
      p99LatencyMs: null,
    };
  });

  events.forEach((event) => {
    if (!event.timestampMs) return;
    const index = Math.min(count - 1, Math.max(0, Math.floor((event.timestampMs - startMs) / bucketSize)));
    const bucket = buckets[index];
    if (event.failed) bucket.failure += 1;
    else bucket.success += 1;
    bucket.inputTokens += event.inputTokens;
    bucket.outputTokens += event.outputTokens;
    if (event.latencyMs !== null) latencySamples[index].push(event.latencyMs);
  });

  buckets.forEach((bucket, index) => {
    bucket.p50LatencyMs = percentile(latencySamples[index], 50);
    bucket.p95LatencyMs = percentile(latencySamples[index], 95);
    bucket.p99LatencyMs = percentile(latencySamples[index], 99);
  });

  return buckets;
};

const emptyGroupRow = (key: string, label: string, provider = ''): GroupRow => ({
  key,
  label,
  provider,
  requests: 0,
  success: 0,
  failure: 0,
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  averageLatencyMs: null,
  p95LatencyMs: null,
  successRate: 100,
  failureRate: 0,
  cost: 0,
});

const buildGroupRows = (
  events: UsageEvent[],
  keyOf: (event: UsageEvent) => string,
  labelOf: (event: UsageEvent) => string,
  providerOf: (event: UsageEvent) => string
): GroupRow[] => {
  const rows = new Map<string, { row: GroupRow; latencies: number[] }>();
  events.forEach((event) => {
    const key = keyOf(event);
    const current = rows.get(key) ?? {
      row: emptyGroupRow(key, labelOf(event), providerOf(event)),
      latencies: [],
    };
    current.row.requests += 1;
    if (event.failed) current.row.failure += 1;
    else current.row.success += 1;
    current.row.totalTokens += event.totalTokens;
    current.row.inputTokens += event.inputTokens;
    current.row.outputTokens += event.outputTokens;
    current.row.cost += event.cost;
    if (!current.row.provider) current.row.provider = providerOf(event);
    if (event.latencyMs !== null) current.latencies.push(event.latencyMs);
    rows.set(key, current);
  });

  return Array.from(rows.values())
    .map(({ row, latencies }) => {
      const total = row.requests || 1;
      return {
        ...row,
        successRate: (row.success / total) * 100,
        failureRate: (row.failure / total) * 100,
        averageLatencyMs: latencies.length
          ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
          : null,
        p95LatencyMs: percentile(latencies, 95),
      };
    })
    .sort((a, b) => b.requests - a.requests);
};

const uniqueSorted = (values: string[]) =>
  Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));

export const buildUsageAnalytics = (
  payload: UsagePayload | null | undefined,
  filters: {
    range: UsageTimeRange;
    provider: string;
    model: string;
    account: string;
    endpoint: string;
    failedOnly: boolean;
  },
  nowMs = Date.now()
): UsageAnalyticsData => {
  const events = flattenUsageEvents(payload);
  const filteredEvents = filterEvents(events, filters, nowMs);

  return {
    events,
    filteredEvents,
    summary: summarizeEvents(filteredEvents),
    buckets: buildTimeBuckets(filteredEvents, filters.range, nowMs),
    modelRows: buildGroupRows(filteredEvents, (event) => event.model, (event) => event.model, (event) => event.provider),
    accountRows: buildGroupRows(
      filteredEvents,
      (event) => `${event.provider}:${event.account}`,
      (event) => event.account,
      (event) => event.provider
    ),
    endpointRows: buildGroupRows(
      filteredEvents,
      (event) => event.endpoint,
      (event) => event.path || event.endpoint,
      (event) => event.provider
    ),
    providerRows: buildGroupRows(filteredEvents, (event) => event.provider, (event) => event.provider, (event) => event.provider),
    recentRows: filteredEvents.slice(0, 10).map((event) => ({
      id: event.id,
      time: event.timestampMs
        ? new Date(event.timestampMs).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '-',
      status: event.failed ? '失败' : '200',
      provider: event.provider,
      model: event.model,
      endpoint: event.path || event.endpoint,
      account: event.account,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      totalTokens: event.totalTokens,
      latencyMs: event.latencyMs,
      error: event.failed ? '上游请求失败' : '—',
      failed: event.failed,
    })),
    providerOptions: uniqueSorted(events.map((event) => event.provider)),
    modelOptions: uniqueSorted(events.map((event) => event.model)),
    accountOptions: uniqueSorted(events.map((event) => event.account)),
    endpointOptions: uniqueSorted(events.map((event) => event.endpoint)),
  };
};

export const formatCompactNumber = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.round(value).toLocaleString();
};

export const formatPercent = (value: number): string => `${value.toFixed(value >= 99 ? 2 : 1)}%`;

export const formatLatency = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${Math.round(value)} ms`;
};

export const formatCurrency = (value: number): string =>
  `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
