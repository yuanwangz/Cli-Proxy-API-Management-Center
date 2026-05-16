/**
 * Quota management page - coordinates the three quota sections.
 */

import { useCallback, useEffect, useState } from 'react';
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
  KIMI_CONFIG
} from '@/components/quota';
import type { AuthFileItem } from '@/types';
import type { QuotaSnapshotsPayload } from '@/types/quota';
import { getCredentialNextRetryAt } from '@/utils/authFileStatus';
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

  const disableControls = connectionStatus !== 'connected';

  const loadConfig = useCallback(async () => {
    try {
      await configFileApi.fetchConfigYaml();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError((prev) => prev || errorMessage);
    }
  }, [t]);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      setFiles(data?.files || []);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadQuotaSnapshots = useCallback(async () => {
    try {
      setQuotaSnapshots(await quotaApi.getSnapshots());
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError((prev) => prev || errorMessage);
    }
  }, [t]);

  const handleHeaderRefresh = useCallback(async () => {
    await Promise.all([loadConfig(), loadFiles(), loadQuotaSnapshots()]);
  }, [loadConfig, loadFiles, loadQuotaSnapshots]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    loadFiles();
    loadConfig();
    loadQuotaSnapshots();
  }, [loadFiles, loadConfig, loadQuotaSnapshots]);

  useEffect(() => {
    const nowMs = Date.now();
    const nextRetryAt = files
      .map(getCredentialNextRetryAt)
      .filter((value) => value > nowMs)
      .sort((left, right) => left - right)[0];

    if (!nextRetryAt) return;

    const timeout = window.setTimeout(() => {
      void Promise.all([loadFiles(), loadQuotaSnapshots()]);
    }, Math.max(1000, nextRetryAt - nowMs + 1000));

    return () => window.clearTimeout(timeout);
  }, [files, loadFiles, loadQuotaSnapshots]);

  const snapshots = quotaSnapshots.snapshots;
  const tokenUsage = quotaSnapshots.token_usage ?? quotaSnapshots.tokenUsage ?? {};

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
      />
      <QuotaSection
        config={ANTIGRAVITY_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        snapshots={snapshots}
        tokenUsage={tokenUsage}
      />
      <QuotaSection
        config={CODEX_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        snapshots={snapshots}
        tokenUsage={tokenUsage}
      />
      <QuotaSection
        config={GEMINI_CLI_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        snapshots={snapshots}
        tokenUsage={tokenUsage}
      />
      <QuotaSection
        config={KIMI_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        snapshots={snapshots}
        tokenUsage={tokenUsage}
      />
    </div>
  );
}
