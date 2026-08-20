/**
 * Quota management page - coordinates the three quota sections.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore } from '@/stores';
import { authFilesApi, configFileApi, quotaApi } from '@/services/api';
import {
  QuotaSection,
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG,
  XAI_CONFIG,
} from '@/components/quota';
import type { AuthFileItem } from '@/types';
import type { QuotaSnapshotsPayload } from '@/types/quota';
import { createSingleFlight } from '@/utils/singleFlight';
import { useQuotaRefreshCoordinator } from '@/components/quota/useQuotaRefreshCoordinator';
import styles from './QuotaPage.module.scss';

export function QuotaPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [quotaSnapshots, setQuotaSnapshots] = useState<QuotaSnapshotsPayload>({
    snapshots: [],
    token_usage: {},
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);
  const tRef = useRef(t);
  const loadConfigRef = useRef(createSingleFlight<void>());
  const loadFilesRef = useRef(createSingleFlight<void>());
  const loadQuotaSnapshotsRef = useRef(createSingleFlight<void>());

  tRef.current = t;

  const disableControls = connectionStatus !== 'connected';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadConfig = useCallback(
    () =>
      loadConfigRef.current(async () => {
        try {
          await configFileApi.fetchConfigYaml();
        } catch (err: unknown) {
          if (!mountedRef.current) return;
          const errorMessage =
            err instanceof Error ? err.message : tRef.current('notification.refresh_failed');
          setError((prev) => prev || errorMessage);
        }
      }),
    []
  );

  const loadFiles = useCallback(
    () =>
      loadFilesRef.current(async () => {
        if (!mountedRef.current) return;
        setLoading(true);
        setError('');
        try {
          const data = await authFilesApi.list();
          if (mountedRef.current) setFiles(data?.files || []);
        } catch (err: unknown) {
          if (mountedRef.current) {
            const errorMessage =
              err instanceof Error ? err.message : tRef.current('notification.refresh_failed');
            setError(errorMessage);
          }
        } finally {
          if (mountedRef.current) setLoading(false);
        }
      }),
    []
  );

  const loadQuotaSnapshots = useCallback(
    () =>
      loadQuotaSnapshotsRef.current(async () => {
        try {
          const payload = await quotaApi.getSnapshots();
          if (mountedRef.current) setQuotaSnapshots(payload);
        } catch (err: unknown) {
          if (mountedRef.current) {
            const errorMessage =
              err instanceof Error ? err.message : tRef.current('notification.refresh_failed');
            setError((prev) => prev || errorMessage);
          }
        }
      }),
    []
  );

  const handleHeaderRefresh = useCallback(async () => {
    await Promise.all([loadConfig(), loadFiles(), loadQuotaSnapshots()]);
  }, [loadConfig, loadFiles, loadQuotaSnapshots]);

  useHeaderRefresh(handleHeaderRefresh);

  const handleQuotaRefreshComplete = useCallback(async () => {
    await Promise.all([loadFiles(), loadQuotaSnapshots()]);
  }, [loadFiles, loadQuotaSnapshots]);

  const snapshots = quotaSnapshots.snapshots;
  const tokenUsage = quotaSnapshots.token_usage ?? quotaSnapshots.tokenUsage ?? {};
  const registerAutoRefresh = useQuotaRefreshCoordinator({
    files,
    snapshots,
    onRefreshComplete: handleQuotaRefreshComplete,
  });

  useEffect(() => {
    void loadFiles();
    void loadConfig();
    void loadQuotaSnapshots();
  }, [loadFiles, loadConfig, loadQuotaSnapshots]);

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('quota_management.title')}</h1>
        <p className={styles.description}>{t('quota_management.description')}</p>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <QuotaSection
        config={CLAUDE_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        snapshots={snapshots}
        tokenUsage={tokenUsage}
        onQuotaRefreshComplete={handleQuotaRefreshComplete}
        onRegisterAutoRefresh={registerAutoRefresh}
      />
      <QuotaSection
        config={ANTIGRAVITY_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        snapshots={snapshots}
        tokenUsage={tokenUsage}
        onQuotaRefreshComplete={handleQuotaRefreshComplete}
        onRegisterAutoRefresh={registerAutoRefresh}
      />
      <QuotaSection
        config={CODEX_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        snapshots={snapshots}
        tokenUsage={tokenUsage}
        onQuotaRefreshComplete={handleQuotaRefreshComplete}
        onRegisterAutoRefresh={registerAutoRefresh}
      />
      <QuotaSection
        config={XAI_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        snapshots={snapshots}
        tokenUsage={tokenUsage}
        onQuotaRefreshComplete={handleQuotaRefreshComplete}
        onRegisterAutoRefresh={registerAutoRefresh}
      />
      <QuotaSection
        config={GEMINI_CLI_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        snapshots={snapshots}
        tokenUsage={tokenUsage}
        onQuotaRefreshComplete={handleQuotaRefreshComplete}
        onRegisterAutoRefresh={registerAutoRefresh}
      />
      <QuotaSection
        config={KIMI_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        snapshots={snapshots}
        tokenUsage={tokenUsage}
        onQuotaRefreshComplete={handleQuotaRefreshComplete}
        onRegisterAutoRefresh={registerAutoRefresh}
      />
    </div>
  );
}
