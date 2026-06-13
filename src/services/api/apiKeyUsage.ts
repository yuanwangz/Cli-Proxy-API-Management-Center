import { apiClient } from './client';
import type { ApiKeyUsageResponse } from '@/utils/recentRequests';

const API_KEY_USAGE_TIMEOUT_MS = 15 * 1000;

export interface ClearApiKeyUsageCooldownPayload {
  provider: string;
  authId?: string | null;
  authIndex?: string | null;
  apiKey?: string | null;
  baseUrl?: string | null;
}

export const apiKeyUsageApi = {
  getUsage: () =>
    apiClient.get<ApiKeyUsageResponse>('/api-key-usage', {
      timeout: API_KEY_USAGE_TIMEOUT_MS,
    }),
  clearCooldown: (payload: ClearApiKeyUsageCooldownPayload) =>
    apiClient.post('/api-key-usage/clear-cooldown', {
      provider: payload.provider,
      auth_id: payload.authId || undefined,
      auth_index: payload.authIndex || undefined,
      api_key: payload.apiKey || undefined,
      base_url: payload.baseUrl ?? undefined,
    }),
};
