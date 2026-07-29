import type { AuthFileItem } from '@/types';
import {
  hasAuthFileStatusMessage,
  isArchivedAuthFile,
  normalizeProviderKey,
} from '@/features/authFiles/constants';
import type {
  AuthFilesArchiveFilter,
  AuthFilesStatusCodeFilter,
} from '@/features/authFiles/uiState';

export type AuthFilesFilterPipelineOptions = {
  files: AuthFileItem[];
  providerFilter: string;
  archiveFilter: AuthFilesArchiveFilter;
  statusCodeFilter: AuthFilesStatusCodeFilter;
  problemOnly: boolean;
  disabledOnly: boolean;
  enabledOnly: boolean;
  getStatusCode: (file: AuthFileItem) => number | null;
};

export type AuthFilesFilterPipelineResult = {
  existingTypes: string[];
  typeCounts: Record<string, number>;
  archiveFilterCounts: Record<AuthFilesArchiveFilter, number>;
  statusCodeCounts: Record<AuthFilesStatusCodeFilter, number>;
  filesMatchingStatusFilters: AuthFileItem[];
};

export const buildAuthFilesFilterPipeline = (
  options: AuthFilesFilterPipelineOptions
): AuthFilesFilterPipelineResult => {
  const {
    files,
    providerFilter,
    archiveFilter,
    statusCodeFilter,
    problemOnly,
    disabledOnly,
    enabledOnly,
    getStatusCode,
  } = options;

  const existingTypes = new Set<string>(['all']);
  const typeCounts: Record<string, number> = { all: files.length };
  files.forEach((file) => {
    const type = normalizeProviderKey(String(file.type ?? file.provider ?? ''));
    if (!type) return;
    existingTypes.add(type);
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
  });

  // 提供方是上层数据域；下层状态和封存筛选只能继续收窄该范围。
  const normalizedProvider = normalizeProviderKey(providerFilter);
  const providerFiles =
    normalizedProvider === 'all'
      ? files
      : files.filter(
          (file) =>
            normalizeProviderKey(String(file.type ?? file.provider ?? '')) === normalizedProvider
        );

  const filesMatchingResultFilters = providerFiles.filter((file) => {
    if (enabledOnly && file.disabled === true) return false;
    if (disabledOnly && file.disabled !== true) return false;
    if (problemOnly && !hasAuthFileStatusMessage(file)) return false;
    return true;
  });

  const archived = filesMatchingResultFilters.filter(isArchivedAuthFile).length;
  const archiveFilterCounts = {
    active: filesMatchingResultFilters.length - archived,
    archived,
    all: filesMatchingResultFilters.length,
  } satisfies Record<AuthFilesArchiveFilter, number>;

  const filesMatchingArchiveFilter = filesMatchingResultFilters.filter((file) => {
    if (archiveFilter === 'active') return !isArchivedAuthFile(file);
    if (archiveFilter === 'archived') return isArchivedAuthFile(file);
    return true;
  });

  const statusCodeCounts: Record<AuthFilesStatusCodeFilter, number> = {
    all: filesMatchingArchiveFilter.length,
    '401': 0,
    '403': 0,
    '429': 0,
  };
  filesMatchingArchiveFilter.forEach((file) => {
    const code = getStatusCode(file);
    if (code === 401) statusCodeCounts['401'] += 1;
    if (code === 403) statusCodeCounts['403'] += 1;
    if (code === 429) statusCodeCounts['429'] += 1;
  });

  const filesMatchingStatusFilters =
    statusCodeFilter === 'all'
      ? filesMatchingArchiveFilter
      : filesMatchingArchiveFilter.filter(
          (file) => getStatusCode(file) === Number(statusCodeFilter)
        );

  return {
    existingTypes: Array.from(existingTypes),
    typeCounts,
    archiveFilterCounts,
    statusCodeCounts,
    filesMatchingStatusFilters,
  };
};
