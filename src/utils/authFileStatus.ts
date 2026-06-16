import type { AuthFileItem } from '@/types/authFile';

const QUOTA_COOLDOWN_PATTERN =
  /(quota|exhaust|capacity|limit|rate|429|too many|credit|配额|额度|限流|冷却|资源耗尽|用量)/i;

export const readCredentialText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

export const parseCredentialTimeMs = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) return asNumber < 1e12 ? asNumber * 1000 : asNumber;
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

export const isCredentialDisabled = (file: AuthFileItem): boolean => {
  const raw = file.disabled as unknown;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') return raw.trim().toLowerCase() === 'true';
  return false;
};

export const isCredentialArchived = (file: AuthFileItem): boolean => {
  const raw = (file.archived ?? file['archived']) as unknown;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') return raw.trim().toLowerCase() === 'true';
  return false;
};

export const getCredentialNextRetryAt = (file: AuthFileItem): number =>
  parseCredentialTimeMs(file['next_retry_after'] ?? file.nextRetryAfter);

export const getCredentialStatusMessage = (file: AuthFileItem): string =>
  readCredentialText(file['status_message'] ?? file.statusMessage);

export const getCredentialStatusCode = (file: AuthFileItem): number => {
  const raw = file['status_code'] ?? file.statusCode;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : 0;
};

export const isQuotaCooldownMessage = (message: string): boolean =>
  QUOTA_COOLDOWN_PATTERN.test(message);

export const isCredentialCooling = (file: AuthFileItem, nowMs = Date.now()): boolean => {
  if (isCredentialArchived(file)) return false;
  if (isCredentialDisabled(file)) return false;
  const nextRetryAt = getCredentialNextRetryAt(file);
  return nextRetryAt > nowMs && isQuotaCooldownMessage(getCredentialStatusMessage(file));
};

export const isCredentialEffectivelyUnavailable = (
  file: AuthFileItem,
  nowMs = Date.now()
): boolean => {
  if (isCredentialArchived(file)) return true;
  if (isCredentialDisabled(file)) return true;
  const nextRetryAt = getCredentialNextRetryAt(file);
  if (nextRetryAt > nowMs) return true;
  if (nextRetryAt > 0 && nextRetryAt <= nowMs) return false;
  return Boolean(file.unavailable);
};

export const isCredentialEffectivelyAvailable = (file: AuthFileItem, nowMs = Date.now()): boolean =>
  !isCredentialArchived(file) &&
  !isCredentialDisabled(file) &&
  !isCredentialEffectivelyUnavailable(file, nowMs);

export const isCredentialQuotaLimited = (file: AuthFileItem, nowMs = Date.now()): boolean =>
  !isCredentialArchived(file) &&
  !isCredentialDisabled(file) &&
  (isCredentialCooling(file, nowMs) ||
    (getCredentialStatusCode(file) === 429 &&
      isQuotaCooldownMessage(getCredentialStatusMessage(file))));

export const isCredentialUnauthorized = (file: AuthFileItem): boolean => {
  if (isCredentialDisabled(file)) return false;
  if (getCredentialStatusCode(file) === 401) return true;
  const message = getCredentialStatusMessage(file).toLowerCase();
  return message === 'unauthorized' || message.includes('unauthorized');
};

export const normalizeCredentialProvider = (value: unknown): string => {
  const raw = readCredentialText(value).toLowerCase();
  if (!raw) return 'unknown';
  const normalized = raw.replace(/[_\s]+/g, '-');
  if (normalized === 'geminicli' || normalized === 'gemini-cli') return 'gemini-cli';
  return normalized;
};

export const credentialProviderKey = (file: AuthFileItem): string =>
  normalizeCredentialProvider(file.provider ?? file.type);

export const credentialMatchesSearch = (file: AuthFileItem, query: string): boolean => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  const fields = [
    file.name,
    file.id,
    file.label,
    file.account,
    file.email,
    file.note,
    file.type,
    file.provider,
    file['project_id'],
    file['account_type'],
  ];
  return fields
    .map(readCredentialText)
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(normalizedQuery));
};
