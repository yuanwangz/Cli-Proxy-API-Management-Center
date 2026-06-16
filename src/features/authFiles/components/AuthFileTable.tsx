import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconDownload,
  IconInbox,
  IconInfo,
  IconModelCluster,
  IconRefreshCw,
  IconSettings,
  IconTrash2,
} from '@/components/ui/icons';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import type { CredentialInspectionResult } from '@/features/authFiles/hooks/useCredentialInspection';
import type { AuthFileStatusBarData } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import type { AuthFileItem } from '@/types';
import { formatFileSize } from '@/utils/format';
import {
  normalizeRecentRequestAuthIndex,
  normalizeRecentRequestBuckets,
  normalizeUsageTotal,
  statusBarDataFromRecentRequests,
} from '@/utils/recentRequests';
import {
  formatCreated,
  formatModified,
  getAuthFileIcon,
  getAuthFileStatusCode,
  getAuthFileStatusMessage,
  getTypeColor,
  getTypeLabel,
  isArchivedAuthFile,
  isRuntimeOnlyAuthFile,
  normalizeProviderKey,
  parsePriorityValue,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import styles from '@/pages/AuthFilesPage.module.scss';

const HEALTHY_STATUS_MESSAGES = new Set(['ok', 'healthy', 'ready', 'success', 'available']);

export type AuthFileTableProps = {
  files: AuthFileItem[];
  compact: boolean;
  selectedFiles: Set<string>;
  resolvedTheme: ResolvedTheme;
  disableControls: boolean;
  deleting: string | null;
  statusUpdating: Record<string, boolean>;
  archiveUpdating: Record<string, boolean>;
  statusBarCache: Map<string, AuthFileStatusBarData>;
  inspectionResults: Record<string, CredentialInspectionResult>;
  inspectionRunning: boolean;
  onShowModels: (file: AuthFileItem) => void;
  onDownload: (name: string) => void;
  onOpenPrefixProxyEditor: (file: AuthFileItem) => void;
  onDelete: (name: string) => void;
  onToggleStatus: (file: AuthFileItem, enabled: boolean) => void;
  onToggleArchive: (file: AuthFileItem, archived: boolean) => void;
  onToggleSelect: (name: string) => void;
  onSelectPage: (files: AuthFileItem[]) => void;
  onDeselectPage: (files: AuthFileItem[]) => void;
  onInspectOne: (file: AuthFileItem) => void;
};

const inspectionClassName = (result?: CredentialInspectionResult) => {
  if (!result) return styles.inspectionIdle;
  switch (result.status) {
    case 'healthy':
      return styles.inspectionHealthy;
    case 'limited':
      return styles.inspectionLimited;
    case 'disabled':
      return styles.inspectionDisabled;
    case 'unsupported':
      return styles.inspectionUnsupported;
    case 'error':
      return styles.inspectionError;
    case 'checking':
    default:
      return styles.inspectionChecking;
  }
};

const inspectionLabelKey = (result?: CredentialInspectionResult) => {
  if (!result) return 'auth_files.inspection_not_checked';
  return `auth_files.inspection_status_${result.status}`;
};

export function AuthFileTable({
  files,
  compact,
  selectedFiles,
  resolvedTheme,
  disableControls,
  deleting,
  statusUpdating,
  archiveUpdating,
  statusBarCache,
  inspectionResults,
  inspectionRunning,
  onShowModels,
  onDownload,
  onOpenPrefixProxyEditor,
  onDelete,
  onToggleStatus,
  onToggleArchive,
  onToggleSelect,
  onSelectPage,
  onDeselectPage,
  onInspectOne,
}: AuthFileTableProps) {
  const { t } = useTranslation();
  const selectableFiles = useMemo(
    () => files.filter((file) => !isRuntimeOnlyAuthFile(file)),
    [files]
  );
  const allVisibleSelected =
    selectableFiles.length > 0 && selectableFiles.every((file) => selectedFiles.has(file.name));

  return (
    <div className={`${styles.authTableShell} ${compact ? styles.authTableShellCompact : ''}`}>
      <div className={styles.authTable}>
        <div className={styles.authTableHeader}>
          <div className={styles.authTableSelectCell}>
            <SelectionCheckbox
              checked={allVisibleSelected}
              onChange={(checked) => (checked ? onSelectPage(files) : onDeselectPage(files))}
              disabled={selectableFiles.length === 0}
              ariaLabel={t('auth_files.batch_select_page')}
              title={t('auth_files.batch_select_page')}
            />
          </div>
          <div>{t('auth_files.table_column_credential')}</div>
          <div>{t('auth_files.table_column_status')}</div>
          <div>{t('auth_files.table_column_activity')}</div>
          <div>{t('auth_files.table_column_inspection')}</div>
          <div>{t('auth_files.table_column_meta')}</div>
          <div>{t('common.action')}</div>
        </div>

        {files.map((file) => {
          const isRuntimeOnly = isRuntimeOnlyAuthFile(file);
          const isArchived = isArchivedAuthFile(file);
          const selected = selectedFiles.has(file.name);
          const providerKey = normalizeProviderKey(String(file.type ?? file.provider ?? 'unknown'));
          const typeColor = getTypeColor(providerKey, resolvedTheme);
          const typeLabel = getTypeLabel(t, providerKey);
          const providerIcon = getAuthFileIcon(providerKey, resolvedTheme);
          const recentBuckets = normalizeRecentRequestBuckets(
            file.recent_requests ?? file.recentRequests
          );
          const rawAuthIndex = file['auth_index'] ?? file.authIndex;
          const authIndexKey = normalizeRecentRequestAuthIndex(rawAuthIndex);
          const statusData =
            (authIndexKey && statusBarCache.get(authIndexKey)) ||
            statusBarDataFromRecentRequests(recentBuckets);
          const rawStatusMessage = getAuthFileStatusMessage(file);
          const hasStatusWarning =
            Boolean(rawStatusMessage) &&
            !HEALTHY_STATUS_MESSAGES.has(rawStatusMessage.toLowerCase());
          const statusCode = getAuthFileStatusCode(file);
          const priorityValue = parsePriorityValue(file.priority ?? file['priority']);
          const noteValue = typeof file.note === 'string' ? file.note.trim() : '';
          const accountValue =
            typeof file.account === 'string'
              ? file.account.trim()
              : typeof file.email === 'string'
                ? file.email.trim()
                : '';
          const stateLabel = isRuntimeOnly
            ? t('auth_files.type_virtual')
            : isArchived
              ? t('auth_files.health_status_archived')
              : file.disabled
                ? t('auth_files.health_status_disabled')
                : hasStatusWarning
                  ? t('auth_files.health_status_warning')
                  : rawStatusMessage
                    ? t('auth_files.health_status_healthy')
                    : t('auth_files.status_toggle_label');
          const stateBadgeClass = isRuntimeOnly
            ? styles.stateBadgeVirtual
            : isArchived
              ? styles.stateBadgeArchived
              : file.disabled
                ? styles.stateBadgeDisabled
                : hasStatusWarning
                  ? styles.stateBadgeWarning
                  : styles.stateBadgeActive;
          const inspection = inspectionResults[file.name];
          const fileStats = {
            success: normalizeUsageTotal(file.success),
            failure: normalizeUsageTotal(file.failed),
          };
          const showModelsButton = !isRuntimeOnly || providerKey === 'aistudio';

          return (
            <div
              key={file.name}
              className={`${styles.authTableRow} ${selected ? styles.authTableRowSelected : ''} ${file.disabled ? styles.authTableRowDisabled : ''} ${isArchived ? styles.authTableRowArchived : ''}`}
            >
              <div className={styles.authTableSelectCell}>
                {!isRuntimeOnly && (
                  <SelectionCheckbox
                    checked={selected}
                    onChange={() => onToggleSelect(file.name)}
                    ariaLabel={
                      selected ? t('auth_files.batch_deselect') : t('auth_files.batch_select_all')
                    }
                    title={
                      selected ? t('auth_files.batch_deselect') : t('auth_files.batch_select_all')
                    }
                  />
                )}
              </div>

              <div className={styles.authCredentialCell}>
                <div
                  className={styles.providerAvatarSmall}
                  style={{
                    backgroundColor: typeColor.bg,
                    color: typeColor.text,
                    ...(typeColor.border ? { border: typeColor.border } : {}),
                  }}
                >
                  {providerIcon ? (
                    <img src={providerIcon} alt="" className={styles.providerAvatarSmallImage} />
                  ) : (
                    <span>{typeLabel.slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
                <div className={styles.authCredentialText}>
                  <div className={styles.authCredentialBadges}>
                    <span
                      className={styles.typeBadge}
                      style={{
                        backgroundColor: typeColor.bg,
                        color: typeColor.text,
                        ...(typeColor.border ? { border: typeColor.border } : {}),
                      }}
                    >
                      {typeLabel}
                    </span>
                    {priorityValue !== undefined && (
                      <span className={styles.priorityInline}>
                        {t('auth_files.priority_display')} {priorityValue}
                      </span>
                    )}
                  </div>
                  <span className={styles.authCredentialName} title={file.name}>
                    {file.name}
                  </span>
                  {(accountValue || noteValue) && (
                    <span className={styles.authCredentialSub} title={noteValue || accountValue}>
                      {noteValue || accountValue}
                    </span>
                  )}
                </div>
              </div>

              <div className={styles.authStatusCell}>
                <span className={`${styles.stateBadge} ${stateBadgeClass}`}>{stateLabel}</span>
                {statusCode ? (
                  <span className={styles.statusCodePill}>HTTP {statusCode}</span>
                ) : null}
                {rawStatusMessage && hasStatusWarning ? (
                  <span className={styles.authStatusMessage} title={rawStatusMessage}>
                    <IconInfo size={13} />
                    {rawStatusMessage}
                  </span>
                ) : null}
              </div>

              <div className={styles.authActivityCell}>
                <div className={styles.authStatsLine}>
                  <span className={styles.statSuccess}>
                    {t('stats.success')} {fileStats.success}
                  </span>
                  <span className={styles.statFailure}>
                    {t('stats.failure')} {fileStats.failure}
                  </span>
                </div>
                <ProviderStatusBar statusData={statusData} styles={styles} />
              </div>

              <div className={styles.authInspectionCell}>
                <div
                  className={`${styles.inspectionBadge} ${inspectionClassName(inspection)}`}
                  title={inspection?.message}
                >
                  {inspection?.status === 'checking' ? <LoadingSpinner size={12} /> : null}
                  <span>{t(inspectionLabelKey(inspection))}</span>
                  {inspection?.statusCode ? <strong>{inspection.statusCode}</strong> : null}
                </div>
                {inspection?.checkedAtMs ? (
                  <span className={styles.inspectionTime}>
                    {new Date(inspection.checkedAtMs).toLocaleTimeString()}
                  </span>
                ) : null}
              </div>

              <div className={styles.authMetaCell}>
                <span>{file.size ? formatFileSize(file.size) : '-'}</span>
                <span title={`${t('auth_files.file_created')}: ${formatCreated(file)}`}>
                  {t('auth_files.file_created_short')} {formatCreated(file)}
                </span>
                <span title={`${t('auth_files.file_modified')}: ${formatModified(file)}`}>
                  {t('auth_files.file_modified_short')} {formatModified(file)}
                </span>
              </div>

              <div className={styles.authActionsCell}>
                {showModelsButton && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onShowModels(file)}
                    className={styles.iconButton}
                    title={t('auth_files.models_button')}
                    disabled={disableControls}
                  >
                    <IconModelCluster size={15} />
                  </Button>
                )}
                {!isRuntimeOnly && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onInspectOne(file)}
                      className={styles.iconButton}
                      title={t('auth_files.inspection_single_button')}
                      disabled={disableControls || inspectionRunning || isArchived}
                    >
                      <IconRefreshCw size={15} />
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onDownload(file.name)}
                      className={styles.iconButton}
                      title={t('auth_files.download_button')}
                      disabled={disableControls}
                    >
                      <IconDownload size={15} />
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onOpenPrefixProxyEditor(file)}
                      className={styles.iconButton}
                      title={t('auth_files.prefix_proxy_button')}
                      disabled={disableControls}
                    >
                      <IconSettings size={15} />
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onToggleArchive(file, !isArchived)}
                      className={styles.iconButton}
                      title={
                        isArchived
                          ? t('auth_files.unarchive_button')
                          : t('auth_files.archive_button')
                      }
                      disabled={disableControls || archiveUpdating[file.name] === true}
                    >
                      {archiveUpdating[file.name] === true ? (
                        <LoadingSpinner size={14} />
                      ) : (
                        <IconInbox size={15} />
                      )}
                    </Button>
                    <ToggleSwitch
                      checked={!file.disabled}
                      onChange={(enabled) => onToggleStatus(file, enabled)}
                      ariaLabel={t('auth_files.status_toggle_label')}
                      disabled={
                        disableControls ||
                        isArchived ||
                        statusUpdating[file.name] === true ||
                        archiveUpdating[file.name] === true
                      }
                    />
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => onDelete(file.name)}
                      className={styles.iconButton}
                      title={t('auth_files.delete_button')}
                      disabled={disableControls || deleting === file.name}
                    >
                      {deleting === file.name ? (
                        <LoadingSpinner size={14} />
                      ) : (
                        <IconTrash2 size={15} />
                      )}
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
