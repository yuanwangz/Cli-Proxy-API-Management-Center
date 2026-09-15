import { describe, expect, test } from 'bun:test';
import { credentialMatchesSearch } from '../src/utils/authFileStatus';
import type { AuthFileItem } from '../src/types/authFile';

describe('auth-file status search identity fields', () => {
  test('searches safe email and project fields without searching account secrets', () => {
    const file: AuthFileItem = {
      name: 'shared.json',
      email: 'user@example.com',
      projectId: 'project-alpha',
      account: 'sk-live-secret',
      account_type: 'api_key',
    };

    expect(credentialMatchesSearch(file, 'user@example.com')).toBe(true);
    expect(credentialMatchesSearch(file, 'project-alpha')).toBe(true);
    expect(credentialMatchesSearch(file, 'shared.json')).toBe(true);
    expect(credentialMatchesSearch(file, 'sk-live-secret')).toBe(false);
  });
});
