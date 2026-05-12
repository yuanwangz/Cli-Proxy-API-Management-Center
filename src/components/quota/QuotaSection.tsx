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
import { QuotaCard } from './QuotaCard';
import type { QuotaStatusState } from './QuotaCard';
import { useQuotaLoader } from './useQuotaLoader';
import type { QuotaConfig } from './quotaConfigs';
import { IconRefreshCw } from '@/components/ui/icons';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;

type QuotaScope = 'page' | 'selected';

const PAGE_SIZE_OPTIONS = [10, 25, 50];

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

  const filteredFiles = useMemo(() => files.filter((file) => config.filterFn(file)), [
    files,
    config
  ]);

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
  } = useQuotaPagination(filteredFiles);

  const { quota, loadQuota } = useQuotaLoader(config);

  const visibleKeys = useMemo(() => pageItems.map(itemKey), [pageItems]);

  const selectedTargets = useMemo(
    () => filteredFiles.filter((file) => selectedKeys.has(itemKey(file))),
    [filteredFiles, selectedKeys]
  );

  const allVisibleSelected =
    visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys.has(key));

  useEffect(() => {
    if (loading) return;
    if (filteredFiles.length === 0) {
      setQuota({});
      return;
    }
    setQuota((prev) => {
      const nextState: Record<string, TState> = {};
      filteredFiles.forEach((file) => {
        const cached = prev[file.name];
        if (cached) {
          nextState[file.name] = cached;
        }
      });
      return nextState;
    });
  }, [filteredFiles, loading, setQuota]);

  useEffect(() => {
    if (snapshots.length === 0 || filteredFiles.length === 0) return;

    const fileByAuthIndex = new Map<string, AuthFileItem>();
    filteredFiles.forEach((file) => {
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
  }, [config.type, filteredFiles, setQuota, snapshots]);

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
      {filteredFiles.length > 0 && (
        <span className={styles.countBadge}>
          {filteredFiles.length}
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
      {filteredFiles.length === 0 ? (
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

          {filteredFiles.length > pageSize && (
            <div className={styles.paginationBar}>
              <span>
                {t('quota_management.pagination_info', {
                  current: currentPage,
                  total: totalPages,
                  count: filteredFiles.length
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
