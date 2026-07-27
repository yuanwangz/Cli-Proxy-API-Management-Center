import type { TFunction } from 'i18next';
import type { AuthFileItem } from '@/types';
import { isArchivedAuthFile, isDisabledAuthFile } from '@/utils/quota';

export type CredentialInspectionStatus =
  | 'checking'
  | 'healthy'
  | 'limited'
  | 'reauth'
  | 'review'
  | 'unsupported'
  | 'error';

export type CredentialInspectionAction =
  | 'none'
  | 'enable'
  | 'disable'
  | 'unarchive'
  | 'restore'
  | 'reauth'
  | 'delete'
  | 'review';

export type CredentialInspectionScope = 'row' | 'page' | 'filtered' | 'selected' | 'auto';

export type CredentialInspectionResult = {
  name: string;
  provider: string;
  status: CredentialInspectionStatus;
  message: string;
  checkedAt: string;
  checkedAtMs: number;
  durationMs?: number;
  statusCode?: number;
  scope?: CredentialInspectionScope;
  action: CredentialInspectionAction;
  actionReason: string;
  evidence: string[];
  currentDisabled: boolean;
  currentArchived: boolean;
};

export type CredentialInspectionSummary = {
  total: number;
  checking: number;
  healthy: number;
  limited: number;
  reauth: number;
  review: number;
  unsupported: number;
  error: number;
};

export type InspectionOutcome = Pick<
  CredentialInspectionResult,
  'status' | 'message' | 'statusCode' | 'action' | 'actionReason' | 'evidence'
>;

type InspectionWindow = {
  id?: string;
  label?: string;
  usedPercent?: number | null;
  remainingFraction?: number | null;
  resetLabel?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const lifecycleRecoveryAction = (file: AuthFileItem): CredentialInspectionAction => {
  const archived = isArchivedAuthFile(file);
  const disabled = isDisabledAuthFile(file);
  if (archived && disabled) return 'restore';
  if (archived) return 'unarchive';
  if (disabled) return 'enable';
  return 'none';
};

const lifecycleActionReason = (action: CredentialInspectionAction, t: TFunction): string => {
  switch (action) {
    case 'restore':
      return t('auth_files.inspection_action_reason_restore');
    case 'unarchive':
      return t('auth_files.inspection_action_reason_unarchive');
    case 'enable':
      return t('auth_files.inspection_action_reason_enable');
    default:
      return t('auth_files.inspection_action_reason_none');
  }
};

const readWindows = (state: Record<string, unknown>): InspectionWindow[] => {
  const windows = Array.isArray(state.windows) ? state.windows : [];
  return windows.filter(isRecord).map((window) => ({
    id: typeof window.id === 'string' ? window.id : undefined,
    label: typeof window.label === 'string' ? window.label : undefined,
    usedPercent: finiteNumber(window.usedPercent),
    remainingFraction: finiteNumber(window.remainingFraction),
    resetLabel: typeof window.resetLabel === 'string' ? window.resetLabel : undefined,
  }));
};

const percentEvidence = (windows: InspectionWindow[]): string[] =>
  windows.flatMap((window) => {
    const percent = finiteNumber(window.usedPercent);
    if (percent === null) return [];
    const reset = window.resetLabel && window.resetLabel !== '-' ? ` · ${window.resetLabel}` : '';
    return [`${window.label || window.id || 'quota'}: ${Math.round(percent)}%${reset}`];
  });

const hasGenericQuotaEvidence = (provider: string, state: Record<string, unknown>): boolean => {
  if (readWindows(state).length > 0) return true;
  if (Array.isArray(state.buckets) && state.buckets.length > 0) return true;
  if (Array.isArray(state.rows) && state.rows.length > 0) return true;
  if (provider === 'antigravity' && Array.isArray(state.groups)) {
    return state.groups.some(
      (group) => isRecord(group) && Array.isArray(group.buckets) && group.buckets.length > 0
    );
  }
  return provider === 'xai' && isRecord(state.billing);
};

const hasKnownExhaustedQuota = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasKnownExhaustedQuota);
  if (!isRecord(value)) return false;
  const usedPercents = [
    finiteNumber(value.usedPercent),
    finiteNumber(value.usagePercent),
    finiteNumber(value.onDemandUsedPercent),
  ];
  if (usedPercents.some((percent) => percent !== null && percent >= 100)) return true;
  const remainingFraction = finiteNumber(value.remainingFraction);
  if (remainingFraction !== null && remainingFraction <= 0) return true;
  return Object.values(value).some((item) => {
    if (
      item === value.usedPercent ||
      item === value.usagePercent ||
      item === value.onDemandUsedPercent ||
      item === value.remainingFraction
    ) {
      return false;
    }
    return Array.isArray(item) || isRecord(item) ? hasKnownExhaustedQuota(item) : false;
  });
};

/**
 * Provider acceptance proves authentication, but recovery is recommended only
 * when the response also contains enough provider-specific quota evidence.
 */
export const classifySuccessfulInspection = (
  provider: string,
  state: Record<string, unknown>,
  file: AuthFileItem,
  t: TFunction
): InspectionOutcome => {
  const recoveryAction = lifecycleRecoveryAction(file);
  const baseEvidence = [t('auth_files.inspection_evidence_provider_accepted')];

  if (provider === 'codex') {
    const windows = readWindows(state);
    const fiveHour = windows.find((window) => window.id === 'five-hour');
    const longWindow = windows.find((window) => window.id === 'weekly' || window.id === 'monthly');
    const evidence = [...baseEvidence, ...percentEvidence(windows)];
    if (!longWindow || finiteNumber(longWindow.usedPercent) === null) {
      return {
        status: 'review',
        message: t('auth_files.inspection_codex_incomplete_quota'),
        action: 'review',
        actionReason: t('auth_files.inspection_action_reason_review'),
        evidence,
      };
    }
    if ((longWindow.usedPercent ?? 0) >= 100) {
      return {
        status: 'limited',
        message: t('auth_files.inspection_codex_long_window_exhausted'),
        action: 'none',
        actionReason: t('auth_files.inspection_action_reason_cooldown'),
        evidence,
      };
    }
    if ((fiveHour?.usedPercent ?? 0) >= 100) {
      return {
        status: 'limited',
        message: t('auth_files.inspection_codex_five_hour_exhausted'),
        action: 'none',
        actionReason: t('auth_files.inspection_action_reason_cooldown'),
        evidence,
      };
    }
    return {
      status: 'healthy',
      message: t('auth_files.inspection_codex_available'),
      action: recoveryAction,
      actionReason: lifecycleActionReason(recoveryAction, t),
      evidence,
    };
  }

  if (!hasGenericQuotaEvidence(provider, state)) {
    return {
      status: 'review',
      message: t('auth_files.inspection_incomplete_evidence'),
      action: 'review',
      actionReason: t('auth_files.inspection_action_reason_review'),
      evidence: baseEvidence,
    };
  }

  if (hasKnownExhaustedQuota(state)) {
    return {
      status: 'limited',
      message: t('auth_files.inspection_quota_exhausted'),
      action: 'none',
      actionReason: t('auth_files.inspection_action_reason_cooldown'),
      evidence: baseEvidence,
    };
  }

  return {
    status: 'healthy',
    message: t('auth_files.inspection_healthy_with_evidence'),
    action: recoveryAction,
    actionReason: lifecycleActionReason(recoveryAction, t),
    evidence: baseEvidence,
  };
};

const containsAny = (text: string, markers: string[]) =>
  markers.some((marker) => text.includes(marker));

/** Ambiguous status codes never disable credentials without provider-specific evidence. */
export const classifyInspectionFailure = (
  provider: string,
  file: AuthFileItem,
  statusCode: number | undefined,
  rawMessage: string,
  t: TFunction
): InspectionOutcome => {
  const message = rawMessage.trim() || t('common.unknown_error');
  const blob = message.toLowerCase();
  const evidence = [
    statusCode ? `HTTP ${statusCode}` : t('auth_files.inspection_evidence_request_failed'),
  ];

  if (
    statusCode === 402 &&
    provider === 'codex' &&
    containsAny(blob, ['deactivated_workspace', 'workspace deactivated'])
  ) {
    return {
      status: 'review',
      message: t('auth_files.inspection_workspace_deactivated'),
      statusCode,
      action: 'delete',
      actionReason: t('auth_files.inspection_action_reason_delete'),
      evidence,
    };
  }

  if (
    statusCode === 401 ||
    containsAny(blob, [
      'invalid_grant',
      'invalid_refresh_token',
      'refresh_token_reused',
      'token_revoked',
      'token has been invalidated',
      'invalid or expired credentials',
    ])
  ) {
    return {
      status: 'reauth',
      message: t('auth_files.inspection_auth_invalid'),
      statusCode: statusCode ?? 401,
      action: 'reauth',
      actionReason: t('auth_files.inspection_action_reason_reauth'),
      evidence,
    };
  }

  if (
    provider === 'xai' &&
    containsAny(blob, [
      'free-usage-exhausted',
      'included free usage',
      'spending-limit',
      'run out of credits',
      'used all available credits',
      'monthly spending limit',
    ])
  ) {
    return {
      status: 'limited',
      message: t('auth_files.inspection_xai_quota_exhausted'),
      statusCode,
      action: 'none',
      actionReason: t('auth_files.inspection_action_reason_cooldown'),
      evidence,
    };
  }

  if (statusCode === 429) {
    return {
      status: 'limited',
      message: t('auth_files.inspection_rate_limited'),
      statusCode,
      action: 'none',
      actionReason: t('auth_files.inspection_action_reason_retry_after_reset'),
      evidence,
    };
  }

  if (
    provider === 'xai' &&
    containsAny(blob, [
      'need a grok subscription',
      'no active grok subscription',
      'not entitled',
      'subscription required',
      'chat endpoint is denied',
    ])
  ) {
    const actionable = !isDisabledAuthFile(file) && !isArchivedAuthFile(file);
    return {
      status: 'review',
      message: t('auth_files.inspection_xai_entitlement_denied'),
      statusCode,
      action: actionable ? 'disable' : 'review',
      actionReason: actionable
        ? t('auth_files.inspection_action_reason_disable_entitlement')
        : t('auth_files.inspection_action_reason_review'),
      evidence,
    };
  }

  if (
    statusCode === 400 ||
    statusCode === 402 ||
    statusCode === 403 ||
    statusCode === 404 ||
    statusCode === 422 ||
    containsAny(blob, ['policy violation', 'usage guideline', 'permission-denied'])
  ) {
    return {
      status: 'review',
      message: t('auth_files.inspection_ambiguous_provider_error', {
        status: statusCode ?? '-',
      }),
      statusCode,
      action: 'review',
      actionReason: t('auth_files.inspection_action_reason_review'),
      evidence,
    };
  }

  return {
    status: 'error',
    message,
    statusCode,
    action: 'none',
    actionReason: t('auth_files.inspection_action_reason_retry'),
    evidence,
  };
};
