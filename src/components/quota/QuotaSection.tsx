/**
 * Generic quota section component.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useNotificationStore,
  useQuotaStore,
  useThemeStore,
} from '@/stores';
import type { AuthFileItem, ResolvedTheme } from '@/types';
import type { CredentialTokenUsage, QuotaSnapshotRecord } from '@/types/quota';
import {
  credentialMatchesSearch,
  getCredentialNextRetryAt,
  isCredentialArchived,
  isCredentialDisabled,
  isCredentialEffectivelyAvailable,
  isCredentialQuotaLimited,
  isCredentialUnauthorized,
} from '@/utils/authFileStatus';
import { quotaHasAvailableCapacity, type QuotaAvailability } from '@/utils/quotaAvailability';
import { parseTimestampMs } from '@/utils/timestamp';
import {
  nearestQuotaResetMs,
  normalizeQuotaProvider,
  QUOTA_REFRESH_GRACE_MS,
} from '@/utils/quotaRefreshSchedule';
import { QuotaCard } from './QuotaCard';
import type { QuotaStatusState } from './QuotaCard';
import { useQuotaLoader } from './useQuotaLoader';
import type { RegisterQuotaRefreshHandler } from './useQuotaRefreshCoordinator';
import type { QuotaConfig } from './quotaConfigs';
import { IconChevronDown, IconRefreshCw, IconSearch, IconX } from '@/components/ui/icons';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;

type QuotaScope = 'page' | 'selected';
type AvailabilityFilter = 'all' | 'available' | 'unavailable';
type ResetSortMode = 'default' | 'reset_asc';

const PAGE_SIZE_OPTIONS = [10, 25, 50];
const AVAILABILITY_FILTERS: AvailabilityFilter[] = ['all', 'available', 'unavailable'];
const RESET_SORT_OPTIONS: ResetSortMode[] = ['default', 'reset_asc'];

interface QuotaPaginationState<T> {
  pageSize: number;
  totalPages: number;
  currentPage: number;
  pageItems: T[];
  setPageSize: (size: number) => void;
  goToFirst: () => void;
  goToPrev: () => void;
  goToNext: () => void;
  goToLast: () => void;
  loading: boolean;
  loadingScope: QuotaScope | null;
  setLoading: (loading: boolean, scope?: QuotaScope | null) => void;
}

const useQuotaPagination = <T,>(
  items: T[],
  defaultPageSize = PAGE_SIZE_OPTIONS[1]
): QuotaPaginationState<T> => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(defaultPageSize);
  const [loading, setLoadingState] = useState(false);
  const [loadingScope, setLoadingScope] = useState<QuotaScope | null>(null);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(items.length / pageSize)),
    [items.length, pageSize]
  );

  const currentPage = useMemo(() => Math.min(page, totalPages), [page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, currentPage, pageSize]);

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size);
    setPage(1);
  }, []);

  const goToFirst = useCallback(() => setPage(1), []);

  const goToPrev = useCallback(() => {
    setPage((prev) => Math.max(1, prev - 1));
  }, []);

  const goToNext = useCallback(() => {
    setPage((prev) => Math.min(totalPages, prev + 1));
  }, [totalPages]);

  const goToLast = useCallback(() => setPage(totalPages), [totalPages]);

  const setLoading = useCallback((isLoading: boolean, scope?: QuotaScope | null) => {
    setLoadingState(isLoading);
    setLoadingScope(isLoading ? (scope ?? null) : null);
  }, []);

  return {
    pageSize,
    totalPages,
    currentPage,
    pageItems,
    setPageSize,
    goToFirst,
    goToPrev,
    goToNext,
    goToLast,
    loading,
    loadingScope,
    setLoading,
  };
};

interface QuotaSectionProps<TState extends QuotaStatusState, TData> {
  config: QuotaConfig<TState, TData>;
  files: AuthFileItem[];
  loading: boolean;
  disabled: boolean;
  snapshots?: QuotaSnapshotRecord[];
  tokenUsage?: Record<string, CredentialTokenUsage>;
  onQuotaRefreshComplete?: () => void | Promise<void>;
  onRegisterAutoRefresh?: RegisterQuotaRefreshHandler;
}

const resolveAuthIndex = (file: AuthFileItem): string => {
  const raw = file['auth_index'] ?? file.authIndex;
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const itemKey = (file: AuthFileItem): string => resolveAuthIndex(file) || file.name;

const snapshotAuthIndex = (snapshot: QuotaSnapshotRecord): string =>
  String(snapshot.auth_index ?? snapshot.authIndex ?? '').trim();

const snapshotFileName = (snapshot: QuotaSnapshotRecord): string =>
  String(snapshot.file_name ?? snapshot.fileName ?? '').trim();

const snapshotProvider = (snapshot: QuotaSnapshotRecord): string =>
  normalizeQuotaProvider(snapshot.provider);

const nearestResetMs = (
  provider: string,
  quota: QuotaStatusState | undefined,
  nowMs: number
): number => {
  return nearestQuotaResetMs(quota, nowMs, provider);
};

const quotaRefreshedAtMs = (quota: QuotaStatusState | undefined): number => {
  if (!quota) return 0;
  if (typeof quota.refreshedAtMs === 'number' && Number.isFinite(quota.refreshedAtMs)) {
    return quota.refreshedAtMs;
  }
  const parsed = parseTimestampMs(quota.refreshedAt);
  return Number.isFinite(parsed) ? parsed : 0;
};

const snapshotRefreshedAtMs = (snapshot: QuotaSnapshotRecord): number => {
  const raw = snapshot.refreshed_at_ms ?? snapshot.refreshedAtMs;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const parsed = parseTimestampMs(snapshot.refreshed_at ?? snapshot.refreshedAt);
  return Number.isFinite(parsed) ? parsed : 0;
};

const quotaWithSnapshotMetadata = <TState extends QuotaStatusState>(
  snapshot: QuotaSnapshotRecord
): TState | null => {
  if (!snapshot.quota || typeof snapshot.quota !== 'object' || Array.isArray(snapshot.quota)) {
    return null;
  }
  const quota = snapshot.quota as Record<string, unknown>;
  if (typeof quota.status !== 'string') return null;
  return {
    ...quota,
    refreshedAt: snapshot.refreshed_at ?? snapshot.refreshedAt,
    refreshedAtMs: snapshot.refreshed_at_ms ?? snapshot.refreshedAtMs,
  } as TState;
};

export function QuotaSection<TState extends QuotaStatusState, TData>({
  config,
  files,
  loading,
  disabled,
  snapshots = [],
  tokenUsage = {},
  onQuotaRefreshComplete,
  onRegisterAutoRefresh,
}: QuotaSectionProps<TState, TData>) {
  const { t } = useTranslation();
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;
  const { quota, loadQuota } = useQuotaLoader(config);

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('all');
  const [resetSort, setResetSort] = useState<ResetSortMode>('default');
  const [sortNowMs, setSortNowMs] = useState(() => Date.now());
  const [availabilityNowMs, setAvailabilityNowMs] = useState(() => Date.now());
  const [searchQuery, setSearchQuery] = useState('');
  const [resettingQuotaName, setResettingQuotaName] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const matchingFiles = useMemo(
    () => files.filter((file) => config.filterFn(file)),
    [files, config]
  );

  const quotaAwareAvailability = useCallback(
    (file: AuthFileItem): QuotaAvailability => {
      const snapshotAvailability = quotaHasAvailableCapacity(quota[file.name]);
      if (snapshotAvailability === true) {
        if (
          isCredentialArchived(file) ||
          isCredentialDisabled(file) ||
          isCredentialUnauthorized(file)
        ) {
          return false;
        }
        if (
          isCredentialQuotaLimited(file, availabilityNowMs) ||
          isCredentialEffectivelyAvailable(file, availabilityNowMs)
        ) {
          return true;
        }
        return null;
      }
      if (snapshotAvailability === false) {
        return false;
      }
      return null;
    },
    [availabilityNowMs, quota]
  );

  const isQuotaAwareAvailable = useCallback(
    (file: AuthFileItem): boolean => {
      const snapshotAvailability = quotaAwareAvailability(file);
      if (snapshotAvailability !== null) return snapshotAvailability;
      return isCredentialEffectivelyAvailable(file, availabilityNowMs);
    },
    [availabilityNowMs, quotaAwareAvailability]
  );

  const isQuotaAwareLimited = useCallback(
    (file: AuthFileItem): boolean => {
      const snapshotAvailability = quotaHasAvailableCapacity(quota[file.name]);
      if (snapshotAvailability === false) return true;
      if (snapshotAvailability === true) return false;
      return isCredentialQuotaLimited(file, availabilityNowMs);
    },
    [availabilityNowMs, quota]
  );

  const typeSummary = useMemo(() => {
    return {
      total: matchingFiles.length,
      available: matchingFiles.filter(isQuotaAwareAvailable).length,
      quotaLimited: matchingFiles.filter(isQuotaAwareLimited).length,
      unauthorized: matchingFiles.filter(isCredentialUnauthorized).length,
    };
  }, [isQuotaAwareAvailable, isQuotaAwareLimited, matchingFiles]);

  const searchedFiles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return matchingFiles.filter((file) => credentialMatchesSearch(file, query));
  }, [matchingFiles, searchQuery]);

  const displayFiles = useMemo(() => {
    const filtered = searchedFiles.filter((file) => {
      if (availabilityFilter === 'all') return true;
      const available = isQuotaAwareAvailable(file);
      return availabilityFilter === 'available' ? available : !available;
    });

    if (resetSort !== 'reset_asc') return filtered;

    return filtered
      .map((file, index) => ({
        file,
        index,
        resetMs: nearestResetMs(config.type, quota[file.name], sortNowMs),
      }))
      .sort((left, right) => {
        if (left.resetMs !== right.resetMs) return left.resetMs - right.resetMs;
        return left.index - right.index;
      })
      .map((entry) => entry.file);
  }, [availabilityFilter, isQuotaAwareAvailable, quota, resetSort, searchedFiles, sortNowMs]);

  const {
    pageSize,
    totalPages,
    currentPage,
    pageItems,
    setPageSize,
    goToFirst,
    goToPrev,
    goToNext,
    goToLast,
    loading: sectionLoading,
    loadingScope,
    setLoading,
  } = useQuotaPagination(displayFiles);

  const automaticRefreshRef = useRef<(targets: AuthFileItem[]) => Promise<void>>(async () => {});
  automaticRefreshRef.current = async (targets) => {
    const refreshableTargets = targets.filter((file) => config.filterFn(file));
    if (refreshableTargets.length === 0) return;
    await loadQuota(refreshableTargets, 'page', setLoading);
  };

  const refreshQuotaTargets = useCallback(
    async (targets: AuthFileItem[], scope: QuotaScope) => {
      await loadQuota(targets, scope, setLoading);
      await onQuotaRefreshComplete?.();
    },
    [loadQuota, onQuotaRefreshComplete, setLoading]
  );

  const refreshQuotaTargetsAutomatically = useCallback(
    (targets: AuthFileItem[]) => automaticRefreshRef.current(targets),
    []
  );

  useEffect(() => {
    if (!onRegisterAutoRefresh || disabled) return;
    return onRegisterAutoRefresh(config.type, refreshQuotaTargetsAutomatically);
  }, [config.type, disabled, onRegisterAutoRefresh, refreshQuotaTargetsAutomatically]);

  const visibleKeys = useMemo(() => pageItems.map(itemKey), [pageItems]);

  const selectedTargets = useMemo(
    () => displayFiles.filter((file) => selectedKeys.has(itemKey(file))),
    [displayFiles, selectedKeys]
  );

  const allVisibleSelected =
    visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys.has(key));

  useEffect(() => {
    if (loading) return;
    if (matchingFiles.length === 0) {
      setQuota({});
      return;
    }
    setQuota((prev) => {
      const nextState: Record<string, TState> = {};
      matchingFiles.forEach((file) => {
        const cached = prev[file.name];
        if (cached) {
          nextState[file.name] = cached;
        }
      });
      return nextState;
    });
  }, [matchingFiles, loading, setQuota]);

  useEffect(() => {
    if (snapshots.length === 0 || matchingFiles.length === 0) return;

    const fileByAuthIndex = new Map<string, AuthFileItem>();
    matchingFiles.forEach((file) => {
      const authIndex = resolveAuthIndex(file);
      if (authIndex) fileByAuthIndex.set(authIndex, file);
    });

    const relevantSnapshots = snapshots.filter(
      (snapshot) => snapshotProvider(snapshot) === config.type
    );
    if (relevantSnapshots.length === 0) return;

    setQuota((prev) => {
      let changed = false;
      const nextState = { ...prev };

      relevantSnapshots.forEach((snapshot) => {
        const authIndex = snapshotAuthIndex(snapshot);
        const matchedFile = authIndex ? fileByAuthIndex.get(authIndex) : undefined;
        const fileName = matchedFile?.name ?? snapshotFileName(snapshot);
        if (!fileName) return;

        const existing = nextState[fileName];
        const existingRefreshedAtMs = quotaRefreshedAtMs(existing);
        const snapshotUpdatedAtMs = snapshotRefreshedAtMs(snapshot);
        if (
          existing?.status === 'success' &&
          existingRefreshedAtMs > 0 &&
          snapshotUpdatedAtMs > 0 &&
          existingRefreshedAtMs >= snapshotUpdatedAtMs
        ) {
          return;
        }
        if (existing?.status === 'loading') return;

        const state = quotaWithSnapshotMetadata<TState>(snapshot);
        if (!state) return;

        nextState[fileName] = state;
        changed = true;
      });

      return changed ? nextState : prev;
    });
  }, [config.type, matchingFiles, setQuota, snapshots]);

  useEffect(() => {
    if (loading || sectionLoading) return;

    const nowMs = Date.now();
    const times = [
      ...matchingFiles.map(getCredentialNextRetryAt),
      ...pageItems.map((file) => nearestResetMs(config.type, quota[file.name], nowMs)),
    ]
      .filter((value) => Number.isFinite(value) && value > nowMs + QUOTA_REFRESH_GRACE_MS)
      .sort((left, right) => left - right);
    const nextRefreshAt = times[0];

    if (!nextRefreshAt) return;

    const timeout = window.setTimeout(
      () => {
        const nextNowMs = Date.now();
        setAvailabilityNowMs(nextNowMs);
        setSortNowMs(nextNowMs);
      },
      Math.max(1000, nextRefreshAt - nowMs + QUOTA_REFRESH_GRACE_MS)
    );

    return () => window.clearTimeout(timeout);
  }, [availabilityNowMs, loading, matchingFiles, pageItems, quota, sectionLoading]);

  const handleAvailabilityChange = useCallback(
    (value: AvailabilityFilter) => {
      setAvailabilityNowMs(Date.now());
      setAvailabilityFilter(value);
      goToFirst();
    },
    [goToFirst]
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setAvailabilityNowMs(Date.now());
      setSearchQuery(value);
      goToFirst();
    },
    [goToFirst]
  );

  const handleResetSortChange = useCallback(
    (value: ResetSortMode) => {
      setSortNowMs(Date.now());
      setResetSort(value);
      goToFirst();
    },
    [goToFirst]
  );

  const toggleItem = useCallback((file: AuthFileItem, selected: boolean) => {
    const key = itemKey(file);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }, []);

  const toggleCurrentPage = useCallback(() => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleKeys.forEach((key) => next.delete(key));
      } else {
        visibleKeys.forEach((key) => next.add(key));
      }
      return next;
    });
  }, [allVisibleSelected, visibleKeys]);

  const refreshSelected = useCallback(() => {
    if (disabled || sectionLoading || selectedTargets.length === 0) return;
    void refreshQuotaTargets(selectedTargets, 'selected');
  }, [disabled, refreshQuotaTargets, sectionLoading, selectedTargets]);

  const refreshQuotaForFile = useCallback(
    (file: AuthFileItem) => {
      if (disabled || sectionLoading) return;
      void refreshQuotaTargets([file], 'page');
    },
    [disabled, refreshQuotaTargets, sectionLoading]
  );

  const resetQuotaForFile = useCallback(
    (file: AuthFileItem) => {
      const resetQuota = config.resetQuota;
      if (!resetQuota) return;
      if (disabled || file.disabled) return;
      if (quota[file.name]?.status === 'loading') return;
      if (resettingQuotaName === file.name) return;

      const fileQuota = quota[file.name];
      if (config.canResetQuota && !config.canResetQuota(fileQuota)) return;
      const resetCount = Math.max(
        0,
        Math.floor(
          Number(
            (fileQuota as { rateLimitResetCreditsAvailableCount?: number | null } | undefined)
              ?.rateLimitResetCreditsAvailableCount ?? 0
          ) || 0
        )
      );

      showConfirmation({
        title: t('codex_quota.reset_confirm_title'),
        message: t('codex_quota.reset_confirm_message', {
          name: file.name,
          count: resetCount,
        }),
        confirmText: t('codex_quota.reset_confirm_button'),
        variant: 'primary',
        onConfirm: async () => {
          const cacheGeneration = captureQuotaCacheGeneration();
          setResettingQuotaName(file.name);
          try {
            const data = await resetQuota(file, t);
            const now = new Date();
            const successState = config.buildSuccessState(data);
            const committed = commitIfQuotaCacheCurrent(cacheGeneration, () => {
              setQuota((prev) => ({
                ...prev,
                [file.name]: {
                  ...(successState as Record<string, unknown>),
                  refreshedAt: now.toISOString(),
                  refreshedAtMs: now.getTime(),
                } as TState,
              }));
              showNotification(t('codex_quota.reset_success', { name: file.name }), 'success');
            });
            if (committed) await onQuotaRefreshComplete?.();
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : t('common.unknown_error');
            commitIfQuotaCacheCurrent(cacheGeneration, () => {
              showNotification(
                t('codex_quota.reset_failed', { name: file.name, message }),
                'error'
              );
            });
          } finally {
            setResettingQuotaName((current) => (current === file.name ? null : current));
          }
        },
      });
    },
    [
      config,
      disabled,
      onQuotaRefreshComplete,
      quota,
      resettingQuotaName,
      setQuota,
      showConfirmation,
      showNotification,
      t,
    ]
  );

  const titleNode = (
    <button
      type="button"
      className={styles.sectionToggle}
      aria-expanded={isExpanded}
      onClick={() => setIsExpanded((current) => !current)}
    >
      <span className={styles.titleWrapper}>
        <span>{t(`${config.i18nPrefix}.title`)}</span>
        {displayFiles.length > 0 && (
          <span className={styles.countBadge}>{displayFiles.length}</span>
        )}
      </span>
      <span
        className={`${styles.sectionChevron} ${isExpanded ? styles.sectionChevronExpanded : ''}`}
        aria-hidden="true"
      >
        <IconChevronDown size={18} />
      </span>
    </button>
  );

  const isRefreshing = sectionLoading || loading;

  return (
    <Card
      className={`${styles.providerSectionCard} ${isExpanded ? styles.providerSectionExpanded : ''}`}
      title={titleNode}
      extra={
        <div className={styles.headerActions}>
          <div className={styles.typeSummary} aria-label={t('quota_management.type_summary')}>
            <span>
              {t('quota_management.summary_total')}
              <strong>{typeSummary.total.toLocaleString()}</strong>
            </span>
            <span>
              {t('quota_management.summary_available')}
              <strong>{typeSummary.available.toLocaleString()}</strong>
            </span>
            <span className={typeSummary.quotaLimited > 0 ? styles.summaryWarning : ''}>
              {t('quota_management.summary_quota_limited')}
              <strong>{typeSummary.quotaLimited.toLocaleString()}</strong>
            </span>
            <span className={typeSummary.unauthorized > 0 ? styles.summaryDanger : ''}>
              {t('quota_management.summary_401')}
              <strong>{typeSummary.unauthorized.toLocaleString()}</strong>
            </span>
          </div>
          {isExpanded && (
            <Button
              variant="secondary"
              size="sm"
              className={styles.refreshAllButton}
              onClick={refreshSelected}
              disabled={disabled || isRefreshing || selectedTargets.length === 0}
              loading={sectionLoading && loadingScope === 'selected'}
              title={t('quota_management.refresh_selected')}
              aria-label={t('quota_management.refresh_selected')}
            >
              {!isRefreshing && <IconRefreshCw size={16} />}
              {t('quota_management.refresh_selected')}
            </Button>
          )}
        </div>
      }
    >
      {matchingFiles.length === 0 ? (
        <EmptyState
          title={t(`${config.i18nPrefix}.empty_title`)}
          description={t(`${config.i18nPrefix}.empty_desc`)}
        />
      ) : (
        <>
          <div className={styles.quotaToolbar}>
            <div className={styles.quotaSearch}>
              <IconSearch size={14} />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => handleSearchChange(event.target.value)}
                placeholder={t('quota_management.search_placeholder')}
                aria-label={t('quota_management.search_placeholder')}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => handleSearchChange('')}
                  aria-label={t('quota_management.search_clear')}
                  title={t('quota_management.search_clear')}
                >
                  <IconX size={13} />
                </button>
              )}
            </div>
            <label className={styles.selectPageControl}>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleCurrentPage}
                disabled={pageItems.length === 0}
              />
              {t('quota_management.select_current_page')}
            </label>
            <span className={styles.selectedSummary}>
              {t('quota_management.selected_count', { count: selectedTargets.length })}
            </span>
            <div
              className={styles.listFilters}
              aria-label={t('quota_management.availability_filter')}
            >
              {AVAILABILITY_FILTERS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={availabilityFilter === value ? styles.activeFilter : ''}
                  onClick={() => handleAvailabilityChange(value)}
                >
                  {t(`quota_management.filter_${value}`)}
                </button>
              ))}
            </div>
            <select
              className={styles.sortSelect}
              value={resetSort}
              onChange={(event) => handleResetSortChange(event.target.value as ResetSortMode)}
              aria-label={t('quota_management.reset_sort')}
            >
              {RESET_SORT_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {t(`quota_management.sort_${value}`)}
                </option>
              ))}
            </select>
            <div className={styles.pageSizeSwitch} aria-label={t('quota_management.page_size')}>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <button
                  key={size}
                  type="button"
                  className={pageSize === size ? styles.activePageSize : ''}
                  onClick={() => setPageSize(size)}
                >
                  {t('quota_management.page_size_option', { count: size })}
                </button>
              ))}
            </div>
          </div>

          {displayFiles.length === 0 ? (
            <EmptyState
              title={t('quota_management.filtered_empty_title')}
              description={t('quota_management.filtered_empty_desc')}
            />
          ) : (
            <div className={styles.quotaList}>
              <div className={styles.quotaListHeader}>
                <span />
                <span>{t('quota_management.column_credential')}</span>
                <span>{t('quota_management.column_quota')}</span>
                <span>{t('quota_management.column_tokens')}</span>
                <span>{t('quota_management.column_snapshot')}</span>
              </div>
              {pageItems.map((item) => {
                const authIndex = resolveAuthIndex(item);
                const itemQuota = quota[item.name];
                const isResettingQuota = resettingQuotaName === item.name;
                const canUseQuotaAction =
                  !disabled && !item.disabled && itemQuota?.status !== 'loading' && !sectionLoading;
                const showResetQuotaAction =
                  itemQuota !== undefined && Boolean(config.canResetQuota?.(itemQuota));
                const resetCreditsCount = Math.max(
                  0,
                  Math.floor(
                    Number(
                      (
                        itemQuota as
                          | { rateLimitResetCreditsAvailableCount?: number | null }
                          | undefined
                      )?.rateLimitResetCreditsAvailableCount ?? 0
                    ) || 0
                  )
                );
                const resetButtonLabel = t('codex_quota.reset_button', {
                  count: resetCreditsCount,
                });
                const resetQuotaAction =
                  config.resetQuota && showResetQuotaAction ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className={styles.quotaResetCreditButton}
                      onClick={() => resetQuotaForFile(item)}
                      disabled={!canUseQuotaAction || isResettingQuota}
                      loading={isResettingQuota}
                      title={t('codex_quota.reset_confirm_title')}
                      aria-label={resetButtonLabel}
                    >
                      {!isResettingQuota && <IconRefreshCw size={12} />}
                      {resetButtonLabel}
                    </Button>
                  ) : undefined;

                return (
                  <QuotaCard
                    key={item.name}
                    item={item}
                    quota={itemQuota}
                    resolvedTheme={resolvedTheme}
                    i18nPrefix={config.i18nPrefix}
                    cardIdleMessageKey={config.cardIdleMessageKey}
                    cardClassName={config.cardClassName}
                    defaultType={config.type}
                    selected={selectedKeys.has(itemKey(item))}
                    onSelectedChange={(selected) => toggleItem(item, selected)}
                    tokenUsage={authIndex ? tokenUsage[authIndex] : undefined}
                    canRefresh={canUseQuotaAction && !isResettingQuota}
                    onRefresh={() => refreshQuotaForFile(item)}
                    resetQuotaAction={resetQuotaAction}
                    renderQuotaItems={config.renderQuotaItems}
                  />
                );
              })}
            </div>
          )}

          {displayFiles.length > pageSize && (
            <div className={styles.paginationBar}>
              <span>
                {t('quota_management.pagination_info', {
                  current: currentPage,
                  total: totalPages,
                  count: displayFiles.length,
                })}
              </span>
              <div>
                <button type="button" disabled={currentPage <= 1} onClick={goToFirst}>
                  {t('quota_management.pagination_first')}
                </button>
                <button type="button" disabled={currentPage <= 1} onClick={goToPrev}>
                  {t('auth_files.pagination_prev')}
                </button>
                <button type="button" disabled={currentPage >= totalPages} onClick={goToNext}>
                  {t('auth_files.pagination_next')}
                </button>
                <button type="button" disabled={currentPage >= totalPages} onClick={goToLast}>
                  {t('quota_management.pagination_last')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
