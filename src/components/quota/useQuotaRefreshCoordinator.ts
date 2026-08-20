import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthFileItem } from '@/types';
import type { QuotaSnapshotRecord } from '@/types/quota';
import {
  getQuotaRefreshPlan,
  normalizeQuotaProvider,
  QUOTA_REFRESH_GRACE_MS,
  type QuotaRefreshPlan,
} from '@/utils/quotaRefreshSchedule';
import {
  getCredentialNextRetryAt,
  isCredentialArchived,
  isCredentialDisabled,
  isCredentialEffectivelyUnavailable,
} from '@/utils/authFileStatus';

type QuotaRefreshHandler = (files: AuthFileItem[]) => Promise<void>;

export type RegisterQuotaRefreshHandler = (
  provider: string,
  handler: QuotaRefreshHandler
) => () => void;

interface ScheduledQuotaRefresh {
  key: string;
  provider: string;
  file: AuthFileItem;
  plan: QuotaRefreshPlan;
}

const resolveAuthIndex = (file: AuthFileItem): string => {
  const raw = file['auth_index'] ?? file.authIndex;
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const snapshotAuthIndex = (snapshot: QuotaSnapshotRecord): string =>
  String(snapshot.auth_index ?? snapshot.authIndex ?? '').trim();

const snapshotFileName = (snapshot: QuotaSnapshotRecord): string =>
  String(snapshot.file_name ?? snapshot.fileName ?? '').trim();

const snapshotProvider = (snapshot: QuotaSnapshotRecord): string =>
  normalizeQuotaProvider(snapshot.provider);

const buildSnapshotIndexes = (snapshots: QuotaSnapshotRecord[]) => {
  const byAuthIndex = new Map<string, QuotaSnapshotRecord>();
  const byFileName = new Map<string, QuotaSnapshotRecord>();

  snapshots.forEach((snapshot) => {
    const provider = snapshotProvider(snapshot);
    const authIndex = snapshotAuthIndex(snapshot);
    const fileName = snapshotFileName(snapshot);
    if (provider && authIndex) byAuthIndex.set(`${provider}:${authIndex}`, snapshot);
    if (provider && fileName) byFileName.set(`${provider}:${fileName}`, snapshot);
  });

  return { byAuthIndex, byFileName };
};

const buildScheduledRefreshes = (
  files: AuthFileItem[],
  snapshots: QuotaSnapshotRecord[],
  nowMs: number,
  lastTriggered: ReadonlyMap<string, number>,
  handlers: ReadonlyMap<string, QuotaRefreshHandler>
): ScheduledQuotaRefresh[] => {
  const { byAuthIndex, byFileName } = buildSnapshotIndexes(snapshots);
  const scheduled: ScheduledQuotaRefresh[] = [];

  files.forEach((file) => {
    if (isCredentialArchived(file) || isCredentialDisabled(file)) return;

    const authIndex = resolveAuthIndex(file);
    const provider = normalizeQuotaProvider(file.provider ?? file.type);
    if (!provider || !handlers.has(provider)) return;

    const snapshot =
      (authIndex ? byAuthIndex.get(`${provider}:${authIndex}`) : undefined) ??
      byFileName.get(`${provider}:${file.name}`);
    if (!snapshot) return;

    const plan = getQuotaRefreshPlan(snapshot, nowMs);
    if (!plan) return;

    const nextRetryAt = getCredentialNextRetryAt(file);
    if (isCredentialEffectivelyUnavailable(file, nowMs) && nextRetryAt <= nowMs) return;

    const refreshAtMs = Math.max(plan.refreshAtMs, nextRetryAt > nowMs ? nextRetryAt : 0);
    const key = `${provider}:${authIndex || file.name}`;
    if (lastTriggered.get(key) === plan.resetAtMs) return;

    scheduled.push({
      key,
      provider,
      file,
      plan: { refreshAtMs, resetAtMs: plan.resetAtMs },
    });
  });

  return scheduled.sort((left, right) => left.plan.refreshAtMs - right.plan.refreshAtMs);
};

interface UseQuotaRefreshCoordinatorOptions {
  files: AuthFileItem[];
  snapshots: QuotaSnapshotRecord[];
  onRefreshComplete?: () => void | Promise<void>;
}

export function useQuotaRefreshCoordinator({
  files,
  snapshots,
  onRefreshComplete,
}: UseQuotaRefreshCoordinatorOptions): RegisterQuotaRefreshHandler {
  const handlersRef = useRef(new Map<string, QuotaRefreshHandler>());
  const filesRef = useRef(files);
  const snapshotsRef = useRef(snapshots);
  const lastTriggeredRef = useRef(new Map<string, number>());
  const timerRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  const [registrationVersion, setRegistrationVersion] = useState(0);
  const [scheduleVersion, setScheduleVersion] = useState(0);

  filesRef.current = files;
  snapshotsRef.current = snapshots;

  const register = useCallback<RegisterQuotaRefreshHandler>((provider, handler) => {
    const normalizedProvider = normalizeQuotaProvider(provider);
    handlersRef.current.set(normalizedProvider, handler);
    setRegistrationVersion((version) => version + 1);

    return () => {
      if (handlersRef.current.get(normalizedProvider) !== handler) return;
      handlersRef.current.delete(normalizedProvider);
      setRegistrationVersion((version) => version + 1);
    };
  }, []);

  const runDueRefreshes = useCallback(async () => {
    if (runningRef.current) return;

    const nowMs = Date.now();
    const dueRefreshes = buildScheduledRefreshes(
      filesRef.current,
      snapshotsRef.current,
      nowMs,
      lastTriggeredRef.current,
      handlersRef.current
    ).filter((entry) => entry.plan.refreshAtMs <= nowMs + QUOTA_REFRESH_GRACE_MS);

    if (dueRefreshes.length === 0) return;

    runningRef.current = true;
    let refreshed = false;
    try {
      for (const entry of dueRefreshes) {
        const handler = handlersRef.current.get(entry.provider);
        if (!handler) continue;

        lastTriggeredRef.current.set(entry.key, entry.plan.resetAtMs);
        await handler([entry.file]);
        refreshed = true;
      }

      if (refreshed && mountedRef.current) await onRefreshComplete?.();
    } finally {
      runningRef.current = false;
      if (mountedRef.current) setScheduleVersion((version) => version + 1);
    }
  }, [onRefreshComplete]);

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const nowMs = Date.now();
    const nextRefreshAt = buildScheduledRefreshes(
      files,
      snapshots,
      nowMs,
      lastTriggeredRef.current,
      handlersRef.current
    )[0]?.plan.refreshAtMs;
    if (nextRefreshAt === undefined) return;

    timerRef.current = window.setTimeout(
      () => {
        timerRef.current = null;
        void runDueRefreshes();
      },
      Math.max(0, nextRefreshAt - nowMs)
    );

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [files, registrationVersion, runDueRefreshes, scheduleVersion, snapshots]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return register;
}
