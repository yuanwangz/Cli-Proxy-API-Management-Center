import { describe, expect, test } from 'bun:test';

const LOCALES = ['en', 'ru', 'zh-CN', 'zh-TW'] as const;

const DASHBOARD_KEYS = [
  'hero_verdict_good',
  'hero_verdict_warning',
  'hero_verdict_critical',
  'hero_verdict_idle',
  'hero_verdict_offline',
  'hero_verdict_connecting',
  'hero_period',
  'hero_requests_label',
  'hero_live',
  'hero_window_meta',
  'hero_spark_label',
  'cta_manage_providers',
  'cta_inspect_logs',
  'stats_aria',
  'success_rate',
  'stat_success_hint',
  'stat_credentials',
  'stat_credentials_hint',
  'stat_credentials_empty',
  'stat_provider_keys',
  'stat_provider_keys_hint',
  'stat_models',
  'stat_models_hint',
  'traffic_eyebrow',
  'traffic_title',
  'traffic_description',
  'traffic_table',
  'traffic_table_window',
  'traffic_chart_summary',
  'traffic_unavailable',
  'traffic_unavailable_hint',
  'fleet_eyebrow',
  'fleet_title',
  'fleet_description',
  'fleet_empty',
  'fleet_credentials',
  'fleet_spark_label',
  'fleet_requests',
  'provider_unknown',
  'health_eyebrow',
  'health_title',
  'health_active',
  'health_unavailable',
  'health_disabled',
  'health_by_type',
  'health_empty',
  'health_link',
  'runtime_eyebrow',
  'runtime_title',
  'runtime_routing',
  'runtime_retry',
  'runtime_management_keys',
  'runtime_version',
  'runtime_build',
  'runtime_proxy',
  'runtime_debug',
  'runtime_file_logging',
  'runtime_request_log',
  'runtime_ws_auth',
  'runtime_model_prefix',
  'runtime_link',
  'cta_eyebrow',
  'cta_title',
  'cta_providers_desc',
  'cta_auth_files_desc',
  'cta_config_desc',
  'cta_quota_desc',
  'cta_logs_desc',
  'cta_system_desc',
  'window_m',
  'window_h',
  'window_hm',
] as const;

const CONFIG_KEYS = [
  'meta_fields',
  'meta_dirty',
  'meta_dirty_source',
  'meta_errors',
  'meta_synced',
  'actions.discard',
  'actions.save',
  'discard_confirm_message',
  'mode.label',
  'mode.visual',
  'mode.source',
  'visual.sections.common.title',
  'visual.sections.common.description',
  'visual.sections.network.strategy_weighted_round_robin',
] as const;

const readKey = (value: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, value);

describe('i18n coverage for upstream feature surfaces', () => {
  test('dashboard labels exist in every supported locale', async () => {
    for (const locale of LOCALES) {
      const messages = await Bun.file(`src/i18n/locales/${locale}.json`).json();
      for (const key of DASHBOARD_KEYS) {
        expect(typeof readKey(messages.dashboard, key), `${locale}: dashboard.${key}`).toBe(
          'string'
        );
      }
    }
  });

  test('config panel status, mode, and common-section labels exist in every locale', async () => {
    for (const locale of LOCALES) {
      const messages = await Bun.file(`src/i18n/locales/${locale}.json`).json();
      for (const key of CONFIG_KEYS) {
        expect(typeof readKey(messages.config_management, key), `${locale}: ${key}`).toBe('string');
      }
    }
  });
});
