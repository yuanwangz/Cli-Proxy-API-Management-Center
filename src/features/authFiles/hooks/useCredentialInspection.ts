import { useCallback, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG,
  XAI_CONFIG,
} from '@/components/quota';
import type { QuotaStatusState } from '@/components/quota/QuotaCard';
import { quotaApi } from '@/services/api';
import type { AuthFileItem } from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import {
  getStatusFromError,
  isArchivedAuthFile,
  isDisabledAuthFile,
  isRuntimeOnlyAuthFile,
  resolveAuthProvider,
} from '@/utils/quota';
import {
  classifyInspectionFailure,
  classifySuccessfulInspection,
  type CredentialInspectionResult,
  type CredentialInspectionScope,
  type CredentialInspectionSummary,
  type InspectionOutcome,
} from '@/features/authFiles/credentialInspection';

export type {
  CredentialInspectionAction,
  CredentialInspectionResult,
  CredentialInspectionScope,
  CredentialInspectionStatus,
  CredentialInspectionSummary,
} from '@/features/authFiles/credentialInspection';

type InspectableQuotaConfig = {
  type: string;
  fetchQuota: (file: AuthFileItem, t: TFunction) => Promise<unknown>;
  buildSuccessState: (data: unknown) => QuotaStatusState & Record<string, unknown>;
};

type InspectionTarget = {
  file: AuthFileItem;
  config: InspectableQuotaConfig;
  authIndex: string;
};

const INSPECTION_CONCURRENCY = 3;

const QUOTA_CONFIGS = [
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG,
  XAI_CONFIG,
] as readonly unknown[] as readonly InspectableQuotaConfig[];

const QUOTA_CONFIG_BY_PROVIDER = new Map<string, InspectableQuotaConfig>(
  QUOTA_CONFIGS.map((config) => [config.type, config])
);

const emptySummary = (): CredentialInspectionSummary => ({
  total: 0,
  checking: 0,
  healthy: 0,
  limited: 0,
  reauth: 0,
  review: 0,
  unsupported: 0,
  error: 0,
});

export const summarizeCredentialInspection = (
  results: CredentialInspectionResult[]
): CredentialInspectionSummary =>
  results.reduce<CredentialInspectionSummary>((summary, result) => {
    summary.total += 1;
    summary[result.status] += 1;
    return summary;
  }, emptySummary());

const uniqueFilesByName = (files: AuthFileItem[]): AuthFileItem[] => {
  const seen = new Set<string>();
  const unique: AuthFileItem[] = [];

  files.forEach((file) => {
    const name = String(file.name ?? '').trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    unique.push(file);
  });

  return unique;
};

export const isCredentialInspectionSupported = (file: AuthFileItem): boolean => {
  if (isRuntimeOnlyAuthFile(file)) return false;
  const provider = resolveAuthProvider(file);
  return QUOTA_CONFIG_BY_PROVIDER.has(provider);
};

const inspectViaQuota = async (
  target: InspectionTarget,
  t: TFunction
): Promise<InspectionOutcome> => {
  try {
    const data = await target.config.fetchQuota(target.file, t);
    const checkedAt = new Date().toISOString();
    const state = {
      ...target.config.buildSuccessState(data),
      refreshedAt: checkedAt,
      refreshedAtMs: Date.now(),
    };

    await quotaApi
      .saveSnapshot({
        provider: target.config.type,
        authId: typeof target.file.id === 'string' ? target.file.id : undefined,
        authIndex: target.authIndex,
        fileName: target.file.name,
        quota: state,
      })
      .catch(() => {});

    return classifySuccessfulInspection(target.config.type, state, target.file, t);
  } catch (err: unknown) {
    const statusCode = getStatusFromError(err);
    const message = err instanceof Error ? err.message : t('common.unknown_error');
    return classifyInspectionFailure(target.config.type, target.file, statusCode, message, t);
  }
};

export function useCredentialInspection() {
  const { t } = useTranslation();
  const [resultsByName, setResultsByName] = useState<Record<string, CredentialInspectionResult>>(
    {}
  );
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const runIdRef = useRef(0);

  const activeResults = useMemo(() => Object.values(resultsByName), [resultsByName]);
  const summary = useMemo(() => summarizeCredentialInspection(activeResults), [activeResults]);

  const clearResults = useCallback(() => {
    setResultsByName({});
    setProgress({ completed: 0, total: 0 });
  }, []);

  const runInspection = useCallback(
    async (
      files: AuthFileItem[],
      scope: CredentialInspectionScope
    ): Promise<CredentialInspectionSummary> => {
      if (running) return summary;

      const uniqueFiles = uniqueFilesByName(files);
      const runId = runIdRef.current + 1;
      runIdRef.current = runId;

      if (uniqueFiles.length === 0) {
        setProgress({ completed: 0, total: 0 });
        return emptySummary();
      }

      setRunning(true);
      setProgress({ completed: 0, total: uniqueFiles.length });

      const collected: CredentialInspectionResult[] = [];
      const pending: Record<string, CredentialInspectionResult> = {};
      const targets: InspectionTarget[] = [];
      const now = new Date();
      const nowIso = now.toISOString();
      const nowMs = now.getTime();

      const pushResult = (result: CredentialInspectionResult) => {
        collected.push(result);
        setResultsByName((prev) => ({ ...prev, [result.name]: result }));
      };

      const completeOne = () => {
        if (runIdRef.current !== runId) return;
        setProgress((prev) => ({
          total: prev.total,
          completed: Math.min(prev.total, prev.completed + 1),
        }));
      };

      uniqueFiles.forEach((file) => {
        const name = String(file.name ?? '').trim();
        const provider = resolveAuthProvider(file);
        const base = {
          name,
          provider,
          checkedAt: nowIso,
          checkedAtMs: nowMs,
          scope,
          action: 'none' as const,
          actionReason: t('auth_files.inspection_action_reason_none'),
          evidence: [] as string[],
          currentDisabled: isDisabledAuthFile(file),
          currentArchived: isArchivedAuthFile(file),
        };

        if (isRuntimeOnlyAuthFile(file)) {
          pushResult({
            ...base,
            status: 'unsupported',
            message: t('auth_files.inspection_virtual_skipped'),
          });
          completeOne();
          return;
        }

        const config = QUOTA_CONFIG_BY_PROVIDER.get(provider);
        if (!config) {
          pushResult({
            ...base,
            status: 'unsupported',
            message: t('auth_files.inspection_unsupported_provider'),
          });
          completeOne();
          return;
        }

        const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
        if (!authIndex) {
          pushResult({
            ...base,
            status: 'error',
            message: t('auth_files.inspection_missing_auth_index'),
            action: 'review',
            actionReason: t('auth_files.inspection_action_reason_review'),
            evidence: [t('auth_files.inspection_missing_auth_index')],
          });
          completeOne();
          return;
        }

        pending[name] = {
          ...base,
          status: 'checking',
          message: t('auth_files.inspection_checking'),
        };
        targets.push({ file, config, authIndex });
      });

      if (Object.keys(pending).length > 0) {
        setResultsByName((prev) => ({ ...prev, ...pending }));
      }

      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(INSPECTION_CONCURRENCY, Math.max(1, targets.length)) },
        async () => {
          while (cursor < targets.length) {
            const target = targets[cursor];
            cursor += 1;

            const start = performance.now();
            const checkedAt = new Date();
            const checkedAtIso = checkedAt.toISOString();
            const checkedAtMs = checkedAt.getTime();
            const provider = target.config.type;
            const name = target.file.name;

            try {
              const outcome = await inspectViaQuota(target, t);

              pushResult({
                name,
                provider,
                status: outcome.status,
                message: outcome.message,
                checkedAt: checkedAtIso,
                checkedAtMs,
                durationMs: Math.round(performance.now() - start),
                statusCode: outcome.statusCode,
                scope,
                action: outcome.action,
                actionReason: outcome.actionReason,
                evidence: outcome.evidence,
                currentDisabled: isDisabledAuthFile(target.file),
                currentArchived: isArchivedAuthFile(target.file),
              });
            } catch (err: unknown) {
              const statusCode = getStatusFromError(err);
              const message = err instanceof Error ? err.message : t('common.unknown_error');
              const outcome = classifyInspectionFailure(
                provider,
                target.file,
                statusCode,
                message,
                t
              );

              pushResult({
                name,
                provider,
                status: outcome.status,
                message: outcome.message,
                checkedAt: checkedAtIso,
                checkedAtMs,
                durationMs: Math.round(performance.now() - start),
                statusCode: outcome.statusCode,
                scope,
                action: outcome.action,
                actionReason: outcome.actionReason,
                evidence: outcome.evidence,
                currentDisabled: isDisabledAuthFile(target.file),
                currentArchived: isArchivedAuthFile(target.file),
              });
            } finally {
              completeOne();
            }
          }
        }
      );

      await Promise.all(workers);

      if (runIdRef.current === runId) {
        setRunning(false);
        setProgress((prev) => ({ total: prev.total, completed: prev.total }));
      }

      return summarizeCredentialInspection(collected);
    },
    [running, summary, t]
  );

  return {
    resultsByName,
    summary,
    running,
    progress,
    clearResults,
    runInspection,
  };
}
