/**
 * xAI/Grok credential chat-probe inspection (aligned with grok-inspection).
 * Probes cli-chat-proxy chat capability rather than billing-only quota reads.
 */

import { apiCallApi } from '@/services/api/apiCall';
import type { AuthFileItem } from '@/types';
import { buildXaiRequestHeaders } from '@/components/quota/quotaConfigs';
import { isRecord } from '@/utils/helpers';

export const XAI_CHAT_PROXY_BASE = 'https://cli-chat-proxy.grok.com';
export const XAI_MODELS_URL = `${XAI_CHAT_PROXY_BASE}/v1/models`;
export const XAI_RESPONSES_URL = `${XAI_CHAT_PROXY_BASE}/v1/responses`;
export const XAI_CHAT_COMPLETIONS_URL = `${XAI_CHAT_PROXY_BASE}/v1/chat/completions`;

const PREFERRED_MODELS = [
  'grok-4.5-build-free',
  'grok-4.5',
  'grok-4',
  'grok-3-mini',
] as const;

const DEFAULT_PROBE_MODEL = 'grok-4.5';

export type XaiProbeClassification =
  | 'healthy'
  | 'permission_denied'
  | 'quota_exhausted'
  | 'reauth'
  | 'model_unavailable'
  | 'probe_error'
  | 'unknown';

/** Maps to CredentialInspectionStatus on the auth-files page. */
export type XaiInspectionUiStatus = 'healthy' | 'limited' | 'disabled' | 'error';

export type XaiClassifyInput = {
  chatStatus: number;
  chatCode?: string;
  chatError?: string;
  requestError?: string;
};

export type XaiClassifyResult = {
  classification: XaiProbeClassification;
  uiStatus: XaiInspectionUiStatus;
  reasonKey:
    | 'inspection_healthy'
    | 'inspection_rate_limited'
    | 'inspection_unauthorized_disabled'
    | 'inspection_xai_permission_denied'
    | 'inspection_xai_model_unavailable'
    | 'inspection_xai_probe_error';
  reasonFallback: string;
  httpStatus?: number;
  model?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type XaiProbeOutcome = XaiClassifyResult & {
  model: string;
};

const lower = (value: string | undefined): string => String(value ?? '').trim().toLowerCase();

const containsAny = (text: string, needles: string[]): boolean => {
  const value = lower(text);
  if (!value) return false;
  return needles.some((needle) => needle && value.includes(lower(needle)));
};

export const extractProbeError = (
  body: unknown,
  bodyText?: string
): { code: string; message: string } => {
  if (isRecord(body)) {
    let code = typeof body.code === 'string' ? body.code : '';
    let message = '';
    const errorValue = body.error;
    if (isRecord(errorValue)) {
      if (!code && typeof errorValue.code === 'string') code = errorValue.code;
      message =
        (typeof errorValue.message === 'string' && errorValue.message) ||
        (typeof errorValue.error === 'string' && errorValue.error) ||
        '';
    } else if (typeof errorValue === 'string') {
      message = errorValue;
    }
    if (!message && typeof body.message === 'string') message = body.message;
    if (message || code) {
      return { code: code.trim(), message: message.trim() || String(bodyText ?? '').trim() };
    }
  }
  const text = String(bodyText ?? '').trim();
  return { code: '', message: text };
};

export const classifyXaiProbe = (input: XaiClassifyInput): XaiClassifyResult => {
  const status = Number(input.chatStatus) || 0;
  const blob = `${lower(input.chatCode)} ${lower(input.chatError)}`;

  if (
    status === 401 ||
    containsAny(blob, [
      'token is expired',
      'token has been invalidated',
      'invalid_grant',
      'unauthorized',
    ])
  ) {
    return {
      classification: 'reauth',
      uiStatus: 'disabled',
      reasonKey: 'inspection_unauthorized_disabled',
      reasonFallback: '认证已过期或失效',
      httpStatus: status || 401,
      errorCode: input.chatCode,
      errorMessage: input.chatError,
    };
  }

  if (
    status === 429 ||
    containsAny(blob, [
      'free-usage-exhausted',
      'included free usage',
      'usage_limit_reached',
      'quota exhausted',
      'limit reached',
    ])
  ) {
    return {
      classification: 'quota_exhausted',
      uiStatus: 'limited',
      reasonKey: 'inspection_rate_limited',
      reasonFallback: '额度已用尽',
      httpStatus: status || 429,
      errorCode: input.chatCode,
      errorMessage: input.chatError,
    };
  }

  if (
    status === 402 ||
    status === 403 ||
    containsAny(blob, [
      'permission-denied',
      'chat endpoint is denied',
      'deactivated',
      'suspended',
      'banned',
    ])
  ) {
    return {
      classification: 'permission_denied',
      uiStatus: 'error',
      reasonKey: 'inspection_xai_permission_denied',
      reasonFallback: status > 0 ? `对话权限被拒绝 (HTTP ${status})` : '对话权限被拒绝',
      httpStatus: status || 403,
      errorCode: input.chatCode,
      errorMessage: input.chatError,
    };
  }

  if (
    status === 404 ||
    containsAny(blob, ['not-found', 'does not exist', 'no access to it'])
  ) {
    return {
      classification: 'model_unavailable',
      uiStatus: 'error',
      reasonKey: 'inspection_xai_model_unavailable',
      reasonFallback: '测试模型不可用',
      httpStatus: status || 404,
      errorCode: input.chatCode,
      errorMessage: input.chatError,
    };
  }

  if (status >= 200 && status < 300) {
    return {
      classification: 'healthy',
      uiStatus: 'healthy',
      reasonKey: 'inspection_healthy',
      reasonFallback: '对话测试成功',
      httpStatus: status,
    };
  }

  if (String(input.requestError ?? '').trim() || status > 0) {
    const reason =
      String(input.requestError ?? '').trim() ||
      (status > 0 ? `探测失败 (HTTP ${status})` : '探测失败');
    return {
      classification: 'probe_error',
      uiStatus: 'error',
      reasonKey: 'inspection_xai_probe_error',
      reasonFallback: reason,
      httpStatus: status || undefined,
      errorCode: input.chatCode,
      errorMessage: input.chatError || input.requestError,
    };
  }

  return {
    classification: 'unknown',
    uiStatus: 'error',
    reasonKey: 'inspection_xai_probe_error',
    reasonFallback: '无法可靠分类',
    errorCode: input.chatCode,
    errorMessage: input.chatError,
  };
};

export const pickXaiProbeModel = (body: unknown, bodyText?: string): string => {
  let data: unknown = body;
  if (!isRecord(data) && bodyText) {
    try {
      data = JSON.parse(bodyText);
    } catch {
      return DEFAULT_PROBE_MODEL;
    }
  }
  if (!isRecord(data) || !Array.isArray(data.data)) {
    return DEFAULT_PROBE_MODEL;
  }

  const ids: string[] = [];
  for (const item of data.data) {
    if (!isRecord(item)) continue;
    const id =
      (typeof item.id === 'string' && item.id.trim()) ||
      (typeof item.model === 'string' && item.model.trim()) ||
      '';
    if (id) ids.push(id);
  }

  for (const preferred of PREFERRED_MODELS) {
    if (ids.includes(preferred)) return preferred;
  }
  return ids[0] || DEFAULT_PROBE_MODEL;
};

const outcomeFromResponse = (
  statusCode: number,
  body: unknown,
  bodyText: string
): XaiClassifyResult => {
  const parsed = extractProbeError(body, bodyText);
  return classifyXaiProbe({
    chatStatus: statusCode,
    chatCode: parsed.code,
    chatError: parsed.message,
  });
};

/**
 * Prefer primary classification for auth/quota/permission failures even if fallback succeeds.
 */
export const resolveProbeOutcome = (
  primary: XaiClassifyResult,
  fallback: XaiClassifyResult
): XaiClassifyResult => {
  switch (primary.classification) {
    case 'reauth':
    case 'quota_exhausted':
    case 'permission_denied':
      if (fallback.classification === 'healthy') {
        return {
          ...primary,
          reasonFallback: `${primary.reasonFallback}；备用接口结果不一致，按主探测结果判定`,
        };
      }
      return primary;
    default:
      return fallback;
  }
};

export async function probeXaiCredential(
  file: AuthFileItem,
  authIndex: string
): Promise<XaiProbeOutcome> {
  const header = buildXaiRequestHeaders(file);

  let model = DEFAULT_PROBE_MODEL;
  try {
    const modelsResult = await apiCallApi.request({
      authIndex,
      method: 'GET',
      url: XAI_MODELS_URL,
      header,
    });
    if (modelsResult.statusCode >= 200 && modelsResult.statusCode < 300) {
      model = pickXaiProbeModel(modelsResult.body, modelsResult.bodyText);
    }
  } catch {
    // Keep default model when /models fails; chat probe still runs.
  }

  const responsesBody = JSON.stringify({
    model,
    input: 'ping',
    stream: false,
  });

  let primary: XaiClassifyResult;
  try {
    const chatResult = await apiCallApi.request({
      authIndex,
      method: 'POST',
      url: XAI_RESPONSES_URL,
      header: {
        ...header,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      data: responsesBody,
    });
    primary = outcomeFromResponse(chatResult.statusCode, chatResult.body, chatResult.bodyText);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err ?? 'request failed');
    primary = classifyXaiProbe({ chatStatus: 0, requestError: message });
    return { ...primary, model };
  }

  const status = primary.httpStatus ?? 0;
  if (status === 401 || status === 402 || status === 403 || status === 429) {
    try {
      const fallbackBody = JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        stream: false,
      });
      const fallbackResult = await apiCallApi.request({
        authIndex,
        method: 'POST',
        url: XAI_CHAT_COMPLETIONS_URL,
        header: {
          ...header,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        data: fallbackBody,
      });
      const fallback = outcomeFromResponse(
        fallbackResult.statusCode,
        fallbackResult.body,
        fallbackResult.bodyText
      );
      const resolved = resolveProbeOutcome(primary, fallback);
      return { ...resolved, model };
    } catch {
      return { ...primary, model };
    }
  }

  return { ...primary, model };
}
