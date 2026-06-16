export type StatusBlockState = 'success' | 'failure' | 'mixed' | 'idle';

export interface StatusBlockDetail {
  success: number;
  failure: number;
  rate: number;
  startTime: number;
  endTime: number;
}

export interface StatusBarData {
  blocks: StatusBlockState[];
  blockDetails: StatusBlockDetail[];
  successRate: number;
  totalSuccess: number;
  totalFailure: number;
}

export interface RecentRequestBucket {
  time?: string;
  success: number;
  failed: number;
}

export interface ProviderUsageQuotaState {
  exceeded?: boolean;
  reason?: string;
  nextRecoverAt?: string;
  nextRecoverAtMs?: number;
  backoffLevel?: number;
}

export interface ProviderUsageModelState {
  model: string;
  status?: string;
  statusMessage?: string;
  statusCode?: number;
  unavailable?: boolean;
  blocked?: boolean;
  cooling?: boolean;
  blockReason?: string;
  nextRetryAfter?: string;
  nextRetryAfterMs?: number;
  quota?: ProviderUsageQuotaState;
}

export interface ProviderUsageAuthStatus {
  authId?: string;
  authIndex?: string;
  provider?: string;
  status?: string;
  statusMessage?: string;
  statusCode?: number;
  disabled?: boolean;
  archived?: boolean;
  unavailable?: boolean;
  blocked?: boolean;
  cooling?: boolean;
  blockReason?: string;
  nextRetryAfter?: string;
  nextRetryAfterMs?: number;
  quota?: ProviderUsageQuotaState;
  modelStates?: ProviderUsageModelState[];
}

export interface RecentRequestUsageEntry {
  success: number;
  failed: number;
  recentRequests: RecentRequestBucket[];
  authId?: string;
  authIndex?: string;
  status?: string;
  statusMessage?: string;
  statusCode?: number;
  disabled?: boolean;
  archived?: boolean;
  unavailable?: boolean;
  blocked?: boolean;
  cooling?: boolean;
  blockReason?: string;
  nextRetryAfter?: string;
  nextRetryAfterMs?: number;
  totalAuths?: number;
  disabledCount?: number;
  archivedCount?: number;
  blockedCount?: number;
  coolingCount?: number;
  modelStates?: ProviderUsageModelState[];
  auths?: ProviderUsageAuthStatus[];
}

export type ApiKeyUsageResponse = Record<
  string,
  Record<
    string,
    {
      success?: unknown;
      failed?: unknown;
      recent_requests?: unknown;
      recentRequests?: unknown;
      auth_id?: unknown;
      authId?: unknown;
      auth_index?: unknown;
      authIndex?: unknown;
      status?: unknown;
      status_message?: unknown;
      statusMessage?: unknown;
      status_code?: unknown;
      statusCode?: unknown;
      disabled?: unknown;
      archived?: unknown;
      unavailable?: unknown;
      blocked?: unknown;
      cooling?: unknown;
      block_reason?: unknown;
      blockReason?: unknown;
      next_retry_after?: unknown;
      nextRetryAfter?: unknown;
      next_retry_after_ms?: unknown;
      nextRetryAfterMs?: unknown;
      total_auths?: unknown;
      totalAuths?: unknown;
      disabled_count?: unknown;
      disabledCount?: unknown;
      archived_count?: unknown;
      archivedCount?: unknown;
      blocked_count?: unknown;
      blockedCount?: unknown;
      cooling_count?: unknown;
      coolingCount?: unknown;
      model_states?: unknown;
      modelStates?: unknown;
      auths?: unknown;
    }
  >
>;

const RECENT_REQUEST_BLOCK_COUNT = 20;
const RECENT_REQUEST_BLOCK_DURATION_MS = 10 * 60 * 1000;

const toFiniteNumber = (value: unknown): number => {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

const optionalNumber = (value: unknown): number | undefined => {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
};

const optionalText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const optionalBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
  }
  return undefined;
};

export function normalizeUsageTotal(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return 0;
    }
    const numberValue = Number(trimmed);
    return Number.isFinite(numberValue) ? numberValue : 0;
  }
  return 0;
}

export function buildRecentRequestCompositeKey(baseUrl: unknown, apiKey: unknown): string {
  const normalizedBaseUrl = String(baseUrl ?? '').trim();
  const normalizedApiKey = String(apiKey ?? '').trim();
  return `${normalizedBaseUrl}|${normalizedApiKey}`;
}

export function normalizeRecentRequestAuthIndex(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

export function normalizeRecentRequestBuckets(input: unknown): RecentRequestBucket[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.slice(-RECENT_REQUEST_BLOCK_COUNT).map((item) => {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const time = typeof record.time === 'string' ? record.time : undefined;

    return {
      ...(time ? { time } : {}),
      success: toFiniteNumber(record.success),
      failed: toFiniteNumber(record.failed),
    };
  });
}

function normalizeQuotaState(input: unknown): ProviderUsageQuotaState | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  const quota: ProviderUsageQuotaState = {};
  const exceeded = optionalBoolean(record.exceeded);
  if (exceeded !== undefined) quota.exceeded = exceeded;
  const reason = optionalText(record.reason);
  if (reason) quota.reason = reason;
  const nextRecoverAt = optionalText(record.next_recover_at ?? record.nextRecoverAt);
  if (nextRecoverAt) quota.nextRecoverAt = nextRecoverAt;
  const nextRecoverAtMs = optionalNumber(record.next_recover_at_ms ?? record.nextRecoverAtMs);
  if (nextRecoverAtMs !== undefined) quota.nextRecoverAtMs = nextRecoverAtMs;
  const backoffLevel = optionalNumber(record.backoff_level ?? record.backoffLevel);
  if (backoffLevel !== undefined) quota.backoffLevel = backoffLevel;
  return Object.keys(quota).length ? quota : undefined;
}

function normalizeModelState(input: unknown): ProviderUsageModelState | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const record = input as Record<string, unknown>;
  const model = optionalText(record.model);
  if (!model) return null;
  const state: ProviderUsageModelState = { model };
  const status = optionalText(record.status);
  if (status) state.status = status;
  const statusMessage = optionalText(record.status_message ?? record.statusMessage);
  if (statusMessage) state.statusMessage = statusMessage;
  const statusCode = optionalNumber(record.status_code ?? record.statusCode);
  if (statusCode !== undefined) state.statusCode = statusCode;
  const unavailable = optionalBoolean(record.unavailable);
  if (unavailable !== undefined) state.unavailable = unavailable;
  const blocked = optionalBoolean(record.blocked);
  if (blocked !== undefined) state.blocked = blocked;
  const cooling = optionalBoolean(record.cooling);
  if (cooling !== undefined) state.cooling = cooling;
  const blockReason = optionalText(record.block_reason ?? record.blockReason);
  if (blockReason) state.blockReason = blockReason;
  const nextRetryAfter = optionalText(record.next_retry_after ?? record.nextRetryAfter);
  if (nextRetryAfter) state.nextRetryAfter = nextRetryAfter;
  const nextRetryAfterMs = optionalNumber(record.next_retry_after_ms ?? record.nextRetryAfterMs);
  if (nextRetryAfterMs !== undefined) state.nextRetryAfterMs = nextRetryAfterMs;
  const quota = normalizeQuotaState(record.quota);
  if (quota) state.quota = quota;
  return state;
}

function normalizeModelStates(input: unknown): ProviderUsageModelState[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const states = input
    .map((item) => normalizeModelState(item))
    .filter((item): item is ProviderUsageModelState => item !== null);
  return states.length ? states : undefined;
}

function normalizeAuthStatus(input: unknown): ProviderUsageAuthStatus | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const record = input as Record<string, unknown>;
  const auth: ProviderUsageAuthStatus = {};
  const authId = optionalText(record.auth_id ?? record.authId);
  if (authId) auth.authId = authId;
  const authIndex = optionalText(record.auth_index ?? record.authIndex);
  if (authIndex) auth.authIndex = authIndex;
  const provider = optionalText(record.provider);
  if (provider) auth.provider = provider;
  const status = optionalText(record.status);
  if (status) auth.status = status;
  const statusMessage = optionalText(record.status_message ?? record.statusMessage);
  if (statusMessage) auth.statusMessage = statusMessage;
  const statusCode = optionalNumber(record.status_code ?? record.statusCode);
  if (statusCode !== undefined) auth.statusCode = statusCode;
  const disabled = optionalBoolean(record.disabled);
  if (disabled !== undefined) auth.disabled = disabled;
  const archived = optionalBoolean(record.archived);
  if (archived !== undefined) auth.archived = archived;
  const unavailable = optionalBoolean(record.unavailable);
  if (unavailable !== undefined) auth.unavailable = unavailable;
  const blocked = optionalBoolean(record.blocked);
  if (blocked !== undefined) auth.blocked = blocked;
  const cooling = optionalBoolean(record.cooling);
  if (cooling !== undefined) auth.cooling = cooling;
  const blockReason = optionalText(record.block_reason ?? record.blockReason);
  if (blockReason) auth.blockReason = blockReason;
  const nextRetryAfter = optionalText(record.next_retry_after ?? record.nextRetryAfter);
  if (nextRetryAfter) auth.nextRetryAfter = nextRetryAfter;
  const nextRetryAfterMs = optionalNumber(record.next_retry_after_ms ?? record.nextRetryAfterMs);
  if (nextRetryAfterMs !== undefined) auth.nextRetryAfterMs = nextRetryAfterMs;
  const quota = normalizeQuotaState(record.quota);
  if (quota) auth.quota = quota;
  const modelStates = normalizeModelStates(record.model_states ?? record.modelStates);
  if (modelStates) auth.modelStates = modelStates;
  return Object.keys(auth).length ? auth : null;
}

function normalizeAuthStatuses(input: unknown): ProviderUsageAuthStatus[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const auths = input
    .map((item) => normalizeAuthStatus(item))
    .filter((item): item is ProviderUsageAuthStatus => item !== null);
  return auths.length ? auths : undefined;
}

export function normalizeRecentRequestUsageEntry(input: unknown): RecentRequestUsageEntry {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      success: 0,
      failed: 0,
      recentRequests: [],
    };
  }

  const record = input as Record<string, unknown>;
  const entry: RecentRequestUsageEntry = {
    success: normalizeUsageTotal(record.success),
    failed: normalizeUsageTotal(record.failed),
    recentRequests: normalizeRecentRequestBuckets(record.recent_requests ?? record.recentRequests),
  };

  const authId = optionalText(record.auth_id ?? record.authId);
  if (authId) entry.authId = authId;
  const authIndex = optionalText(record.auth_index ?? record.authIndex);
  if (authIndex) entry.authIndex = authIndex;
  const status = optionalText(record.status);
  if (status) entry.status = status;
  const statusMessage = optionalText(record.status_message ?? record.statusMessage);
  if (statusMessage) entry.statusMessage = statusMessage;
  const statusCode = optionalNumber(record.status_code ?? record.statusCode);
  if (statusCode !== undefined) entry.statusCode = statusCode;
  const disabled = optionalBoolean(record.disabled);
  if (disabled !== undefined) entry.disabled = disabled;
  const archived = optionalBoolean(record.archived);
  if (archived !== undefined) entry.archived = archived;
  const unavailable = optionalBoolean(record.unavailable);
  if (unavailable !== undefined) entry.unavailable = unavailable;
  const blocked = optionalBoolean(record.blocked);
  if (blocked !== undefined) entry.blocked = blocked;
  const cooling = optionalBoolean(record.cooling);
  if (cooling !== undefined) entry.cooling = cooling;
  const blockReason = optionalText(record.block_reason ?? record.blockReason);
  if (blockReason) entry.blockReason = blockReason;
  const nextRetryAfter = optionalText(record.next_retry_after ?? record.nextRetryAfter);
  if (nextRetryAfter) entry.nextRetryAfter = nextRetryAfter;
  const nextRetryAfterMs = optionalNumber(record.next_retry_after_ms ?? record.nextRetryAfterMs);
  if (nextRetryAfterMs !== undefined) entry.nextRetryAfterMs = nextRetryAfterMs;
  const totalAuths = optionalNumber(record.total_auths ?? record.totalAuths);
  if (totalAuths !== undefined) entry.totalAuths = totalAuths;
  const disabledCount = optionalNumber(record.disabled_count ?? record.disabledCount);
  if (disabledCount !== undefined) entry.disabledCount = disabledCount;
  const archivedCount = optionalNumber(record.archived_count ?? record.archivedCount);
  if (archivedCount !== undefined) entry.archivedCount = archivedCount;
  const blockedCount = optionalNumber(record.blocked_count ?? record.blockedCount);
  if (blockedCount !== undefined) entry.blockedCount = blockedCount;
  const coolingCount = optionalNumber(record.cooling_count ?? record.coolingCount);
  if (coolingCount !== undefined) entry.coolingCount = coolingCount;
  const modelStates = normalizeModelStates(record.model_states ?? record.modelStates);
  if (modelStates) entry.modelStates = modelStates;
  const auths = normalizeAuthStatuses(record.auths);
  if (auths) entry.auths = auths;

  return entry;
}

export function mergeRecentRequestBucketGroups(
  groups: RecentRequestBucket[][]
): RecentRequestBucket[] {
  const normalizedGroups = groups
    .map((group) => normalizeRecentRequestBuckets(group))
    .filter((group) => group.length > 0);

  if (normalizedGroups.length === 0) {
    return [];
  }

  const mergedLength = Math.min(
    RECENT_REQUEST_BLOCK_COUNT,
    Math.max(...normalizedGroups.map((group) => group.length))
  );
  const merged: RecentRequestBucket[] = Array.from({ length: mergedLength }, () => ({
    success: 0,
    failed: 0,
  }));

  normalizedGroups.forEach((group) => {
    const tail = group.slice(-mergedLength);
    const offset = mergedLength - tail.length;

    tail.forEach((bucket, index) => {
      const target = merged[offset + index];
      target.success += bucket.success;
      target.failed += bucket.failed;
      if (!target.time && bucket.time) {
        target.time = bucket.time;
      }
    });
  });

  return merged;
}

export function sumRecentRequests(buckets: RecentRequestBucket[]): {
  success: number;
  failure: number;
} {
  return normalizeRecentRequestBuckets(buckets).reduce(
    (total, bucket) => ({
      success: total.success + bucket.success,
      failure: total.failure + bucket.failed,
    }),
    { success: 0, failure: 0 }
  );
}

export function statusBarDataFromRecentRequests(buckets: RecentRequestBucket[]): StatusBarData {
  const normalizedBuckets = normalizeRecentRequestBuckets(buckets);
  const emptyBucketCount = Math.max(0, RECENT_REQUEST_BLOCK_COUNT - normalizedBuckets.length);
  const blockStats = [
    ...Array.from({ length: emptyBucketCount }, () => ({ success: 0, failed: 0 })),
    ...normalizedBuckets.slice(-RECENT_REQUEST_BLOCK_COUNT),
  ];

  const now = Date.now();
  const windowStart = now - RECENT_REQUEST_BLOCK_COUNT * RECENT_REQUEST_BLOCK_DURATION_MS;

  const blocks: StatusBlockState[] = [];
  const blockDetails: StatusBarData['blockDetails'] = [];
  let totalSuccess = 0;
  let totalFailure = 0;

  blockStats.forEach((bucket, index) => {
    const success = bucket.success;
    const failure = bucket.failed;
    const total = success + failure;

    totalSuccess += success;
    totalFailure += failure;

    if (total === 0) {
      blocks.push('idle');
    } else if (failure === 0) {
      blocks.push('success');
    } else if (success === 0) {
      blocks.push('failure');
    } else {
      blocks.push('mixed');
    }

    const blockStartTime = windowStart + index * RECENT_REQUEST_BLOCK_DURATION_MS;
    blockDetails.push({
      success,
      failure,
      rate: total > 0 ? success / total : -1,
      startTime: blockStartTime,
      endTime: blockStartTime + RECENT_REQUEST_BLOCK_DURATION_MS,
    });
  });

  const total = totalSuccess + totalFailure;

  return {
    blocks,
    blockDetails,
    successRate: total > 0 ? (totalSuccess / total) * 100 : 100,
    totalSuccess,
    totalFailure,
  };
}
