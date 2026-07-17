export const AUTH_FILES_SORT_MODES = ['default', 'az', 'priority'] as const;
export const AUTH_FILES_STATUS_CODE_FILTERS = ['all', '401', '403', '429'] as const;
export const AUTH_FILES_ARCHIVE_FILTERS = ['active', 'archived', 'all'] as const;
export const AUTH_FILES_STATUS_FILTER_MODES = [
  'all',
  'enabled',
  'disabled',
  'problem',
] as const;

export type AuthFilesSortMode = (typeof AUTH_FILES_SORT_MODES)[number];
export type AuthFilesStatusCodeFilter = (typeof AUTH_FILES_STATUS_CODE_FILTERS)[number];
export type AuthFilesArchiveFilter = (typeof AUTH_FILES_ARCHIVE_FILTERS)[number];
export type AuthFilesStatusFilterMode = (typeof AUTH_FILES_STATUS_FILTER_MODES)[number];

export type AuthFilesUiState = {
  filter?: string;
  archiveFilter?: AuthFilesArchiveFilter;
  problemOnly?: boolean;
  disabledOnly?: boolean;
  statusCodeFilter?: AuthFilesStatusCodeFilter;
  enabledOnly?: boolean;
  statusFilterMode?: AuthFilesStatusFilterMode;
  compactMode?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
  regularPageSize?: number;
  compactPageSize?: number;
  sortMode?: AuthFilesSortMode;
};

const AUTH_FILES_UI_STATE_KEY = 'authFilesPage.uiState';
const AUTH_FILES_COMPACT_MODE_KEY = 'authFilesPage.compactMode';
const AUTH_FILES_SORT_MODE_SET = new Set<AuthFilesSortMode>(AUTH_FILES_SORT_MODES);
const AUTH_FILES_STATUS_CODE_FILTER_SET = new Set<AuthFilesStatusCodeFilter>(
  AUTH_FILES_STATUS_CODE_FILTERS
);
const AUTH_FILES_ARCHIVE_FILTER_SET = new Set<AuthFilesArchiveFilter>(AUTH_FILES_ARCHIVE_FILTERS);
const AUTH_FILES_STATUS_FILTER_MODE_SET = new Set<AuthFilesStatusFilterMode>(
  AUTH_FILES_STATUS_FILTER_MODES
);

export const isAuthFilesSortMode = (value: unknown): value is AuthFilesSortMode =>
  typeof value === 'string' && AUTH_FILES_SORT_MODE_SET.has(value as AuthFilesSortMode);

export const isAuthFilesStatusCodeFilter = (value: unknown): value is AuthFilesStatusCodeFilter =>
  typeof value === 'string' &&
  AUTH_FILES_STATUS_CODE_FILTER_SET.has(value as AuthFilesStatusCodeFilter);

export const isAuthFilesArchiveFilter = (value: unknown): value is AuthFilesArchiveFilter =>
  typeof value === 'string' && AUTH_FILES_ARCHIVE_FILTER_SET.has(value as AuthFilesArchiveFilter);

export const isAuthFilesStatusFilterMode = (value: unknown): value is AuthFilesStatusFilterMode =>
  typeof value === 'string' &&
  AUTH_FILES_STATUS_FILTER_MODE_SET.has(value as AuthFilesStatusFilterMode);

const readAuthFilesUiStateFromStorage = (
  storage: Pick<Storage, 'getItem'> | null | undefined
): AuthFilesUiState | null => {
  if (!storage) return null;
  const raw = storage.getItem(AUTH_FILES_UI_STATE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as AuthFilesUiState;
  return parsed && typeof parsed === 'object' ? parsed : null;
};

export const readAuthFilesUiState = (): AuthFilesUiState | null => {
  if (typeof window === 'undefined') return null;
  try {
    return (
      readAuthFilesUiStateFromStorage(window.localStorage) ??
      readAuthFilesUiStateFromStorage(window.sessionStorage)
    );
  } catch {
    return null;
  }
};

export const writeAuthFilesUiState = (state: AuthFilesUiState) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUTH_FILES_UI_STATE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
  try {
    window.sessionStorage.removeItem(AUTH_FILES_UI_STATE_KEY);
  } catch {
    // ignore
  }
};

export const readPersistedAuthFilesCompactMode = (): boolean | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AUTH_FILES_COMPACT_MODE_KEY);
    if (raw === null) return null;
    return JSON.parse(raw) === true;
  } catch {
    return null;
  }
};

export const writePersistedAuthFilesCompactMode = (compactMode: boolean) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUTH_FILES_COMPACT_MODE_KEY, JSON.stringify(compactMode));
  } catch {
    // ignore
  }
};
