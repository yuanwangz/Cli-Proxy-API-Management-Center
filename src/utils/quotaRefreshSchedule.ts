import { parseTimestampMs } from '@/utils/timestamp';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';
import type { QuotaSnapshotRecord } from '@/types/quota';

export const QUOTA_REFRESH_GRACE_MS = 1000;

const NO_RESET_TIME = Number.POSITIVE_INFINITY;

export const normalizeQuotaProvider = (value: unknown): string => {
  const provider = normalizeOAuthProviderKey(String(value ?? ''));
  return provider === 'geminicli' ? 'gemini-cli' : provider;
};

const resetValueToMs = (value: unknown, nowMs: number): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }

  if (typeof value !== 'string') return NO_RESET_TIME;
  const text = value.trim();
  if (!text || text === '-') return NO_RESET_TIME;
  if (text === '<1m') return nowMs + 60_000;

  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  }

  const shortDateMatch = text.match(/^\d{1,2}[/-]\d{1,2}(?:\D+\d{1,2}:\d{2})?$/);
  if (shortDateMatch) {
    const parts = text.match(/^(\d{1,2})[/-](\d{1,2})(?:\D+(\d{1,2}):(\d{2}))?$/);
    if (parts) {
      const [, month, day, hour = '0', minute = '0'] = parts;
      const monthValue = Number(month);
      const dayValue = Number(day);
      const hourValue = Number(hour);
      const minuteValue = Number(minute);
      const validParts =
        monthValue >= 1 &&
        monthValue <= 12 &&
        dayValue >= 1 &&
        dayValue <= 31 &&
        hourValue >= 0 &&
        hourValue <= 23 &&
        minuteValue >= 0 &&
        minuteValue <= 59;
      if (validParts) {
        const now = new Date(nowMs);
        let date = new Date(now.getFullYear(), monthValue - 1, dayValue, hourValue, minuteValue);
        if (
          !Number.isNaN(date.getTime()) &&
          date.getMonth() === monthValue - 1 &&
          date.getDate() === dayValue
        ) {
          if (date.getTime() < nowMs - 180 * 24 * 60 * 60 * 1000) {
            date = new Date(
              now.getFullYear() + 1,
              monthValue - 1,
              dayValue,
              hourValue,
              minuteValue
            );
          } else if (date.getTime() > nowMs + 180 * 24 * 60 * 60 * 1000) {
            date = new Date(
              now.getFullYear() - 1,
              monthValue - 1,
              dayValue,
              hourValue,
              minuteValue
            );
          }
          return date.getTime();
        }
      }
    }
  }

  const parsed = parseTimestampMs(text);
  if (Number.isFinite(parsed)) return parsed;

  const zhDateMatch = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\D+(\d{1,2}):(\d{2}))?/);
  if (zhDateMatch) {
    const [, year, month, day, hour = '0', minute = '0'] = zhDateMatch;
    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute)
    );
    if (!Number.isNaN(date.getTime())) return date.getTime();
  }

  const hours = text.match(/(\d+)\s*h/i);
  const minutes = text.match(/(\d+)\s*m/i);
  if (hours || minutes) {
    const hourMs = hours ? Number(hours[1]) * 60 * 60 * 1000 : 0;
    const minuteMs = minutes ? Number(minutes[1]) * 60 * 1000 : 0;
    return nowMs + hourMs + minuteMs;
  }

  return NO_RESET_TIME;
};

const collectResetTimes = (value: unknown, nowMs: number, times: number[]) => {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectResetTimes(entry, nowMs, times));
    return;
  }
  if (typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  for (const key of [
    'resetAtMs',
    'resetAt',
    'reset_at',
    'resetTime',
    'reset_time',
    'resets_at',
    'resetLabel',
    'resetHint',
  ]) {
    const ms = resetValueToMs(record[key], nowMs);
    if (Number.isFinite(ms)) times.push(ms);
  }

  for (const key of ['resetAfterSeconds', 'reset_after_seconds', 'resetIn', 'reset_in', 'ttl']) {
    const raw = record[key];
    const seconds = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (Number.isFinite(seconds) && seconds > 0) times.push(nowMs + seconds * 1000);
  }

  for (const key of ['windows', 'groups', 'buckets', 'rows', 'rateLimitResetCredits']) {
    collectResetTimes(record[key], nowMs, times);
  }

  for (const key of ['expiresAt', 'expires_at']) {
    const ms = resetValueToMs(record[key], nowMs);
    if (Number.isFinite(ms) && record.status === 'available') times.push(ms);
  }
};

const collectProviderResetTimes = (provider: string, quota: unknown, nowMs: number) => {
  const record = quota as Record<string, unknown>;
  const times: number[] = [];

  switch (provider) {
    case 'claude':
      collectResetTimes({ windows: record.windows }, nowMs, times);
      break;
    case 'codex':
      collectResetTimes(
        { windows: record.windows, rateLimitResetCredits: record.rateLimitResetCredits },
        nowMs,
        times
      );
      break;
    case 'antigravity':
      collectResetTimes({ groups: record.groups }, nowMs, times);
      break;
    case 'gemini-cli':
      collectResetTimes({ buckets: record.buckets }, nowMs, times);
      break;
    case 'kimi':
      collectResetTimes({ rows: record.rows }, nowMs, times);
      break;
    case 'xai':
      if (
        record.billing &&
        typeof record.billing === 'object' &&
        (record.billing as { periodType?: unknown }).periodType === 'weekly'
      ) {
        collectResetTimes(record.billing, nowMs, times);
      }
      break;
    default:
      collectResetTimes(quota, nowMs, times);
  }

  return times;
};

export const nearestQuotaResetMs = (quota: unknown, nowMs: number, provider?: unknown): number => {
  if (!quota || typeof quota !== 'object' || Array.isArray(quota)) return NO_RESET_TIME;
  if ((quota as { status?: unknown }).status !== 'success') return NO_RESET_TIME;

  const times: number[] = [];
  if (provider) {
    times.push(...collectProviderResetTimes(normalizeQuotaProvider(provider), quota, nowMs));
  } else {
    collectResetTimes(quota, nowMs, times);
  }
  return times.length > 0 ? Math.min(...times) : NO_RESET_TIME;
};

const refreshedAtMs = (snapshot: QuotaSnapshotRecord): number => {
  const raw = snapshot.refreshed_at_ms ?? snapshot.refreshedAtMs;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const parsed = parseTimestampMs(snapshot.refreshed_at ?? snapshot.refreshedAt);
  return Number.isFinite(parsed) ? parsed : 0;
};

export interface QuotaRefreshPlan {
  refreshAtMs: number;
  resetAtMs: number;
}

export const getQuotaRefreshPlan = (
  snapshot: QuotaSnapshotRecord,
  nowMs: number
): QuotaRefreshPlan | null => {
  if (!snapshot.quota || typeof snapshot.quota !== 'object' || Array.isArray(snapshot.quota)) {
    return null;
  }
  if ((snapshot.quota as { status?: unknown }).status !== 'success') return null;

  const normalizedProvider = normalizeQuotaProvider(snapshot.provider);
  const times = collectProviderResetTimes(normalizedProvider, snapshot.quota, nowMs);
  if (times.length === 0) return null;

  const snapshotRefreshedAtMs = refreshedAtMs(snapshot);
  const expiredAfterSnapshot = times
    .filter(
      (value) =>
        value <= nowMs + QUOTA_REFRESH_GRACE_MS &&
        snapshotRefreshedAtMs > 0 &&
        value > snapshotRefreshedAtMs
    )
    .sort((left, right) => left - right)[0];
  if (Number.isFinite(expiredAfterSnapshot)) {
    return { refreshAtMs: nowMs, resetAtMs: expiredAfterSnapshot };
  }

  const upcoming = times
    .filter((value) => value > nowMs + QUOTA_REFRESH_GRACE_MS)
    .sort((left, right) => left - right)[0];
  if (Number.isFinite(upcoming)) {
    return { refreshAtMs: upcoming, resetAtMs: upcoming };
  }

  return null;
};
