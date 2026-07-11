import { describe, expect, test } from 'bun:test';

import { buildCodexRequestHeaders } from '../src/components/quota/quotaConfigs';

describe('Codex quota request headers', () => {
  test('uses one current auth header set for usage and reset-credit requests', () => {
    const headers = buildCodexRequestHeaders({
      name: 'codex-user.json',
      type: 'codex',
      id_token: { chatgpt_account_id: 'account-123' },
    });

    expect(headers.Authorization).toBe('Bearer $TOKEN$');
    expect(headers['Chatgpt-Account-Id']).toBe('account-123');
    expect(headers['OpenAI-Beta']).toBeUndefined();
    expect(headers.Originator).toBeUndefined();
  });
});
