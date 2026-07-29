import type { AuthFileFieldsPatch } from '@/services/api';
import { parsePriorityValue } from '@/features/authFiles/constants';

export const AUTH_FILES_BATCH_EDIT_FIELDS = [
  'priority',
  'note',
  'prefix',
  'proxyUrl',
  'headers',
  'websockets',
  'usingApi',
] as const;

export type AuthFilesBatchEditField = (typeof AUTH_FILES_BATCH_EDIT_FIELDS)[number];

export type AuthFilesBatchEditDraft = {
  enabled: Record<AuthFilesBatchEditField, boolean>;
  priority: string;
  note: string;
  prefix: string;
  proxyUrl: string;
  headersText: string;
  websockets: boolean;
  usingApi: boolean;
};

export type AuthFilesBatchEditError =
  | 'batch_edit_no_fields'
  | 'batch_edit_priority_invalid'
  | 'batch_edit_headers_empty'
  | 'batch_edit_headers_duplicate'
  | 'headers_invalid_json'
  | 'headers_invalid_object'
  | 'headers_invalid_value';

export type AuthFilesBatchPatchBuildResult =
  | { patch: AuthFileFieldsPatch; fieldCount: number; error: null }
  | { patch: null; fieldCount: 0; error: AuthFilesBatchEditError };

export const createAuthFilesBatchEditDraft = (): AuthFilesBatchEditDraft => ({
  enabled: {
    priority: false,
    note: false,
    prefix: false,
    proxyUrl: false,
    headers: false,
    websockets: false,
    usingApi: false,
  },
  priority: '0',
  note: '',
  prefix: '',
  proxyUrl: '',
  headersText: '',
  websockets: false,
  usingApi: false,
});

export const buildAuthFilesBatchPatch = (
  draft: AuthFilesBatchEditDraft
): AuthFilesBatchPatchBuildResult => {
  const patch: AuthFileFieldsPatch = {};

  if (draft.enabled.priority) {
    const priority = parsePriorityValue(draft.priority);
    if (priority === undefined) {
      return { patch: null, fieldCount: 0, error: 'batch_edit_priority_invalid' };
    }
    patch.priority = priority;
  }
  if (draft.enabled.note) patch.note = draft.note.trim();
  if (draft.enabled.prefix) patch.prefix = draft.prefix.trim();
  if (draft.enabled.proxyUrl) patch.proxy_url = draft.proxyUrl.trim();
  if (draft.enabled.websockets) patch.websockets = draft.websockets;
  if (draft.enabled.usingApi) patch.using_api = draft.usingApi;

  if (draft.enabled.headers) {
    const raw = draft.headersText.trim();
    if (!raw) {
      return { patch: null, fieldCount: 0, error: 'batch_edit_headers_empty' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return { patch: null, fieldCount: 0, error: 'headers_invalid_json' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { patch: null, fieldCount: 0, error: 'headers_invalid_object' };
    }

    const headers: Record<string, string> = {};
    const names = new Set<string>();
    for (const [rawName, rawValue] of Object.entries(parsed)) {
      if (typeof rawValue !== 'string') {
        return { patch: null, fieldCount: 0, error: 'headers_invalid_value' };
      }
      const name = rawName.trim();
      if (!name) {
        return { patch: null, fieldCount: 0, error: 'headers_invalid_value' };
      }
      const normalizedName = name.toLowerCase();
      if (names.has(normalizedName)) {
        return { patch: null, fieldCount: 0, error: 'batch_edit_headers_duplicate' };
      }
      names.add(normalizedName);
      headers[name] = rawValue.trim();
    }
    if (Object.keys(headers).length === 0) {
      return { patch: null, fieldCount: 0, error: 'batch_edit_headers_empty' };
    }
    patch.headers = headers;
  }

  const fieldCount = Object.keys(patch).length;
  if (fieldCount === 0) {
    return { patch: null, fieldCount: 0, error: 'batch_edit_no_fields' };
  }
  return { patch, fieldCount, error: null };
};
