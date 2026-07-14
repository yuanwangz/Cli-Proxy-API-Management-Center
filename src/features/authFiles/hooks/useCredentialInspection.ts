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
import { probeXaiCredential } from '@/utils/xaiInspection';

export type CredentialInspectionStatus =
  | 'checking'
  | 'healthy'
  | 'limited'
  | 'disabled'
  | 'unsupported'
  | 'error';

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
};

export type CredentialInspectionSummary = {
  total: number;
  checking: number;
  healthy: number;
  limited: number;
  disabled: number;
  unsupported: number;
  error: number;
};

type InspectableQuotaConfig = {
  type: string;
  fetchQuota: (file: AuthFileItem, t: TFunction) => Promise<unknown>;
  buildSuccessState: (data: unknown) => QuotaStatusState;
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
  disabled: 0,
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
  if (isRuntimeOnlyAuthFile(file) || isArchivedAuthFile(file) || isDisabledAuthFile(file)) {
    return false;
  }
  const provider = resolveAuthProvider(file);
  return QUOTA_CONFIG_BY_PROVIDER.has(provider);
};

const inspectViaQuota = async (
  target: InspectionTarget,
  t: TFunction
): Promise<{
  status: CredentialInspectionStatus;
  message: string;
  statusCode?: number;
}> => {
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

    return {
      status: 'healthy',
      message: t('auth_files.inspection_healthy'),
    };
  } catch (err: unknown) {
    const statusCode = getStatusFromError(err);
    const message = err instanceof Error ? err.message : t('common.unknown_error');
    const status: CredentialInspectionStatus =
      statusCode === 401 ? 'disabled' : statusCode === 429 ? 'limited' : 'error';

    return {
      status,
      message:
        statusCode === 401
          ? t('auth_files.inspection_unauthorized_disabled')
          : statusCode === 429
            ? t('auth_files.inspection_rate_limited')
            : message,
      statusCode,
    };
  }
};

const inspectXaiCredential = async (
  target: InspectionTarget,
  t: TFunction
): Promise<{
  status: CredentialInspectionStatus;
  message: string;
  statusCode?: number;
}> => {
  const outcome = await probeXaiCredential(target.file, target.authIndex);
  const message = t(`auth_files.${outcome.reasonKey}`, {
    defaultValue: outcome.reasonFallback,
  });

  // Best-effort billing snapshot when chat is healthy so quota page still gets data.
  if (outcome.uiStatus === 'healthy') {
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
    } catch {
      // Chat healthy is authoritative; billing failure must not flip status.
    }
  }

  return {
    status: outcome.uiStatus,
    message,
    statusCode: outcome.httpStatus,
  };
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
        const base = { name, provider, checkedAt: nowIso, checkedAtMs: nowMs, scope };

        if (isRuntimeOnlyAuthFile(file)) {
          pushResult({
            ...base,
            status: 'unsupported',
            message: t('auth_files.inspection_virtual_skipped'),
          });
          completeOne();
          return;
        }

        if (isArchivedAuthFile(file)) {
          pushResult({
            ...base,
            status: 'unsupported',
            message: t('auth_files.inspection_archived_skipped'),
          });
          completeOne();
          return;
        }

        if (isDisabledAuthFile(file)) {
          pushResult({
            ...base,
            status: 'disabled',
            message: t('auth_files.inspection_disabled_skipped'),
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
              const outcome =
                provider === 'xai'
                  ? await inspectXaiCredential(target, t)
                  : await inspectViaQuota(target, t);

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
              });
            } catch (err: unknown) {
              const statusCode = getStatusFromError(err);
              const message = err instanceof Error ? err.message : t('common.unknown_error');
              const status: CredentialInspectionStatus =
                statusCode === 401 ? 'disabled' : statusCode === 429 ? 'limited' : 'error';

              pushResult({
                name,
                provider,
                status,
                message:
                  statusCode === 401
                    ? t('auth_files.inspection_unauthorized_disabled')
                    : statusCode === 429
                      ? t('auth_files.inspection_rate_limited')
                      : message,
                checkedAt: checkedAtIso,
                checkedAtMs,
                durationMs: Math.round(performance.now() - start),
                statusCode,
                scope,
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
