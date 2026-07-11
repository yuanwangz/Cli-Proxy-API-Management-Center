import { describe, expect, test } from 'bun:test';

import { buildXaiRequestHeaders } from '../src/components/quota/quotaConfigs';
import type { UsagePayload } from '../src/types/usage';
import { flattenUsageEvents, inferProvider } from '../src/utils/usageAnalytics';

describe('xAI usage and quota compatibility', () => {
  test('classifies legacy Grok usage as xAI', () => {
    expect(inferProvider('grok-4.5', '', 'POST /v1/responses')).toBe('xAI');
  });

  test('prefers the persisted provider in usage details', () => {
    const payload: UsagePayload = {
      apis: {
        'POST /v1/responses': {
          models: {
            'custom-model-name': {
              details: [
                {
                  timestamp: '2026-07-11T00:00:00Z',
                  provider: 'xai',
                  tokens: { total_tokens: 1 },
                },
              ],
            },
          },
        },
      },
    };

    expect(flattenUsageEvents(payload)[0]?.provider).toBe('xAI');
  });

  test('adds the OAuth subject required by build billing requests', () => {
    const headers = buildXaiRequestHeaders({
      name: 'xai-user.json',
      type: 'xai',
      sub: 'xai-user-123',
    });

    expect(headers.Authorization).toBe('Bearer $TOKEN$');
    expect(headers['x-userid']).toBe('xai-user-123');
    expect(headers['x-xai-token-auth']).toBe('xai-grok-cli');
  });
});
