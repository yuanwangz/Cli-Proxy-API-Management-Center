/**
 * Generic quota card component.
 */

import { useTranslation } from 'react-i18next';
import type { ReactElement, ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import type { AuthFileItem, CredentialTokenUsage, ResolvedTheme, ThemeColors } from '@/types';
import {
  getCredentialNextRetryAt,
  getCredentialStatusMessage,
  isCredentialArchived,
  isCredentialDisabled,
  isQuotaCooldownMessage,
} from '@/utils/authFileStatus';
import { TYPE_COLORS, normalizePlanType, resolveCodexPlanType } from '@/utils/quota';
import { formatNumber } from '@/utils/format';
import { formatCompactNumber } from '@/utils/usageAnalytics';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaStatus = 'idle' | 'loading' | 'success' | 'error';

export interface QuotaStatusState {
  status: QuotaStatus;
  refreshedAt?: string;
  refreshedAtMs?: number;
  error?: string;
  errorStatus?: number;
}

export interface QuotaProgressBarProps {
  percent: number | null;
  highThreshold: number;
  mediumThreshold: number;
}

export function QuotaProgressBar({
  percent,
  highThreshold,
  mediumThreshold,
}: QuotaProgressBarProps) {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const normalized = percent === null ? null : clamp(percent, 0, 100);
  const fillClass =
    normalized === null
      ? styles.quotaBarFillMedium
      : normalized >= highThreshold
        ? styles.quotaBarFillHigh
        : normalized >= mediumThreshold
          ? styles.quotaBarFillMedium
          : styles.quotaBarFillLow;
  const widthPercent = Math.round(normalized ?? 0);

  return (
    <div className={styles.quotaBar}>
      <div
        className={`${styles.quotaBarFill} ${fillClass}`}
        style={{ width: `${widthPercent}%` }}
      />
    </div>
  );
}

export interface QuotaRenderHelpers {
  styles: typeof styles;
  QuotaProgressBar: (props: QuotaProgressBarProps) => ReactElement;
}

interface QuotaCardProps<TState extends QuotaStatusState> {
  item: AuthFileItem;
  quota?: TState;
  resolvedTheme: ResolvedTheme;
  i18nPrefix: string;
  cardIdleMessageKey?: string;
  cardClassName: string;
  defaultType: string;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  tokenUsage?: CredentialTokenUsage;
  canRefresh?: boolean;
  onRefresh?: () => void;
  resetQuotaAction?: ReactNode;
  renderQuotaItems: (quota: TState, t: TFunction, helpers: QuotaRenderHelpers) => ReactNode;
}

export function QuotaCard<TState extends QuotaStatusState>({
  item,
  quota,
  resolvedTheme,
  i18nPrefix,
  cardIdleMessageKey,
  cardClassName,
  defaultType,
  selected = false,
  onSelectedChange,
  tokenUsage,
  canRefresh = false,
  onRefresh,
  resetQuotaAction,
  renderQuotaItems,
}: QuotaCardProps<TState>) {
  const { t } = useTranslation();

  const displayType = item.type || item.provider || defaultType;
  const typeColorSet = TYPE_COLORS[displayType] || TYPE_COLORS.unknown;
  const typeColor: ThemeColors =
    resolvedTheme === 'dark' && typeColorSet.dark ? typeColorSet.dark : typeColorSet.light;

  const quotaStatus = quota?.status ?? 'idle';
  const quotaLoading = quotaStatus === 'loading';
  const quotaErrorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );
  const idleMessageKey = cardIdleMessageKey ?? `${i18nPrefix}.idle`;
  const credentialDisplay = resolveCredentialDisplay(item, defaultType);
  const statusLabel = resolveStatusLabel(item, t);
  const refreshedAt = formatRefreshedAt(quota, t);
  const tokenSummary = normalizeTokenUsage(tokenUsage);
  const credentialPlan = resolveCredentialPlanLabel(item, quota, displayType, t);

  const getTypeLabel = (type: string): string => {
    const key = `auth_files.filter_${type}`;
    const translated = t(key);
    if (translated !== key) return translated;
    if (type.toLowerCase() === 'iflow') return 'iFlow';
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  return (
    <div className={`${styles.quotaListRow} ${cardClassName}`}>
      <label className={styles.rowSelect}>
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelectedChange?.(event.target.checked)}
          aria-label={t('quota_management.select_credential', { name: item.name })}
        />
      </label>

      <div className={styles.credentialCell}>
        <span
          className={styles.typeBadge}
          style={{
            backgroundColor: typeColor.bg,
            color: typeColor.text,
            ...(typeColor.border ? { border: typeColor.border } : {}),
          }}
        >
          {getTypeLabel(displayType)}
        </span>
        <div className={styles.credentialText}>
          <span className={styles.fileName} title={credentialDisplay.title}>
            {credentialDisplay.primary}
          </span>
          {(credentialDisplay.secondary || credentialPlan || statusLabel) && (
            <span className={styles.credentialMeta}>
              {credentialDisplay.secondary && (
                <span className={styles.credentialAccount} title={credentialDisplay.secondary}>
                  {credentialDisplay.secondary}
                </span>
              )}
              {credentialPlan && (
                <span
                  className={`${styles.credentialPlanBadge} ${
                    credentialPlan.premium ? styles.credentialPlanBadgePremium : ''
                  }`}
                >
                  {credentialPlan.label}
                </span>
              )}
              {statusLabel && <span className={styles.credentialStatus}>{statusLabel}</span>}
            </span>
          )}
        </div>
      </div>

      <div className={styles.quotaSection}>
        {quotaLoading ? (
          <div className={styles.quotaMessage}>{t(`${i18nPrefix}.loading`)}</div>
        ) : quotaStatus === 'idle' ? (
          <div className={styles.quotaMessage}>{t(idleMessageKey)}</div>
        ) : quotaStatus === 'error' ? (
          <div className={styles.quotaError}>
            {t(`${i18nPrefix}.load_failed`, {
              message: quotaErrorMessage,
            })}
          </div>
        ) : quota ? (
          renderQuotaItems(quota, t, { styles, QuotaProgressBar })
        ) : (
          <div className={styles.quotaMessage}>{t(idleMessageKey)}</div>
        )}
      </div>

      <div className={styles.tokenCell}>
        <strong title={formatNumber(tokenSummary.totalTokens)}>
          {formatCompactNumber(tokenSummary.totalTokens)}
        </strong>
        <span>{t('quota_management.token_total')}</span>
        <em>
          {t('quota_management.token_request_summary', {
            requests: formatNumber(tokenSummary.requestCount),
            failed: formatNumber(tokenSummary.failureCount),
          })}
        </em>
      </div>

      <div className={styles.snapshotCell}>
        <strong title={refreshedAt.title}>{refreshedAt.label}</strong>
        {(resetQuotaAction || (onRefresh && quotaStatus !== 'idle')) && (
          <div className={styles.quotaCardActions}>
            {resetQuotaAction}
            {onRefresh && quotaStatus !== 'idle' && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className={styles.quotaRefreshButton}
                onClick={onRefresh}
                disabled={!canRefresh || quotaLoading}
                loading={quotaLoading}
                title={t('auth_files.quota_refresh_hint')}
              >
                {!quotaLoading && <IconRefreshCw size={14} />}
                {t('auth_files.quota_refresh_single')}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const trimFileAffixes = (name: string, provider: string): string => {
  const withoutExt = name.replace(/\.json$/i, '');
  const providerPrefix = provider
    ? new RegExp(`^${provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[-_.]?`, 'i')
    : null;
  return (providerPrefix ? withoutExt.replace(providerPrefix, '') : withoutExt)
    .replace(/-(free|plus|pro|team|default)$/i, '')
    .trim();
};

const splitAccountLabel = (account: string): { primary: string; secondary: string } => {
  const match = account.match(/^(.+?)\s*\((.+)\)\s*$/);
  if (!match) return { primary: account, secondary: '' };
  return {
    primary: match[1].trim(),
    secondary: match[2].trim(),
  };
};

const resolveCredentialDisplay = (
  item: AuthFileItem,
  defaultType: string
): { primary: string; secondary: string; title: string } => {
  const account = resolveAccountLabel(item);
  const fileLabel = trimFileAffixes(item.name, String(item.type || item.provider || defaultType));
  if (account) {
    const split = splitAccountLabel(account);
    const title = split.secondary
      ? `${split.primary} (${split.secondary})\n${item.name}`
      : `${split.primary}\n${item.name}`;
    return { ...split, title };
  }
  return {
    primary: fileLabel || item.name,
    secondary: '',
    title: item.name,
  };
};

const resolveAccountLabel = (item: AuthFileItem): string => {
  const candidates = [item.account, item.email, item.label, item.id];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const resolveStatusLabel = (item: AuthFileItem, t: TFunction): string => {
  if (isCredentialArchived(item)) return t('quota_management.status_archived');
  if (isCredentialDisabled(item)) return t('quota_management.status_disabled');
  const nowMs = Date.now();
  const nextRetryAt = getCredentialNextRetryAt(item);
  const message = getCredentialStatusMessage(item);
  if (nextRetryAt > 0 && nextRetryAt <= nowMs && isQuotaCooldownMessage(message)) {
    return '';
  }
  if (item.unavailable && (nextRetryAt === 0 || nextRetryAt > nowMs)) {
    if (message) return message;
    return t('quota_management.status_unavailable');
  }
  if (message) return message;
  if (typeof item.status === 'string' && item.status.trim()) return item.status.trim();
  return '';
};

const readRecordString = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const resolveCredentialPlanLabel = (
  item: AuthFileItem,
  quota: QuotaStatusState | undefined,
  displayType: string,
  t: TFunction
): { label: string; premium: boolean } | null => {
  const quotaRecord =
    quota && typeof quota === 'object' ? (quota as unknown as Record<string, unknown>) : {};
  const normalizedType = displayType.toLowerCase();

  if (normalizedType === 'codex') {
    const normalized = normalizePlanType(
      readRecordString(quotaRecord, 'planType') ??
        readRecordString(quotaRecord, 'plan_type') ??
        resolveCodexPlanType(item)
    );
    if (!normalized) return null;
    if (normalized === 'pro') {
      return { label: t('codex_quota.plan_pro'), premium: true };
    }
    if (['prolite', 'pro-lite', 'pro_lite'].includes(normalized)) {
      return { label: t('codex_quota.plan_prolite'), premium: true };
    }
    if (normalized === 'plus') return { label: t('codex_quota.plan_plus'), premium: false };
    if (normalized === 'team') return { label: t('codex_quota.plan_team'), premium: false };
    if (normalized === 'free') return { label: t('codex_quota.plan_free'), premium: false };
    return { label: normalized, premium: false };
  }

  if (normalizedType === 'claude') {
    const planType =
      readRecordString(quotaRecord, 'planType') ?? readRecordString(quotaRecord, 'plan_type');
    if (!planType) return null;
    const key = planType.startsWith('plan_')
      ? `claude_quota.${planType}`
      : `claude_quota.plan_${planType}`;
    const translated = t(key);
    return { label: translated === key ? planType : translated, premium: planType !== 'plan_free' };
  }

  if (normalizedType === 'gemini-cli') {
    const tierLabel =
      readRecordString(quotaRecord, 'tierLabel') ?? readRecordString(quotaRecord, 'tier_label');
    if (!tierLabel) return null;
    const tierId =
      readRecordString(quotaRecord, 'tierId') ?? readRecordString(quotaRecord, 'tier_id');
    return { label: tierLabel, premium: tierId === 'g1-ultra-tier' };
  }

  return null;
};

const formatRefreshedAt = (
  quota: QuotaStatusState | undefined,
  t: TFunction
): { label: string; title: string } => {
  const value = quota?.refreshedAt ?? quota?.refreshedAtMs;
  const fallback = t('quota_management.never_refreshed');
  if (!value) return { label: fallback, title: fallback };
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return { label: fallback, title: fallback };
  const title = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  const label = new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  return { label, title };
};

const readUsageNumber = (
  usage: CredentialTokenUsage | undefined,
  snakeKey: keyof CredentialTokenUsage,
  camelKey: keyof CredentialTokenUsage
): number => {
  const raw = usage?.[snakeKey] ?? usage?.[camelKey];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
};

const normalizeTokenUsage = (usage?: CredentialTokenUsage) => ({
  requestCount: readUsageNumber(usage, 'request_count', 'requestCount'),
  failureCount: readUsageNumber(usage, 'failure_count', 'failureCount'),
  totalTokens: readUsageNumber(usage, 'total_tokens', 'totalTokens'),
});

const resolveQuotaErrorMessage = (
  t: TFunction,
  status: number | undefined,
  fallback: string
): string => {
  if (status === 404) return t('common.quota_update_required');
  if (status === 403) return t('common.quota_check_credential');
  return fallback;
};
