import { apiClient } from './client';
import type { UsageImportResult, UsagePayload } from '@/types/usage';

const USAGE_TIMEOUT_MS = 60 * 1000;

export const usageApi = {
  getUsage: () => apiClient.get<UsagePayload>('/usage', { timeout: USAGE_TIMEOUT_MS }),

  exportUsage: () =>
    apiClient.getRaw('/usage/export', {
      timeout: USAGE_TIMEOUT_MS,
      responseType: 'blob',
    }),

  importUsage: (payload: string) =>
    apiClient.requestRaw({
      url: '/usage/import',
      method: 'POST',
      data: payload,
      timeout: USAGE_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/x-ndjson',
      },
    }) as Promise<{ data: UsageImportResult }>,

  async getStatisticsEnabled(): Promise<boolean> {
    const data = await apiClient.get<Record<string, unknown>>('/usage-statistics-enabled', {
      timeout: 15 * 1000,
    });
    return Boolean(data['usage-statistics-enabled'] ?? data.usageStatisticsEnabled);
  },

  updateStatisticsEnabled: (enabled: boolean) =>
    apiClient.put('/usage-statistics-enabled', { value: enabled }, { timeout: 15 * 1000 }),
};
