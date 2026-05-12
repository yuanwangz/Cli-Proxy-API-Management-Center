/**
 * Generic quota section component.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useQuotaStore, useThemeStore } from '@/stores';
import type { AuthFileItem, ResolvedTheme } from '@/types';
import type { CredentialTokenUsage, QuotaSnapshotRecord } from '@/types/quota';
import { parseTimestampMs } from '@/utils/timestamp';
import { QuotaCard } from './QuotaCard';
import type { QuotaStatusState } from './QuotaCard';
import { useQuotaLoader } from './useQuotaLoader';
import type { QuotaConfig } from './quotaConfigs';
import { IconRefreshCw } from '@/components/ui/icons';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;

type QuotaScope = 'page' | 'selected';
type AvailabilityFilter = 'all' | 'available' | 'unavailable';
type ResetSortMode = 'default' | 'reset_asc';

const PAGE_SIZE_OPTIONS = [10, 25, 50];
const AVAILABILITY_FILTERS: AvailabilityFilter[] = ['all', 'available', 'unavailable'];
const RESET_SORT_OPTIONS: ResetSortMode[] = ['default', 'reset_asc'];
const NO_RESET_TIME = Number.POSITIVE_INFINITY;

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
    setLoading
  };
};

interface QuotaSectionProps<TState extends QuotaStatusState, TData> {
  config: QuotaConfig<TState, TData>;
  files: AuthFileItem[];
  loading: boolean;
  disabled: boolean;
  snapshots?: QuotaSnapshotRecord[];
  tokenUsage?: Record<string, CredentialTokenUsage>;
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
  String(snapshot.provider ?? '').trim().toLowerCase();

const resetValueToMs = (value: unknown, nowMs: number): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }

  if (typeof value !== 'string') return NO_RESET_TIME;
  const text = value.trim();
  if (!text || text === '-') return NO_RESET_TIME;
  if (text === '<1m') return nowMs + 60_000;

  const parsed = parseTimestampMs(text);
  if (Number.isFinite(parsed)) return parsed;

  const zhDateMatch = text.match(
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\D+(\d{1,2}):(\d{2}))?/
  );
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
  for (const key of ['resetAt', 'reset_at', 'resetTime', 'reset_time', 'resets_at', 'resetLabel', 'resetHint']) {
    const ms = resetValueToMs(record[key], nowMs);
    if (Number.isFinite(ms)) times.push(ms);
  }

  for (const key of ['resetAfterSeconds', 'reset_after_seconds', 'resetIn', 'reset_in', 'ttl']) {
    const raw = record[key];
    const seconds = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (Number.isFinite(seconds) && seconds > 0) times.push(nowMs + seconds * 1000);
  }

  for (const key of ['windows', 'groups', 'buckets', 'rows']) {
    collectResetTimes(record[key], nowMs, times);
  }
};

const nearestResetMs = (quota: QuotaStatusState | undefined, nowMs: number): number => {
  if (!quota || quota.status !== 'success') return NO_RESET_TIME;
  const times: number[] = [];
  collectResetTimes(quota, nowMs, times);
  return times.length > 0 ? Math.min(...times) : NO_RESET_TIME;
};

const isAvailableFile = (file: AuthFileItem): boolean => !file.disabled && !file.unavailable;

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
  tokenUsage = {}
}: QuotaSectionProps<TState, TData>) {
  const { t } = useTranslation();
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('all');
  const [resetSort, setResetSort] = useState<ResetSortMode>('default');
  const [sortNowMs, setSortNowMs] = useState(() => Date.now());

  const matchingFiles = useMemo(() => files.filter((file) => config.filterFn(file)), [
    files,
    config
  ]);

  const { quota, loadQuota } = useQuotaLoader(config);

  const displayFiles = useMemo(() => {
    const filtered = matchingFiles.filter((file) => {
      if (availabilityFilter === 'all') return true;
      const available = isAvailableFile(file);
      return availabilityFilter === 'available' ? available : !available;
    });

    if (resetSort !== 'reset_asc') return filtered;

    return filtered
      .map((file, index) => ({
        file,
        index,
        resetMs: nearestResetMs(quota[file.name], sortNowMs),
      }))
      .sort((left, right) => {
        if (left.resetMs !== right.resetMs) return left.resetMs - right.resetMs;
        return left.index - right.index;
      })
      .map((entry) => entry.file);
  }, [availabilityFilter, matchingFiles, quota, resetSort, sortNowMs]);

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
    setLoading
  } = useQuotaPagination(displayFiles);

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
        if (existing?.status === 'loading') return;

        const state = quotaWithSnapshotMetadata<TState>(snapshot);
        if (!state) return;

        nextState[fileName] = state;
        changed = true;
      });

      return changed ? nextState : prev;
    });
  }, [config.type, matchingFiles, setQuota, snapshots]);

  const handleAvailabilityChange = useCallback(
    (value: AvailabilityFilter) => {
      setAvailabilityFilter(value);
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
    loadQuota(selectedTargets, 'selected', setLoading);
  }, [disabled, loadQuota, sectionLoading, selectedTargets, setLoading]);

  const titleNode = (
    <div className={styles.titleWrapper}>
      <span>{t(`${config.i18nPrefix}.title`)}</span>
      {displayFiles.length > 0 && (
        <span className={styles.countBadge}>
          {displayFiles.length}
        </span>
      )}
    </div>
  );

  const isRefreshing = sectionLoading || loading;

  return (
    <Card
      title={titleNode}
      extra={
        <div className={styles.headerActions}>
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
            <div className={styles.listFilters} aria-label={t('quota_management.availability_filter')}>
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
                return (
                  <QuotaCard
                    key={item.name}
                    item={item}
                    quota={quota[item.name]}
                    resolvedTheme={resolvedTheme}
                    i18nPrefix={config.i18nPrefix}
                    cardIdleMessageKey={config.cardIdleMessageKey}
                    cardClassName={config.cardClassName}
                    defaultType={config.type}
                    selected={selectedKeys.has(itemKey(item))}
                    onSelectedChange={(selected) => toggleItem(item, selected)}
                    tokenUsage={authIndex ? tokenUsage[authIndex] : undefined}
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
                  count: displayFiles.length
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
