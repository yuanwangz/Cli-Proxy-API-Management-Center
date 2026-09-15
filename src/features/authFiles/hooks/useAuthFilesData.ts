import { useCallback, useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import type { AuthFileFieldsPatch } from '@/services/api';
import { notifyAuthFilesChanged } from '@/features/authFiles/authFilesEvents';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { formatFileSize } from '@/utils/format';
import { MAX_AUTH_FILE_SIZE } from '@/utils/constants';
import { downloadBlob } from '@/utils/download';
import {
  getAuthFileStatusCode,
  getTypeLabel,
  hasAuthFileStatusMessage,
  isArchivedAuthFile,
  isRuntimeOnlyAuthFile,
  normalizeProviderKey,
  supportsAuthFileManualRefresh,
} from '@/features/authFiles/constants';
import type {
  AuthFilesArchiveFilter,
  AuthFilesStatusCodeFilter,
} from '@/features/authFiles/uiState';
import { getAuthFileAuthIndex, getAuthFileIdentityKey } from '@/features/authFiles/identity';

type DeleteAllOptions = {
  filter: string;
  archiveFilter?: AuthFilesArchiveFilter;
  problemOnly?: boolean;
  disabledOnly?: boolean;
  statusCodeFilter?: AuthFilesStatusCodeFilter;
  enabledOnly?: boolean;
  onResetFilterToAll: () => void;
  onResetArchiveFilter?: () => void;
  onResetProblemOnly?: () => void;
  onResetDisabledOnly?: () => void;
  onResetStatusCodeFilter?: () => void;
  onResetEnabledOnly?: () => void;
};

export type BatchPatchFieldsResult = {
  success: number;
  failedNames: string[];
};

type AuthFileSelectionTarget = AuthFileItem | string;

const isDeleteFailureForFile = (
  file: AuthFileItem,
  failure: { name: string; authIndex?: string }
): boolean => {
  if (failure.name !== file.name) return false;
  const authIndex = getAuthFileAuthIndex(file);
  return !failure.authIndex || failure.authIndex === authIndex;
};

const BATCH_FIELD_UPDATE_CONCURRENCY = 8;

export type UseAuthFilesDataResult = {
  files: AuthFileItem[];
  selectedFiles: Set<string>;
  selectionCount: number;
  loading: boolean;
  refreshing: boolean;
  error: string;
  uploading: boolean;
  deleting: string | null;
  deletingAll: boolean;
  statusUpdating: Record<string, boolean>;
  manualRefreshing: Record<string, boolean>;
  batchStatusUpdating: boolean;
  archiveUpdating: Record<string, boolean>;
  batchArchiveUpdating: boolean;
  batchFieldsUpdating: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  loadFiles: (options?: { background?: boolean }) => Promise<void>;
  handleUploadClick: () => void;
  handleFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleDelete: (file: AuthFileSelectionTarget) => void;
  handleDeleteAll: (options: DeleteAllOptions) => void;
  handleDownload: (file: AuthFileSelectionTarget) => Promise<void>;
  handleManualRefresh: (item: AuthFileItem) => Promise<void>;
  handleStatusToggle: (item: AuthFileItem, enabled: boolean) => Promise<void>;
  handleArchiveToggle: (item: AuthFileItem, archived: boolean) => Promise<void>;
  toggleSelect: (file: AuthFileSelectionTarget) => void;
  selectAllVisible: (visibleFiles: AuthFileItem[]) => void;
  deselectVisible: (visibleFiles: AuthFileItem[]) => void;
  invertVisibleSelection: (visibleFiles: AuthFileItem[]) => void;
  deselectAll: () => void;
  batchDownload: (files: AuthFileSelectionTarget[]) => Promise<void>;
  batchSetStatus: (files: AuthFileSelectionTarget[], enabled: boolean) => Promise<void>;
  batchSetArchived: (files: AuthFileSelectionTarget[], archived: boolean) => Promise<void>;
  batchPatchFields: (
    files: AuthFileSelectionTarget[],
    fields: AuthFileFieldsPatch
  ) => Promise<BatchPatchFieldsResult | null>;
  batchDelete: (files: AuthFileSelectionTarget[]) => void;
};

export function useAuthFilesData(_options?: {
  onFilesMutated?: (identityKeys?: string[]) => void;
}): UseAuthFilesDataResult {
  const { t } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<Record<string, boolean>>({});
  const [manualRefreshing, setManualRefreshing] = useState<Record<string, boolean>>({});
  const [batchStatusUpdating, setBatchStatusUpdating] = useState(false);
  const [archiveUpdating, setArchiveUpdating] = useState<Record<string, boolean>>({});
  const [batchArchiveUpdating, setBatchArchiveUpdating] = useState(false);
  const [batchFieldsUpdating, setBatchFieldsUpdating] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const manualRefreshPendingRef = useRef<Set<string>>(new Set());
  const batchStatusPendingRef = useRef(false);
  const batchArchivePendingRef = useRef(false);
  const batchFieldsPendingRef = useRef(false);
  const selectionCount = selectedFiles.size;
  const resolveFile = useCallback(
    (target: AuthFileSelectionTarget): AuthFileItem | null => {
      if (typeof target !== 'string') return target;
      const exact = files.find((file) => getAuthFileIdentityKey(file) === target);
      if (exact) return exact;
      // Legacy callers pass a filename; only a credential without auth_index can be
      // resolved from that value because an indexed duplicate would be ambiguous.
      return files.find((file) => !getAuthFileAuthIndex(file) && file.name === target) ?? null;
    },
    [files]
  );

  const resolveFiles = useCallback(
    (targets: AuthFileSelectionTarget[]): AuthFileItem[] => {
      const seen = new Set<string>();
      const resolved: AuthFileItem[] = [];
      targets.forEach((target) => {
        const file = resolveFile(target);
        if (!file) return;
        const identityKey = getAuthFileIdentityKey(file);
        if (seen.has(identityKey)) return;
        seen.add(identityKey);
        resolved.push(file);
      });
      return resolved;
    },
    [resolveFile]
  );

  const toggleSelect = useCallback((target: AuthFileSelectionTarget) => {
    const identityKey = typeof target === 'string' ? target : getAuthFileIdentityKey(target);
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(identityKey)) {
        next.delete(identityKey);
      } else {
        next.add(identityKey);
      }
      return next;
    });
  }, []);

  const selectAllVisible = useCallback((visibleFiles: AuthFileItem[]) => {
    const nextSelected = visibleFiles
      .filter((file) => !isRuntimeOnlyAuthFile(file))
      .map((file) => getAuthFileIdentityKey(file));
    if (nextSelected.length === 0) return;
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      nextSelected.forEach((identityKey) => next.add(identityKey));
      return next;
    });
  }, []);

  const deselectVisible = useCallback((visibleFiles: AuthFileItem[]) => {
    const visibleIdentityKeys = new Set(
      visibleFiles
        .filter((file) => !isRuntimeOnlyAuthFile(file))
        .map((file) => getAuthFileIdentityKey(file))
    );
    if (visibleIdentityKeys.size === 0) return;

    setSelectedFiles((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((identityKey) => {
        if (visibleIdentityKeys.has(identityKey)) {
          changed = true;
          return;
        }
        next.add(identityKey);
      });
      return changed ? next : prev;
    });
  }, []);

  const invertVisibleSelection = useCallback((visibleFiles: AuthFileItem[]) => {
    const visibleIdentityKeys = visibleFiles
      .filter((file) => !isRuntimeOnlyAuthFile(file))
      .map((file) => getAuthFileIdentityKey(file));
    if (visibleIdentityKeys.length === 0) return;

    setSelectedFiles((prev) => {
      const next = new Set(prev);
      visibleIdentityKeys.forEach((identityKey) => {
        if (next.has(identityKey)) {
          next.delete(identityKey);
        } else {
          next.add(identityKey);
        }
      });
      return next;
    });
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  const applyDeletedFiles = useCallback(
    (targets: AuthFileSelectionTarget[]) => {
      const deletedIdentityKeys = new Set(
        targets.flatMap((target) => {
          const file = resolveFile(target);
          return file ? [getAuthFileIdentityKey(file)] : [];
        })
      );
      if (deletedIdentityKeys.size === 0) return;

      setFiles((prev) =>
        prev.filter((file) => !deletedIdentityKeys.has(getAuthFileIdentityKey(file)))
      );
      setSelectedFiles((prev) => {
        if (prev.size === 0) return prev;
        let changed = false;
        const next = new Set<string>();
        prev.forEach((identityKey) => {
          if (deletedIdentityKeys.has(identityKey)) {
            changed = true;
          } else {
            next.add(identityKey);
          }
        });
        return changed ? next : prev;
      });
    },
    [resolveFile]
  );

  useEffect(() => {
    if (selectedFiles.size === 0) return;
    const existingIdentityKeys = new Set(files.map((file) => getAuthFileIdentityKey(file)));
    setSelectedFiles((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((identityKey) => {
        if (existingIdentityKeys.has(identityKey)) {
          next.add(identityKey);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [files, selectedFiles.size]);

  const loadFiles = useCallback(
    async (options?: { background?: boolean }) => {
      const background = options?.background === true;
      if (background) setRefreshing(true);
      else setLoading(true);
      setError('');
      try {
        const data = await authFilesApi.list();
        setFiles(data?.files || []);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
        setError(errorMessage);
      } finally {
        if (background) setRefreshing(false);
        else setLoading(false);
      }
    },
    [t]
  );

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files;
      if (!fileList || fileList.length === 0) return;

      const filesToUpload = Array.from(fileList);
      const validFiles: File[] = [];
      const invalidFiles: string[] = [];
      const oversizedFiles: string[] = [];

      filesToUpload.forEach((file) => {
        if (!file.name.endsWith('.json')) {
          invalidFiles.push(file.name);
          return;
        }
        if (file.size > MAX_AUTH_FILE_SIZE) {
          oversizedFiles.push(file.name);
          return;
        }
        validFiles.push(file);
      });

      if (invalidFiles.length > 0) {
        showNotification(t('auth_files.upload_error_json'), 'error');
      }
      if (oversizedFiles.length > 0) {
        showNotification(
          t('auth_files.upload_error_size', { maxSize: formatFileSize(MAX_AUTH_FILE_SIZE) }),
          'error'
        );
      }

      if (validFiles.length === 0) {
        event.target.value = '';
        return;
      }

      setUploading(true);
      try {
        const result = await authFilesApi.uploadFiles(validFiles);
        const successCount = result.uploaded;

        if (successCount > 0) {
          const suffix = validFiles.length > 1 ? ` (${successCount}/${validFiles.length})` : '';
          showNotification(
            `${t('auth_files.upload_success')}${suffix}`,
            result.failed.length ? 'warning' : 'success'
          );
          notifyAuthFilesChanged();
          await loadFiles();
        }

        if (result.failed.length > 0) {
          const details = result.failed.map((item) => `${item.name}: ${item.error}`).join('; ');
          showNotification(`${t('notification.upload_failed')}: ${details}`, 'error');
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        showNotification(`${t('notification.upload_failed')}: ${errorMessage}`, 'error');
      } finally {
        setUploading(false);
        event.target.value = '';
      }
    },
    [loadFiles, showNotification, t]
  );

  const handleDelete = useCallback(
    (target: AuthFileSelectionTarget) => {
      const file = resolveFile(target);
      const name = file?.name ?? (typeof target === 'string' ? target : target.name);
      const identityKey = file ? getAuthFileIdentityKey(file) : name;
      if (!name) return;
      showConfirmation({
        title: t('auth_files.delete_title', { defaultValue: 'Delete File' }),
        message: `${t('auth_files.delete_confirm')} "${name}" ?`,
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: async () => {
          setDeleting(identityKey);
          try {
            const result = await authFilesApi.deleteFile(file ?? target);
            showNotification(t('auth_files.delete_success'), 'success');
            applyDeletedFiles(result.deleted > 0 ? [file ?? target] : result.files);
            if (result.deleted > 0) notifyAuthFilesChanged();
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : '';
            showNotification(`${t('notification.delete_failed')}: ${errorMessage}`, 'error');
          } finally {
            setDeleting(null);
          }
        },
      });
    },
    [applyDeletedFiles, resolveFile, showConfirmation, showNotification, t]
  );

  const handleDeleteAll = useCallback(
    (deleteAllOptions: DeleteAllOptions) => {
      const {
        filter,
        archiveFilter = 'all',
        problemOnly = false,
        disabledOnly = false,
        statusCodeFilter = 'all',
        enabledOnly = false,
        onResetFilterToAll,
        onResetArchiveFilter,
        onResetProblemOnly,
        onResetDisabledOnly,
        onResetStatusCodeFilter,
        onResetEnabledOnly,
      } = deleteAllOptions;
      const isFiltered = filter !== 'all';
      const isArchiveFiltered = archiveFilter !== 'all';
      const isProblemOnly = problemOnly === true;
      const isDisabledOnly = disabledOnly === true;
      const isStatusCodeFiltered = statusCodeFilter !== 'all';
      const isEnabledOnly = enabledOnly === true;
      const hasResultFilter =
        isArchiveFiltered || isDisabledOnly || isEnabledOnly || isStatusCodeFiltered;
      const typeLabel = isFiltered ? getTypeLabel(t, filter) : t('auth_files.filter_all');
      let confirmMessage = t('auth_files.delete_all_confirm');
      if (hasResultFilter) {
        confirmMessage = t('auth_files.delete_filtered_result_confirm');
      } else if (isProblemOnly) {
        confirmMessage = isFiltered
          ? t('auth_files.delete_problem_filtered_confirm', { type: typeLabel })
          : t('auth_files.delete_problem_confirm');
      } else if (isFiltered) {
        confirmMessage = t('auth_files.delete_filtered_confirm', { type: typeLabel });
      }

      showConfirmation({
        title: t('auth_files.delete_all_title', { defaultValue: 'Delete All Files' }),
        message: confirmMessage,
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: async () => {
          setDeletingAll(true);
          try {
            if (
              !isFiltered &&
              !isArchiveFiltered &&
              !isProblemOnly &&
              !isDisabledOnly &&
              !isEnabledOnly &&
              !isStatusCodeFiltered
            ) {
              await authFilesApi.deleteAll();
              showNotification(t('auth_files.delete_all_success'), 'success');
              setFiles((prev) => prev.filter((file) => isRuntimeOnlyAuthFile(file)));
              deselectAll();
              notifyAuthFilesChanged();
            } else {
              const filesToDelete = files.filter((file) => {
                if (isRuntimeOnlyAuthFile(file)) return false;
                if (archiveFilter === 'active' && isArchivedAuthFile(file)) return false;
                if (archiveFilter === 'archived' && !isArchivedAuthFile(file)) return false;
                if (
                  isFiltered &&
                  normalizeProviderKey(String(file.type ?? file.provider ?? '')) !== filter
                ) {
                  return false;
                }
                if (isProblemOnly && !hasAuthFileStatusMessage(file)) return false;
                if (isDisabledOnly && file.disabled !== true) return false;
                if (
                  isStatusCodeFiltered &&
                  getAuthFileStatusCode(file) !== Number(statusCodeFilter)
                ) {
                  return false;
                }
                if (isEnabledOnly && file.disabled === true) return false;
                return true;
              });

              if (filesToDelete.length === 0) {
                let emptyMessage = t('auth_files.delete_filtered_none', { type: typeLabel });
                if (hasResultFilter) {
                  emptyMessage = t('auth_files.delete_filtered_result_none');
                } else if (isProblemOnly) {
                  emptyMessage = isFiltered
                    ? t('auth_files.delete_problem_filtered_none', { type: typeLabel })
                    : t('auth_files.delete_problem_none');
                }
                showNotification(emptyMessage, 'info');
                setDeletingAll(false);
                return;
              }

              const result = await authFilesApi.deleteFiles(filesToDelete);
              const success = result.deleted;
              const failed = result.failed.length;

              const successfulTargets = filesToDelete.filter(
                (file) => !result.failed.some((failure) => isDeleteFailureForFile(file, failure))
              );
              applyDeletedFiles(result.failed.length === 0 ? filesToDelete : successfulTargets);
              if (result.deleted > 0) notifyAuthFilesChanged();

              if (failed === 0 && hasResultFilter) {
                showNotification(
                  t('auth_files.delete_filtered_result_success', { count: success }),
                  'success'
                );
              } else if (failed === 0 && isProblemOnly) {
                showNotification(
                  isFiltered
                    ? t('auth_files.delete_problem_filtered_success', {
                        count: success,
                        type: typeLabel,
                      })
                    : t('auth_files.delete_problem_success', { count: success }),
                  'success'
                );
              } else if (failed === 0) {
                showNotification(
                  t('auth_files.delete_filtered_success', { count: success, type: typeLabel }),
                  'success'
                );
              } else if (hasResultFilter) {
                showNotification(
                  t('auth_files.delete_filtered_result_partial', { success, failed }),
                  'warning'
                );
              } else if (isProblemOnly) {
                showNotification(
                  isFiltered
                    ? t('auth_files.delete_problem_filtered_partial', {
                        success,
                        failed,
                        type: typeLabel,
                      })
                    : t('auth_files.delete_problem_partial', { success, failed }),
                  'warning'
                );
              } else {
                showNotification(
                  t('auth_files.delete_filtered_partial', { success, failed, type: typeLabel }),
                  'warning'
                );
              }

              if (isFiltered) {
                onResetFilterToAll();
              }
              if (archiveFilter === 'archived') {
                onResetArchiveFilter?.();
              }
              if (isProblemOnly) {
                onResetProblemOnly?.();
              }
              if (isDisabledOnly) {
                onResetDisabledOnly?.();
              }
              if (isStatusCodeFiltered) {
                onResetStatusCodeFilter?.();
              }
              if (isEnabledOnly) {
                onResetEnabledOnly?.();
              }
            }
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : '';
            showNotification(`${t('notification.delete_failed')}: ${errorMessage}`, 'error');
          } finally {
            setDeletingAll(false);
          }
        },
      });
    },
    [applyDeletedFiles, deselectAll, files, showConfirmation, showNotification, t]
  );

  const handleDownload = useCallback(
    async (target: AuthFileSelectionTarget) => {
      const file = resolveFile(target);
      const name = file?.name ?? (typeof target === 'string' ? target : target.name);
      if (!name) return;
      try {
        const blob = await authFilesApi.download(file ?? target);
        downloadBlob({ filename: name, blob });
        showNotification(t('auth_files.download_success'), 'success');
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : '';
        showNotification(`${t('notification.download_failed')}: ${errorMessage}`, 'error');
      }
    },
    [resolveFile, showNotification, t]
  );

  const handleManualRefresh = useCallback(
    async (item: AuthFileItem) => {
      const name = item.name.trim();
      const identityKey = getAuthFileIdentityKey(item);
      const provider = item.type ?? item.provider;
      if (
        !name ||
        item.disabled === true ||
        isRuntimeOnlyAuthFile(item) ||
        !supportsAuthFileManualRefresh(provider) ||
        manualRefreshPendingRef.current.has(identityKey)
      ) {
        return;
      }

      manualRefreshPendingRef.current.add(identityKey);
      setManualRefreshing((prev) => ({ ...prev, [identityKey]: true }));

      try {
        await authFilesApi.requestManualRefresh(item);
        showNotification(t('auth_files.manual_refresh_requested', { name }), 'info');
        notifyAuthFilesChanged();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('notification.update_failed');
        showNotification(t('auth_files.manual_refresh_failed', { name, message }), 'error');
      } finally {
        manualRefreshPendingRef.current.delete(identityKey);
        setManualRefreshing((prev) => {
          if (!prev[identityKey]) return prev;
          const next = { ...prev };
          delete next[identityKey];
          return next;
        });
      }
    },
    [showNotification, t]
  );

  const handleStatusToggle = useCallback(
    async (item: AuthFileItem, enabled: boolean) => {
      const name = item.name;
      const identityKey = getAuthFileIdentityKey(item);
      const nextDisabled = !enabled;
      const previousDisabled = item.disabled === true;

      setStatusUpdating((prev) => ({ ...prev, [identityKey]: true }));
      setFiles((prev) =>
        prev.map((file) =>
          getAuthFileIdentityKey(file) === identityKey ? { ...file, disabled: nextDisabled } : file
        )
      );

      try {
        const res = await authFilesApi.setStatus(item, nextDisabled);
        setFiles((prev) =>
          prev.map((file) =>
            getAuthFileIdentityKey(file) === identityKey
              ? { ...file, disabled: res.disabled }
              : file
          )
        );
        showNotification(
          enabled
            ? t('auth_files.status_enabled_success', { name })
            : t('auth_files.status_disabled_success', { name }),
          'success'
        );
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : '';
        setFiles((prev) =>
          prev.map((file) =>
            getAuthFileIdentityKey(file) === identityKey
              ? { ...file, disabled: previousDisabled }
              : file
          )
        );
        showNotification(`${t('notification.update_failed')}: ${errorMessage}`, 'error');
      } finally {
        setStatusUpdating((prev) => {
          if (!prev[identityKey]) return prev;
          const next = { ...prev };
          delete next[identityKey];
          return next;
        });
      }
    },
    [showNotification, t]
  );

  const handleArchiveToggle = useCallback(
    async (item: AuthFileItem, archived: boolean) => {
      const name = item.name;
      const identityKey = getAuthFileIdentityKey(item);
      const previousArchived = isArchivedAuthFile(item);

      setArchiveUpdating((prev) => ({ ...prev, [identityKey]: true }));
      setFiles((prev) =>
        prev.map((file) =>
          getAuthFileIdentityKey(file) === identityKey ? { ...file, archived } : file
        )
      );

      try {
        const res = await authFilesApi.setArchived(item, archived);
        setFiles((prev) =>
          prev.map((f) =>
            getAuthFileIdentityKey(f) === identityKey
              ? { ...f, archived: res.archived === undefined ? archived : res.archived }
              : f
          )
        );
        showNotification(
          archived
            ? t('auth_files.archive_success', { name })
            : t('auth_files.unarchive_success', { name }),
          'success'
        );
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : '';
        setFiles((prev) =>
          prev.map((file) =>
            getAuthFileIdentityKey(file) === identityKey
              ? { ...file, archived: previousArchived }
              : file
          )
        );
        showNotification(`${t('notification.update_failed')}: ${errorMessage}`, 'error');
      } finally {
        setArchiveUpdating((prev) => {
          if (!prev[identityKey]) return prev;
          const next = { ...prev };
          delete next[identityKey];
          return next;
        });
      }
    },
    [showNotification, t]
  );

  const batchSetStatus = useCallback(
    async (targets: AuthFileSelectionTarget[], enabled: boolean) => {
      if (batchStatusPendingRef.current) return;

      const targetFiles = resolveFiles(targets);
      if (targetFiles.length === 0) return;
      const targetKeys = targetFiles.map((file) => getAuthFileIdentityKey(file));
      if (targetKeys.some((identityKey) => statusUpdating[identityKey] === true)) return;

      const originalDisabled = new Map(
        targetFiles.map((file) => [getAuthFileIdentityKey(file), file.disabled === true])
      );
      const targetNames = new Set(originalDisabled.keys());
      const targetNameList = Array.from(targetNames);
      if (targetNameList.length === 0) return;

      const nextDisabled = !enabled;

      batchStatusPendingRef.current = true;
      setBatchStatusUpdating(true);
      setStatusUpdating((prev) => {
        const next = { ...prev };
        targetNameList.forEach((identityKey) => {
          next[identityKey] = true;
        });
        return next;
      });
      setFiles((prev) =>
        prev.map((file) =>
          targetNames.has(getAuthFileIdentityKey(file)) ? { ...file, disabled: nextDisabled } : file
        )
      );

      try {
        const results = await Promise.allSettled(
          targetFiles.map((file) => authFilesApi.setStatus(file, nextDisabled))
        );

        let successCount = 0;
        let failCount = 0;
        const failedKeys = new Set<string>();
        const confirmedDisabled = new Map<string, boolean>();

        results.forEach((result, index) => {
          const identityKey = targetNameList[index];
          if (result.status === 'fulfilled') {
            successCount++;
            confirmedDisabled.set(identityKey, result.value.disabled);
          } else {
            failCount++;
            failedKeys.add(identityKey);
          }
        });

        setFiles((prev) =>
          prev.map((file) => {
            const identityKey = getAuthFileIdentityKey(file);
            if (failedKeys.has(identityKey)) {
              return { ...file, disabled: originalDisabled.get(identityKey) === true };
            }
            if (confirmedDisabled.has(identityKey)) {
              return { ...file, disabled: confirmedDisabled.get(identityKey) };
            }
            return file;
          })
        );

        if (failCount === 0) {
          showNotification(
            t('auth_files.batch_status_success', { count: successCount }),
            'success'
          );
        } else {
          showNotification(
            t('auth_files.batch_status_partial', { success: successCount, failed: failCount }),
            'warning'
          );
        }

        deselectAll();
      } finally {
        batchStatusPendingRef.current = false;
        setBatchStatusUpdating(false);
        setStatusUpdating((prev) => {
          const next = { ...prev };
          targetNameList.forEach((name) => {
            delete next[name];
          });
          return next;
        });
      }
    },
    [deselectAll, resolveFiles, showNotification, statusUpdating, t]
  );

  const batchSetArchived = useCallback(
    async (targets: AuthFileSelectionTarget[], archived: boolean) => {
      if (batchArchivePendingRef.current) return;

      const targetFiles = resolveFiles(targets);
      if (targetFiles.length === 0) return;
      const targetKeys = targetFiles.map((file) => getAuthFileIdentityKey(file));
      if (targetKeys.some((identityKey) => archiveUpdating[identityKey] === true)) return;

      const originalArchived = new Map(
        targetFiles.map((file) => [getAuthFileIdentityKey(file), isArchivedAuthFile(file)])
      );
      const targetNames = new Set(originalArchived.keys());
      const targetNameList = Array.from(targetNames);
      if (targetNameList.length === 0) return;

      batchArchivePendingRef.current = true;
      setBatchArchiveUpdating(true);
      setArchiveUpdating((prev) => {
        const next = { ...prev };
        targetNameList.forEach((identityKey) => {
          next[identityKey] = true;
        });
        return next;
      });
      setFiles((prev) =>
        prev.map((file) =>
          targetNames.has(getAuthFileIdentityKey(file)) ? { ...file, archived } : file
        )
      );

      try {
        const results = await Promise.allSettled(
          targetFiles.map((file) => authFilesApi.setArchived(file, archived))
        );

        let successCount = 0;
        let failCount = 0;
        const failedKeys = new Set<string>();
        const confirmedArchived = new Map<string, boolean>();

        results.forEach((result, index) => {
          const identityKey = targetNameList[index];
          if (result.status === 'fulfilled') {
            successCount++;
            confirmedArchived.set(
              identityKey,
              result.value.archived === undefined ? archived : result.value.archived
            );
          } else {
            failCount++;
            failedKeys.add(identityKey);
          }
        });

        setFiles((prev) =>
          prev.map((file) => {
            const identityKey = getAuthFileIdentityKey(file);
            if (failedKeys.has(identityKey)) {
              return { ...file, archived: originalArchived.get(identityKey) === true };
            }
            if (confirmedArchived.has(identityKey)) {
              return { ...file, archived: confirmedArchived.get(identityKey) };
            }
            return file;
          })
        );

        if (failCount === 0) {
          showNotification(
            archived
              ? t('auth_files.batch_archive_success', { count: successCount })
              : t('auth_files.batch_unarchive_success', { count: successCount }),
            'success'
          );
        } else {
          showNotification(
            t('auth_files.batch_archive_partial', { success: successCount, failed: failCount }),
            'warning'
          );
        }

        deselectAll();
      } finally {
        batchArchivePendingRef.current = false;
        setBatchArchiveUpdating(false);
        setArchiveUpdating((prev) => {
          const next = { ...prev };
          targetNameList.forEach((name) => {
            delete next[name];
          });
          return next;
        });
      }
    },
    [archiveUpdating, deselectAll, resolveFiles, showNotification, t]
  );

  const batchDownload = useCallback(
    async (targets: AuthFileSelectionTarget[]) => {
      const targetFiles = resolveFiles(targets);
      if (targetFiles.length === 0) return;

      let successCount = 0;
      let failCount = 0;

      for (const file of targetFiles) {
        try {
          const blob = await authFilesApi.download(file);
          downloadBlob({ filename: file.name, blob });
          successCount++;
        } catch {
          failCount++;
        }
      }

      if (failCount === 0) {
        showNotification(
          t('auth_files.batch_download_success', { count: successCount }),
          'success'
        );
      } else {
        showNotification(
          t('auth_files.batch_download_partial', { success: successCount, failed: failCount }),
          'warning'
        );
      }
    },
    [resolveFiles, showNotification, t]
  );

  const batchPatchFields = useCallback(
    async (
      targets: AuthFileSelectionTarget[],
      fields: AuthFileFieldsPatch
    ): Promise<BatchPatchFieldsResult | null> => {
      if (batchFieldsPendingRef.current || Object.keys(fields).length === 0) return null;

      const targetFiles = resolveFiles(targets).filter((file) => !isRuntimeOnlyAuthFile(file));
      if (targetFiles.length === 0) return null;

      batchFieldsPendingRef.current = true;
      setBatchFieldsUpdating(true);

      try {
        const succeeded = new Array<boolean>(targetFiles.length).fill(false);
        let nextIndex = 0;
        const workerCount = Math.min(BATCH_FIELD_UPDATE_CONCURRENCY, targetFiles.length);
        const workers = Array.from({ length: workerCount }, async () => {
          while (nextIndex < targetFiles.length) {
            const index = nextIndex;
            nextIndex += 1;
            try {
              await authFilesApi.patchFields(targetFiles[index], fields);
              succeeded[index] = true;
            } catch {
              succeeded[index] = false;
            }
          }
        });
        await Promise.all(workers);

        const failedNames = targetFiles
          .filter((_, index) => !succeeded[index])
          .map((file) => getAuthFileIdentityKey(file));
        const success = targetFiles.length - failedNames.length;

        if (success > 0) {
          notifyAuthFilesChanged();
          await loadFiles();
        }

        if (failedNames.length === 0) {
          showNotification(t('auth_files.batch_edit_success', { count: success }), 'success');
          deselectAll();
        } else {
          showNotification(
            t('auth_files.batch_edit_partial', {
              success,
              failed: failedNames.length,
            }),
            'warning'
          );
          setSelectedFiles(new Set(failedNames));
        }

        return { success, failedNames };
      } finally {
        batchFieldsPendingRef.current = false;
        setBatchFieldsUpdating(false);
      }
    },
    [deselectAll, loadFiles, resolveFiles, showNotification, t]
  );

  const batchDelete = useCallback(
    (targets: AuthFileSelectionTarget[]) => {
      const targetFiles = resolveFiles(targets);
      if (targetFiles.length === 0) return;

      showConfirmation({
        title: t('auth_files.batch_delete_title'),
        message: t('auth_files.batch_delete_confirm', { count: targetFiles.length }),
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: async () => {
          try {
            const result = await authFilesApi.deleteFiles(targetFiles);
            const successfulTargets = targetFiles.filter(
              (file) => !result.failed.some((failure) => isDeleteFailureForFile(file, failure))
            );
            applyDeletedFiles(result.failed.length === 0 ? targetFiles : successfulTargets);
            if (result.deleted > 0) notifyAuthFilesChanged();

            if (result.failed.length === 0) {
              showNotification(
                `${t('auth_files.delete_all_success')} (${result.deleted})`,
                'success'
              );
            } else {
              showNotification(
                t('auth_files.delete_filtered_partial', {
                  success: result.deleted,
                  failed: result.failed.length,
                  type: t('auth_files.filter_all'),
                }),
                'warning'
              );
            }
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : '';
            showNotification(`${t('notification.delete_failed')}: ${errorMessage}`, 'error');
          }
        },
      });
    },
    [applyDeletedFiles, resolveFiles, showConfirmation, showNotification, t]
  );

  return {
    files,
    selectedFiles,
    selectionCount,
    loading,
    refreshing,
    error,
    uploading,
    deleting,
    deletingAll,
    statusUpdating,
    manualRefreshing,
    batchStatusUpdating,
    archiveUpdating,
    batchArchiveUpdating,
    batchFieldsUpdating,
    fileInputRef,
    loadFiles,
    handleUploadClick,
    handleFileChange,
    handleDelete,
    handleDeleteAll,
    handleDownload,
    handleManualRefresh,
    handleStatusToggle,
    handleArchiveToggle,
    toggleSelect,
    selectAllVisible,
    deselectVisible,
    invertVisibleSelection,
    deselectAll,
    batchDownload,
    batchSetStatus,
    batchSetArchived,
    batchPatchFields,
    batchDelete,
  };
}
