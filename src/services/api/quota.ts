import { apiClient } from './client';
import type { QuotaSnapshotRecord, QuotaSnapshotsPayload } from '@/types/quota';

export interface SaveQuotaSnapshotRequest {
  provider: string;
  authId?: string;
  authIndex: string;
  fileName?: string;
  quota: unknown;
}

const normalizeSnapshotsPayload = (payload: QuotaSnapshotsPayload | undefined): QuotaSnapshotsPayload => ({
  snapshots: Array.isArray(payload?.snapshots) ? payload.snapshots : [],
  token_usage: payload?.token_usage ?? payload?.tokenUsage ?? {},
});

export const quotaApi = {
  getSnapshots: async (): Promise<QuotaSnapshotsPayload> =>
    normalizeSnapshotsPayload(await apiClient.get<QuotaSnapshotsPayload>('/quota-snapshots')),

  saveSnapshot: (payload: SaveQuotaSnapshotRequest): Promise<QuotaSnapshotRecord> =>
    apiClient.post<QuotaSnapshotRecord>('/quota-snapshots', {
      provider: payload.provider,
      auth_id: payload.authId,
      auth_index: payload.authIndex,
      file_name: payload.fileName,
      quota: payload.quota,
    }),
};
