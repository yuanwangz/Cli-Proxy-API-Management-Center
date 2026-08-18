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

const PROVIDER_NAMES = [
  'gemini',
  'interactions',
  'codex',
  'xai',
  'claude',
  'claudeApi',
  'vertex',
  'openaiCompatibility',
  'apikeyFun',
  'code0',
  'fennoAI',
  'qiniuCloud',
  'lmuAI',
  'infistar',
  'kimi',
] as const;

const PROVIDER_FORM_KEYS = [
  'form.weight',
  'form.weightHint',
  'form.excludedDisabledNote',
  'form.thinkingExistingHint',
  'form.validation.weightInteger',
  'form.validation.weightMax',
] as const;

const RECENTLY_USED_KEYS = [
  'basic_settings.routing_strategy_weighted_round_robin',
  'claude_quota.seven_day_fable',
  'auth_files.batch_toolbar_label',
  'auth_files.delete_all_title',
  'auth_files.delete_title',
  'auth_files.empty_oauth_link',
  'auth_files.meta_active',
  'auth_files.meta_problem',
  'auth_files.meta_total',
  'auth_files.no_results_clear',
  'auth_files.weight_display',
  'auth_files.weight_hint',
  'auth_files.weight_invalid_integer',
  'auth_files.weight_invalid_max',
  'auth_files.weight_label',
  'auth_files.headers_label',
  'auth_files.headers_placeholder',
  'auth_files.headers_hint',
  'auth_login.login_another_account',
  'auth_login.view_auth_files',
  'login.hide_key',
  'login.show_key',
  'logs.clear_confirm_title',
  'nav_groups.plugin_pages',
  'notification.load_failed',
  'notification.save_failed',
  'oauth_excluded.delete_title',
  'oauth_model_alias.delete_title',
  'plugin_resource.empty_src',
  'plugin_resource.empty_src_desc',
  'plugin_resource.load_failed',
  'plugin_resource.not_found',
  'plugin_resource.not_found_desc',
  'plugin_resource.page_count',
  'plugin_resource.unavailable',
  'quota_management.empty_desc',
  'quota_management.empty_title',
  'quota_management.meta_attention',
  'quota_management.meta_credentials',
  'quota_management.meta_loaded',
  'quota_management.soonest_row_hint',
  'quota_management.sort_label',
  'quota_management.windows_credential',
  'quota_management.windows_credit_expires',
  'quota_management.windows_credit_granted',
  'quota_management.windows_current',
  'quota_management.windows_empty_session',
  'quota_management.windows_idle',
  'quota_management.windows_legend_current',
  'quota_management.windows_legend_elapsed',
  'quota_management.windows_legend_reset_credit',
  'quota_management.windows_legend_upcoming',
  'quota_management.windows_mode_session',
  'quota_management.windows_mode_weekly',
  'quota_management.windows_next',
  'quota_management.windows_note_session',
  'quota_management.windows_note_weekly',
  'quota_management.windows_prev',
  'quota_management.windows_reset_credit',
  'quota_management.windows_span_session',
  'quota_management.windows_span_weekly',
  'quota_management.windows_title',
  'quota_management.windows_today',
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

  test('provider names and form labels exist in every supported locale', async () => {
    for (const locale of LOCALES) {
      const messages = await Bun.file(`src/i18n/locales/${locale}.json`).json();
      for (const provider of PROVIDER_NAMES) {
        expect(
          typeof readKey(messages.providersPage, `providerNames.${provider}`),
          `${locale}: providerNames.${provider}`
        ).toBe('string');
      }
      for (const key of PROVIDER_FORM_KEYS) {
        expect(typeof readKey(messages.providersPage, key), `${locale}: ${key}`).toBe('string');
      }
    }
  });

  test('recently merged feature labels exist in every supported locale', async () => {
    for (const locale of LOCALES) {
      const messages = await Bun.file(`src/i18n/locales/${locale}.json`).json();
      for (const key of RECENTLY_USED_KEYS) {
        expect(typeof readKey(messages, key), `${locale}: ${key}`).toBe('string');
      }
    }
  });
});
