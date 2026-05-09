export type UsageTimeRange = '1h' | '6h' | '24h' | '7d' | '30d' | 'all';

export interface UsageTokens {
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  cached_tokens?: number;
  cache_tokens?: number;
  total_tokens?: number;
}

export interface UsageDetail {
  timestamp?: string;
  source?: string;
  auth_index?: string | number | null;
  latency_ms?: number | null;
  tokens?: UsageTokens;
  failed?: boolean;
}

export interface UsageModelAggregate {
  details?: UsageDetail[];
}

export interface UsageAPIAggregate {
  models?: Record<string, UsageModelAggregate>;
}

export interface UsagePayload {
  total_requests?: number;
  success_count?: number;
  failure_count?: number;
  total_tokens?: number;
  apis?: Record<string, UsageAPIAggregate>;
}

export interface UsageImportResult {
  added?: number;
  skipped?: number;
  total?: number;
  failed?: number;
  unsupported?: number;
  warnings?: string[];
}
