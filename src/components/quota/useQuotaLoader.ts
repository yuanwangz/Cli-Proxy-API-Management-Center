/**
 * Generic hook for quota data fetching and management.
 */

import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthFileItem } from '@/types';
import { useQuotaStore } from '@/stores';
import { quotaApi } from '@/services/api';
import { getStatusFromError } from '@/utils/quota';
import type { QuotaSnapshotRecord } from '@/types/quota';
import type { QuotaConfig } from './quotaConfigs';

type QuotaScope = 'page' | 'selected';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;

interface LoadQuotaResult<TState> {
  name: string;
  status: 'success' | 'error';
  state?: TState;
  error?: string;
  errorStatus?: number;
}

const resolveAuthIndex = (file: AuthFileItem): string => {
  const raw = file['auth_index'] ?? file.authIndex;
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const attachSnapshotMetadata = <TState,>(
  state: TState,
  snapshot?: QuotaSnapshotRecord | null
): TState => {
  if (!snapshot || state === null || typeof state !== 'object') return state;
  return {
    ...(state as Record<string, unknown>),
    refreshedAt: snapshot.refreshed_at ?? snapshot.refreshedAt,
    refreshedAtMs: snapshot.refreshed_at_ms ?? snapshot.refreshedAtMs,
  } as TState;
};

const attachRefreshMetadata = <TState,>(state: TState): TState => {
  if (state === null || typeof state !== 'object') return state;
  const record = state as Record<string, unknown>;
  const refreshedAtMs = record.refreshedAtMs;
  const refreshedAt = record.refreshedAt;
  if (
    (typeof refreshedAtMs === 'number' && Number.isFinite(refreshedAtMs) && refreshedAtMs > 0) ||
    (typeof refreshedAt === 'string' && refreshedAt.trim())
  ) {
    return state;
  }
  const now = new Date();
  return {
    ...record,
    refreshedAt: now.toISOString(),
    refreshedAtMs: now.getTime(),
  } as TState;
};

const saveQuotaSnapshot = async <TState, TData>(
  config: QuotaConfig<TState, TData>,
  file: AuthFileItem,
  state: TState
): Promise<TState> => {
  const authIndex = resolveAuthIndex(file);
  if (!authIndex) return state;

  try {
    const snapshot = await quotaApi.saveSnapshot({
      provider: config.type,
      authId: typeof file.id === 'string' ? file.id : undefined,
      authIndex,
      fileName: file.name,
      quota: state,
    });
    return attachSnapshotMetadata(state, snapshot);
  } catch {
    return state;
  }
};

export function useQuotaLoader<TState, TData>(config: QuotaConfig<TState, TData>) {
  const { t } = useTranslation();
  const quota = useQuotaStore(config.storeSelector);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;

  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);

  const loadQuota = useCallback(
    async (
      targets: AuthFileItem[],
      scope: QuotaScope,
      setLoading: (loading: boolean, scope?: QuotaScope | null) => void
    ) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      const requestId = ++requestIdRef.current;
      setLoading(true, scope);

      try {
        if (targets.length === 0) return;

        setQuota((prev) => {
          const nextState = { ...prev };
          targets.forEach((file) => {
            nextState[file.name] = config.buildLoadingState();
          });
          return nextState;
        });

        const results = await Promise.all(
          targets.map(async (file): Promise<LoadQuotaResult<TState>> => {
            try {
              const data = await config.fetchQuota(file, t);
              const state = config.buildSuccessState(data);
              const persistedState = await saveQuotaSnapshot(config, file, state);
              return {
                name: file.name,
                status: 'success',
                state: attachRefreshMetadata(persistedState),
              };
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : t('common.unknown_error');
              const errorStatus = getStatusFromError(err);
              return { name: file.name, status: 'error', error: message, errorStatus };
            }
          })
        );

        if (requestId !== requestIdRef.current) return;

        setQuota((prev) => {
          const nextState = { ...prev };
          results.forEach((result) => {
            if (result.status === 'success') {
              nextState[result.name] = result.state as TState;
            } else {
              nextState[result.name] = config.buildErrorState(
                result.error || t('common.unknown_error'),
                result.errorStatus
              );
            }
          });
          return nextState;
        });
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          loadingRef.current = false;
        }
      }
    },
    [config, setQuota, t]
  );

  return { quota, loadQuota };
}
