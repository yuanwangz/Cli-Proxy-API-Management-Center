/**
 * 认证文件与 OAuth 排除模型相关 API
 */

import { apiClient } from './client';
import type { AuthFileItem, AuthFilesResponse } from '@/types/authFile';
import type { OAuthModelAliasEntry } from '@/types';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';
import { getAuthFileIdentityKey } from '@/features/authFiles/identity';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import {
  normalizeRecentRequestAuthIndex,
  normalizeRecentRequestBuckets,
  normalizeUsageTotal,
} from '@/utils/recentRequests';
import { parseTimestampMs } from '@/utils/timestamp';
import { normalizeAuthFileCooldowns, normalizeCooldownTimestamp } from './authFileCooldowns';

type StatusError = { status?: number };
type AuthFileStatusResponse = { status: string; disabled: boolean; archived?: boolean };
type AuthFileRefreshResponse = {
  status?: string;
  disabled?: boolean;
  file?: AuthFileEntry;
};
export type AuthFileLookup = {
  name: string;
  authIndex?: string | number | null;
  auth_index?: string | number | null;
};
export type AuthFileTarget = AuthFileItem | AuthFileLookup | string;
type AuthFileEntry = AuthFilesResponse['files'][number];
export type AuthFileFieldsPatch = {
  prefix?: string;
  proxy_url?: string;
  headers?: Record<string, string>;
  priority?: number;
  weight?: number | null;
  disable_cooling?: boolean;
  'disable-cooling'?: boolean;
  websockets?: boolean;
  using_api?: boolean;
  note?: string;
  excluded_models?: string[];
  'excluded-models'?: string[];
  expired?: string;
};
type AuthFileBatchFailure = { name: string; authIndex?: string; error: string };
type AuthFileBatchUploadResponse = {
  status?: string;
  uploaded?: number;
  files?: unknown;
  failed?: unknown;
};
type AuthFileBatchDeleteResponse = {
  status?: string;
  deleted?: number;
  files?: unknown;
  failed?: unknown;
};
type AuthFileBatchUploadResult = {
  status: string;
  uploaded: number;
  files: string[];
  failed: AuthFileBatchFailure[];
};
type AuthFileBatchDeleteResult = {
  status: string;
  deleted: number;
  files: string[];
  failed: AuthFileBatchFailure[];
};

const normalizeAuthFileLookup = (
  target: AuthFileTarget,
  authIndex?: string | number | null
): AuthFileLookup => {
  if (typeof target === 'string') {
    return {
      name: target.trim(),
      authIndex: normalizeRecentRequestAuthIndex(authIndex) ?? undefined,
    };
  }

  return {
    name: String(target.name ?? '').trim(),
    authIndex:
      normalizeRecentRequestAuthIndex(target.authIndex ?? target.auth_index ?? authIndex) ??
      undefined,
  };
};

const authFileLookupParams = (lookup: AuthFileLookup): Record<string, string> => ({
  name: lookup.name,
  ...(lookup.authIndex ? { auth_index: String(lookup.authIndex) } : {}),
});

const authFileLookupPayload = (lookup: AuthFileLookup): Record<string, string> =>
  authFileLookupParams(lookup);

const normalizeAuthFileTargets = (targets: AuthFileTarget[]): AuthFileLookup[] => {
  const seen = new Set<string>();
  const normalized: AuthFileLookup[] = [];

  targets.forEach((target) => {
    const lookup = normalizeAuthFileLookup(target);
    if (!lookup.name) return;
    const identityKey = getAuthFileIdentityKey({
      name: lookup.name,
      authIndex: lookup.authIndex,
    });
    if (seen.has(identityKey)) return;
    seen.add(identityKey);
    normalized.push(lookup);
  });

  return normalized;
};

const getStatusCode = (err: unknown): number | undefined => {
  if (!err || typeof err !== 'object') return undefined;
  if ('status' in err) return (err as StatusError).status;
  return undefined;
};

const normalizeRequestedAuthFileNames = (names: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  names.forEach((name) => {
    const trimmed = String(name ?? '').trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    normalized.push(trimmed);
  });

  return normalized;
};

const normalizeBatchFileNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
};

const normalizeBatchFailures = (value: unknown): AuthFileBatchFailure[] => {
  if (!Array.isArray(value)) return [];

  return value.reduce<AuthFileBatchFailure[]>((result, item) => {
    if (!item || typeof item !== 'object') return result;
    const entry = item as Record<string, unknown>;
    const name = String(entry.name ?? '').trim();
    const authIndex = normalizeRecentRequestAuthIndex(entry.auth_index ?? entry.authIndex);
    const error =
      typeof entry.error === 'string'
        ? entry.error.trim()
        : typeof entry.message === 'string'
          ? entry.message.trim()
          : '';

    if (!name && !error) return result;
    result.push({
      name,
      ...(authIndex ? { authIndex } : {}),
      error: error || 'Unknown error',
    });
    return result;
  }, []);
};

const deriveSuccessfulFileNames = (
  requestedNames: string[],
  failed: AuthFileBatchFailure[]
): string[] => {
  const failedNames = new Set(failed.map((entry) => entry.name.trim()).filter(Boolean));

  if (failedNames.size === 0) {
    return [...requestedNames];
  }

  return requestedNames.filter((name) => !failedNames.has(name));
};

const deriveSuccessfulTargetNames = (
  requestedTargets: AuthFileLookup[],
  failed: AuthFileBatchFailure[]
): string[] =>
  requestedTargets
    .filter(
      (target) =>
        !failed.some(
          (failure) =>
            failure.name === target.name &&
            (!failure.authIndex || failure.authIndex === target.authIndex)
        )
    )
    .map((target) => target.name);

const normalizeBatchUploadResponse = (
  payload: AuthFileBatchUploadResponse | undefined,
  requestedNames: string[]
): AuthFileBatchUploadResult => {
  const failed = normalizeBatchFailures(payload?.failed);
  const filesFromPayload = normalizeBatchFileNames(payload?.files);
  // Backend single-file success path returns only {status:"ok"} (auth_files.go:680).
  // Derive count + names from the request when no failures and counts are absent.
  const inferFromRequest = payload?.uploaded === undefined && failed.length === 0;
  const derivedFiles = deriveSuccessfulFileNames(requestedNames, failed);
  const uploaded =
    typeof payload?.uploaded === 'number'
      ? payload.uploaded
      : filesFromPayload.length > 0
        ? filesFromPayload.length
        : inferFromRequest
          ? requestedNames.length
          : 0;
  const files =
    filesFromPayload.length > 0
      ? filesFromPayload
      : inferFromRequest
        ? [...requestedNames]
        : uploaded > 0 && derivedFiles.length === uploaded
          ? derivedFiles
          : [];

  return {
    status:
      typeof payload?.status === 'string' ? payload.status : failed.length > 0 ? 'partial' : 'ok',
    uploaded,
    files,
    failed,
  };
};

const normalizeBatchDeleteResponse = (
  payload: AuthFileBatchDeleteResponse | undefined,
  requestedTargets: AuthFileLookup[]
): AuthFileBatchDeleteResult => {
  const failed = normalizeBatchFailures(payload?.failed);
  const filesFromPayload = normalizeBatchFileNames(payload?.files);
  // Backend single-name delete returns only {status:"ok"} (auth_files.go:794).
  const inferFromRequest = payload?.deleted === undefined && failed.length === 0;
  // Keep duplicate names when distinct auth_index targets were requested. The backend
  // identifies those targets separately even though its response currently exposes names.
  const derivedFiles = deriveSuccessfulTargetNames(requestedTargets, failed);
  const deleted =
    typeof payload?.deleted === 'number'
      ? payload.deleted
      : filesFromPayload.length > 0
        ? filesFromPayload.length
        : inferFromRequest
          ? requestedTargets.length
          : 0;
  const files =
    filesFromPayload.length > 0
      ? filesFromPayload
      : inferFromRequest
        ? [...derivedFiles]
        : deleted > 0 && derivedFiles.length === deleted
          ? derivedFiles
          : [];

  return {
    status:
      typeof payload?.status === 'string' ? payload.status : failed.length > 0 ? 'partial' : 'ok',
    deleted,
    files,
    failed,
  };
};

const readTextField = (entry: AuthFileEntry, key: string): string => {
  const value = entry[key];
  return typeof value === 'string' ? value.trim() : '';
};

const readDateField = (entry: AuthFileEntry): number => {
  const candidates = [entry['modtime'], entry['updated_at'], entry['last_refresh']];

  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 1e12 ? value * 1000 : value;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;
      const asNumber = Number(trimmed);
      if (Number.isFinite(asNumber)) {
        return asNumber < 1e12 ? asNumber * 1000 : asNumber;
      }
      const parsed = parseTimestampMs(trimmed);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
};

const isRuntimeOnlyEntry = (entry: AuthFileEntry): boolean => entry['runtime_only'] === true;

const hasMeaningfulValue = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

const countMeaningfulFields = (entry: AuthFileEntry): number =>
  Object.values(entry).reduce<number>(
    (count, value) => count + (hasMeaningfulValue(value) ? 1 : 0),
    0
  );

const authFilePriorityScore = (entry: AuthFileEntry): number => {
  let score = 0;
  if (readTextField(entry, 'source').toLowerCase() === 'file') score += 32;
  if (readTextField(entry, 'path')) score += 16;
  if (!isRuntimeOnlyEntry(entry)) score += 8;
  if (entry.disabled !== true) score += 4;
  if (readDateField(entry) > 0) score += 2;
  return score;
};

const compareAuthFileEntries = (left: AuthFileEntry, right: AuthFileEntry): number => {
  const scoreDiff = authFilePriorityScore(right) - authFilePriorityScore(left);
  if (scoreDiff !== 0) return scoreDiff;

  const dateDiff = readDateField(right) - readDateField(left);
  if (dateDiff !== 0) return dateDiff;

  const fieldDiff = countMeaningfulFields(right) - countMeaningfulFields(left);
  if (fieldDiff !== 0) return fieldDiff;

  return 0;
};

const mergeAuthFileEntries = (entries: AuthFileEntry[]): AuthFileEntry => {
  const [primary, ...rest] = [...entries].sort(compareAuthFileEntries);
  const merged: AuthFileEntry = { ...primary };

  rest.forEach((entry) => {
    Object.entries(entry).forEach(([key, value]) => {
      // Cooldown snapshots are atomic: [] and null are meaningful, not missing fields.
      if (key === 'cooldowns' && Object.prototype.hasOwnProperty.call(merged, key)) return;
      if (!hasMeaningfulValue(merged[key]) && hasMeaningfulValue(value)) {
        merged[key] = value;
      }
    });
  });

  return merged;
};

const INTEGER_STRING_PATTERN = /^[+-]?\d+$/;

const readIntegerField = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || !INTEGER_STRING_PATTERN.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

const readRuntimeOnlyField = (entry: AuthFileEntry): boolean => {
  const raw = entry['runtime_only'] ?? entry.runtimeOnly;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw.trim().toLowerCase() === 'true';
  return false;
};

/**
 * 契约边界归一化：把后端 kebab/snake_case 生字段填充到 AuthFileItem 声明的
 * camelCase 字段上。原始字段全部透传——quota resolvers 仍直接读
 * plan_type / id_token / metadata / attributes 等生字段。
 */
const normalizeAuthFileEntry = (
  entry: AuthFileEntry,
  observedAt: string | undefined,
  receivedAtMs: number
): AuthFileEntry => {
  const declaredStatusMessage =
    typeof entry.statusMessage === 'string' ? entry.statusMessage.trim() : '';
  const statusMessage = readTextField(entry, 'status_message') || declaredStatusMessage;
  const note = readTextField(entry, 'note');
  const email = readTextField(entry, 'email');
  // account / account_type 故意不归一化：api-key 类凭证的 account 就是 API key 本身
  // （sdk/cliproxy/auth/types.go AccountInfo），不能进入展示与搜索路径。
  const projectId = readTextField(entry, 'project_id');
  const modified = readDateField(entry);
  const priority = readIntegerField(entry['priority']);
  const weight = readIntegerField(entry['weight']);

  return {
    ...entry,
    cooldownSnapshot: normalizeAuthFileCooldowns(entry.cooldowns, observedAt, receivedAtMs),
    runtimeOnly: readRuntimeOnlyField(entry),
    authIndex: normalizeRecentRequestAuthIndex(entry['auth_index'] ?? entry.authIndex),
    recentRequests: normalizeRecentRequestBuckets(entry.recent_requests ?? entry.recentRequests),
    successCount: normalizeUsageTotal(entry.success),
    failureCount: normalizeUsageTotal(entry.failed),
    ...(statusMessage ? { statusMessage } : {}),
    ...(modified > 0 ? { modified } : {}),
    priority,
    weight,
    ...(note ? { note } : {}),
    ...(email ? { email } : {}),
    ...(projectId ? { projectId } : {}),
  };
};

export const normalizeAuthFilesResponse = (
  payload: AuthFilesResponse,
  receivedAtMs = Date.now()
): AuthFilesResponse => {
  const observedAt = normalizeCooldownTimestamp(payload?.observed_at);
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const grouped = new Map<string, AuthFileEntry[]>();

  files.forEach((entry) => {
    const name = readTextField(entry, 'name');
    const authIndex = normalizeRecentRequestAuthIndex(entry['auth_index'] ?? entry.authIndex);
    const key = name
      ? getQuotaCacheKey({ ...entry, name, authIndex })
      : JSON.stringify(entry);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(entry);
      return;
    }
    grouped.set(key, [entry]);
  });

  const normalizedFiles = Array.from(grouped.values()).map((entries) =>
    normalizeAuthFileEntry(mergeAuthFileEntries(entries), observedAt, receivedAtMs)
  );
  normalizedFiles.sort((left, right) => {
    const nameOrder = readTextField(left, 'name').localeCompare(
      readTextField(right, 'name'),
      undefined,
      { sensitivity: 'accent' }
    );
    if (nameOrder !== 0) return nameOrder;
    return String(left.authIndex ?? '').localeCompare(String(right.authIndex ?? ''), undefined, {
      sensitivity: 'accent',
    });
  });

  return {
    ...payload,
    observedAt,
    files: normalizedFiles,
    total: normalizedFiles.length,
  };
};

const normalizeOauthExcludedModels = (payload: unknown): Record<string, string[]> => {
  if (!payload || typeof payload !== 'object') return {};

  const record = payload as Record<string, unknown>;
  const source = record['oauth-excluded-models'] ?? record.items ?? payload;
  if (!source || typeof source !== 'object') return {};

  const result: Record<string, string[]> = {};

  Object.entries(source as Record<string, unknown>).forEach(([provider, models]) => {
    const key = normalizeOAuthProviderKey(String(provider ?? ''));
    if (!key) return;

    const rawList = Array.isArray(models)
      ? models
      : typeof models === 'string'
        ? models.split(/[\n,]+/)
        : [];

    const normalized = result[key] ?? [];
    const seen = new Set(normalized.map((item) => item.toLowerCase()));
    rawList.forEach((item) => {
      const trimmed = String(item ?? '').trim();
      if (!trimmed) return;
      const modelKey = trimmed.toLowerCase();
      if (seen.has(modelKey)) return;
      seen.add(modelKey);
      normalized.push(trimmed);
    });

    result[key] = normalized;
  });

  return result;
};

export const normalizeOauthModelAlias = (
  payload: unknown
): Record<string, OAuthModelAliasEntry[]> => {
  if (!payload || typeof payload !== 'object') return {};

  const record = payload as Record<string, unknown>;
  const source = record['oauth-model-alias'] ?? record.items ?? payload;
  if (!source || typeof source !== 'object') return {};

  const result: Record<string, OAuthModelAliasEntry[]> = {};

  Object.entries(source as Record<string, unknown>).forEach(([channel, mappings]) => {
    const key = normalizeOAuthProviderKey(String(channel ?? ''));
    if (!key) return;
    if (!Array.isArray(mappings)) return;

    const normalized = result[key] ?? [];
    const seenAlias = new Set(normalized.map((entry) => entry.alias.toLowerCase()));
    mappings
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const entry = item as Record<string, unknown>;
        const name = String(entry.name ?? entry.id ?? entry.model ?? '').trim();
        const alias = String(entry.alias ?? '').trim();
        if (!name || !alias) return null;
        const fork = entry.fork === true;
        const forceMappingValue = entry['force-mapping'] ?? entry.forceMapping;
        const normalizedEntry: OAuthModelAliasEntry = { name, alias };
        if (fork) normalizedEntry.fork = true;
        if (typeof forceMappingValue === 'boolean') {
          normalizedEntry.forceMapping = forceMappingValue;
        }
        return normalizedEntry;
      })
      .filter(Boolean)
      .forEach((entry) => {
        const aliasEntry = entry as OAuthModelAliasEntry;
        const aliasKey = aliasEntry.alias.toLowerCase();
        if (seenAlias.has(aliasKey)) return;
        seenAlias.add(aliasKey);
        normalized.push(aliasEntry);
      });

    if (normalized.length) {
      result[key] = normalized;
    }
  });

  return result;
};

export const serializeOauthModelAliases = (
  aliases: OAuthModelAliasEntry[]
): Array<Record<string, unknown>> =>
  aliases.map((entry) => {
    const payload: Record<string, unknown> = {
      name: entry.name,
      alias: entry.alias,
    };
    if (entry.fork) payload.fork = true;
    if (typeof entry.forceMapping === 'boolean') {
      payload['force-mapping'] = entry.forceMapping;
    }
    return payload;
  });

const OAUTH_MODEL_ALIAS_ENDPOINT = '/oauth-model-alias';

export const authFilesApi = {
  list: async (lookup?: AuthFileLookup) =>
    normalizeAuthFilesResponse(
      await apiClient.get<AuthFilesResponse>(
        '/auth-files',
        lookup ? { params: authFileLookupParams(normalizeAuthFileLookup(lookup)) } : undefined
      )
    ),

  setStatus: (target: AuthFileTarget, disabled: boolean, authIndex?: string | number | null) => {
    const lookup = normalizeAuthFileLookup(target, authIndex);
    return apiClient.patch<AuthFileStatusResponse>('/auth-files/status', {
      ...authFileLookupPayload(lookup),
      disabled,
    });
  },

  setArchived: (target: AuthFileTarget, archived: boolean, authIndex?: string | number | null) => {
    const lookup = normalizeAuthFileLookup(target, authIndex);
    return apiClient.patch<AuthFileStatusResponse>('/auth-files/status', {
      ...authFileLookupPayload(lookup),
      archived,
    });
  },

  refreshCredential: (target: AuthFileTarget, authIndex?: string | number | null) => {
    const lookup = normalizeAuthFileLookup(target, authIndex);
    return apiClient.post<AuthFileRefreshResponse>('/auth-files/refresh', {
      ...authFileLookupPayload(lookup),
    });
  },

  patchFields: (
    target: AuthFileTarget,
    fields: AuthFileFieldsPatch,
    authIndex?: string | number | null
  ) => {
    const lookup = normalizeAuthFileLookup(target, authIndex);
    return apiClient.patch('/auth-files/fields', { ...authFileLookupPayload(lookup), ...fields });
  },

  requestManualRefresh: async (
    target: AuthFileTarget,
    authIndex?: string | number | null
  ): Promise<void> => {
    // v7.3.0 returns the complete Auth (including tokens). Never return it to callers.
    const lookup = normalizeAuthFileLookup(target, authIndex);
    await apiClient.post<unknown>('/auth-files/refresh', { ...authFileLookupPayload(lookup) });
  },

  uploadFiles: async (files: File[]): Promise<AuthFileBatchUploadResult> => {
    const requestedNames = files.map((file) => file.name);
    if (requestedNames.length === 0) {
      return { status: 'ok', uploaded: 0, files: [], failed: [] };
    }

    const formData = new FormData();
    files.forEach((file) => {
      formData.append('file', file, file.name);
    });
    const payload = await apiClient.postForm<AuthFileBatchUploadResponse>('/auth-files', formData);
    return normalizeBatchUploadResponse(payload, requestedNames);
  },

  deleteFiles: async (targets: AuthFileTarget[]): Promise<AuthFileBatchDeleteResult> => {
    const requestedTargets = normalizeAuthFileTargets(targets);
    const requestedNames = normalizeRequestedAuthFileNames(
      requestedTargets.filter((target) => !target.authIndex).map((target) => target.name)
    );
    if (requestedTargets.length === 0) {
      return { status: 'ok', deleted: 0, files: [], failed: [] };
    }

    const payload = await apiClient.delete<AuthFileBatchDeleteResponse>('/auth-files', {
      data: {
        names: requestedNames,
        targets: requestedTargets.map((target) => authFileLookupPayload(target)),
      },
    });
    return normalizeBatchDeleteResponse(payload, requestedTargets);
  },

  deleteFile: (target: AuthFileTarget, authIndex?: string | number | null) =>
    authFilesApi.deleteFiles([normalizeAuthFileLookup(target, authIndex)]),

  deleteAll: () => apiClient.delete('/auth-files', { params: { all: true } }),

  download: async (target: AuthFileTarget, authIndex?: string | number | null): Promise<Blob> => {
    const lookup = normalizeAuthFileLookup(target, authIndex);
    const query = new URLSearchParams(authFileLookupParams(lookup));
    const response = await apiClient.getRaw(`/auth-files/download?${query.toString()}`, {
      responseType: 'blob',
    });
    return response.data as Blob;
  },

  downloadText: async (
    target: AuthFileTarget,
    authIndex?: string | number | null
  ): Promise<string> => {
    const blob = await authFilesApi.download(target, authIndex);
    return blob.text();
  },

  // OAuth 排除模型
  async getOauthExcludedModels(): Promise<Record<string, string[]>> {
    const data = await apiClient.get('/oauth-excluded-models');
    return normalizeOauthExcludedModels(data);
  },

  saveOauthExcludedModels: (provider: string, models: string[]) =>
    apiClient.patch('/oauth-excluded-models', {
      provider: normalizeOAuthProviderKey(provider),
      models,
    }),

  deleteOauthExcludedEntry: (provider: string) =>
    apiClient.delete(
      `/oauth-excluded-models?provider=${encodeURIComponent(normalizeOAuthProviderKey(provider))}`
    ),

  replaceOauthExcludedModels: (map: Record<string, string[]>) =>
    apiClient.put('/oauth-excluded-models', normalizeOauthExcludedModels(map)),

  // OAuth 模型别名
  async getOauthModelAlias(): Promise<Record<string, OAuthModelAliasEntry[]>> {
    const data = await apiClient.get(OAUTH_MODEL_ALIAS_ENDPOINT);
    return normalizeOauthModelAlias(data);
  },

  saveOauthModelAlias: async (channel: string, aliases: OAuthModelAliasEntry[]) => {
    const normalizedChannel = normalizeOAuthProviderKey(String(channel ?? ''));
    const normalizedAliases =
      normalizeOauthModelAlias({ [normalizedChannel]: aliases })[normalizedChannel] ?? [];
    await apiClient.patch(OAUTH_MODEL_ALIAS_ENDPOINT, {
      channel: normalizedChannel,
      aliases: serializeOauthModelAliases(normalizedAliases),
    });
  },

  deleteOauthModelAlias: async (channel: string) => {
    const normalizedChannel = normalizeOAuthProviderKey(String(channel ?? ''));

    try {
      await apiClient.patch(OAUTH_MODEL_ALIAS_ENDPOINT, {
        channel: normalizedChannel,
        aliases: [],
      });
    } catch (err: unknown) {
      const status = getStatusCode(err);
      if (status !== 405) throw err;
      await apiClient.delete(
        `${OAUTH_MODEL_ALIAS_ENDPOINT}?channel=${encodeURIComponent(normalizedChannel)}`
      );
    }
  },

  // 获取认证凭证支持的模型
  async getModelsForAuthFile(
    target: AuthFileTarget,
    authIndex?: string | number | null
  ): Promise<{ id: string; display_name?: string; type?: string; owned_by?: string }[]> {
    const lookup = normalizeAuthFileLookup(target, authIndex);
    const query = new URLSearchParams(authFileLookupParams(lookup));
    const data = await apiClient.get<Record<string, unknown>>(
      `/auth-files/models?${query.toString()}`
    );
    const models = data.models ?? data['models'];
    return Array.isArray(models)
      ? (models as { id: string; display_name?: string; type?: string; owned_by?: string }[])
      : [];
  },

  // 获取指定 channel 的模型定义
  async getModelDefinitions(
    channel: string
  ): Promise<{ id: string; display_name?: string; type?: string; owned_by?: string }[]> {
    const normalizedChannel = normalizeOAuthProviderKey(String(channel ?? ''));
    if (!normalizedChannel) return [];
    const data = await apiClient.get<Record<string, unknown>>(
      `/model-definitions/${encodeURIComponent(normalizedChannel)}`
    );
    const models = data.models ?? data['models'];
    return Array.isArray(models)
      ? (models as { id: string; display_name?: string; type?: string; owned_by?: string }[])
      : [];
  },
};
