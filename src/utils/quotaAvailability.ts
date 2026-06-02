import type { AuthFileItem } from '@/types/authFile';
import type { QuotaSnapshotRecord } from '@/types/quota';

export type QuotaAvailability = boolean | null;

const readQuotaNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const readQuotaBool = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(trimmed)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(trimmed)) return false;
  }
  return null;
};

const quotaValueAvailability = (value: unknown): QuotaAvailability => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  if (readQuotaBool(record.unlimited) === true) return true;

  const allowed = readQuotaBool(record.allowed);
  if (allowed !== null) return allowed;

  const limitReached = readQuotaBool(record.limitReached ?? record.limit_reached);
  if (limitReached !== null) return !limitReached;

  for (const key of ['usedPercent', 'used_percent', 'utilization']) {
    const value = readQuotaNumber(record[key]);
    if (value !== null) return value < 100;
  }

  for (const key of [
    'remainingFraction',
    'remaining_fraction',
    'remainingAmount',
    'remaining_amount',
    'remaining',
  ]) {
    const value = readQuotaNumber(record[key]);
    if (value !== null) return value > 0;
  }

  const used = readQuotaNumber(record.used);
  const limit = readQuotaNumber(record.limit);
  if (used !== null && limit !== null && limit > 0) {
    return used < limit;
  }

  return null;
};

const quotaAllLimitsAvailability = (value: unknown): QuotaAvailability => {
  if (!Array.isArray(value) || value.length === 0) return null;
  let found = false;
  for (const item of value) {
    const availability = quotaValueAvailability(item);
    if (availability === false) return false;
    if (availability === true) found = true;
  }
  return found ? true : null;
};

const quotaAnyLimitAvailability = (value: unknown): QuotaAvailability => {
  let foundExhausted = false;

  const visit = (entry: unknown): boolean => {
    if (!entry) return false;
    if (Array.isArray(entry)) return entry.some(visit);
    if (typeof entry !== 'object') return false;

    const availability = quotaValueAvailability(entry);
    if (availability === true) return true;
    if (availability === false) foundExhausted = true;

    return Object.values(entry as Record<string, unknown>).some(visit);
  };

  if (visit(value)) return true;
  return foundExhausted ? false : null;
};

export const quotaHasAvailableCapacity = (quota: unknown): QuotaAvailability => {
  if (!quota || typeof quota !== 'object' || Array.isArray(quota)) return null;
  const record = quota as Record<string, unknown>;
  if (String(record.status ?? '').trim().toLowerCase() !== 'success') return null;

  for (const key of ['windows', 'rows']) {
    const availability = quotaAllLimitsAvailability(record[key]);
    if (availability !== null) return availability;
  }

  const billingAvailability = quotaValueAvailability(record.billing);
  if (billingAvailability !== null) return billingAvailability;

  for (const key of ['groups', 'buckets']) {
    const availability = quotaAnyLimitAvailability(record[key]);
    if (availability !== null) return availability;
  }

  return quotaAnyLimitAvailability(record);
};

export const resolveCredentialAuthIndex = (file: AuthFileItem): string => {
  const raw = file['auth_index'] ?? file.authIndex;
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

export const quotaSnapshotAuthIndex = (snapshot: QuotaSnapshotRecord): string =>
  String(snapshot.auth_index ?? snapshot.authIndex ?? '').trim();

const quotaSnapshotRefreshedAtMs = (snapshot: QuotaSnapshotRecord): number => {
  const raw = snapshot.refreshed_at_ms ?? snapshot.refreshedAtMs;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const parsed = Date.parse(String(snapshot.refreshed_at ?? snapshot.refreshedAt ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

export const buildQuotaAvailabilityByAuthIndex = (
  snapshots: QuotaSnapshotRecord[]
): Map<string, QuotaAvailability> => {
  const latestByAuthIndex = new Map<
    string,
    { availability: QuotaAvailability; refreshedAtMs: number }
  >();

  snapshots.forEach((snapshot) => {
    const authIndex = quotaSnapshotAuthIndex(snapshot);
    if (!authIndex) return;

    const availability = quotaHasAvailableCapacity(snapshot.quota);
    if (availability === null) return;

    const refreshedAtMs = quotaSnapshotRefreshedAtMs(snapshot);
    const existing = latestByAuthIndex.get(authIndex);
    if (existing && existing.refreshedAtMs > refreshedAtMs) return;

    latestByAuthIndex.set(authIndex, { availability, refreshedAtMs });
  });

  return new Map(
    Array.from(latestByAuthIndex.entries()).map(([authIndex, value]) => [
      authIndex,
      value.availability,
    ])
  );
};
