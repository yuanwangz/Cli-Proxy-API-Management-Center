import { describe, expect, test } from 'bun:test';
import { buildAuthFilesFilterPipeline } from '@/features/authFiles/filtering';
import type { AuthFileItem } from '@/types';

const files: AuthFileItem[] = [
  { name: 'codex-active.json', type: 'codex', statusCode: 401 },
  { name: 'codex-archived.json', type: 'codex', statusCode: 429, archived: true },
  { name: 'xai-healthy.json', type: 'xai' },
  { name: 'xai-disabled.json', type: 'xai', disabled: true, statusCode: 403 },
  { name: 'xai-limited.json', type: 'xai', statusCode: 429 },
];

const buildPipeline = (
  overrides: Partial<Parameters<typeof buildAuthFilesFilterPipeline>[0]> = {}
) =>
  buildAuthFilesFilterPipeline({
    files,
    providerFilter: 'all',
    archiveFilter: 'all',
    statusCodeFilter: 'all',
    problemOnly: false,
    disabledOnly: false,
    enabledOnly: false,
    getStatusCode: (file) => file.statusCode ?? null,
    ...overrides,
  });

describe('auth-files filter pipeline', () => {
  test('scopes lower filter counts to the selected provider', () => {
    const result = buildPipeline({ providerFilter: 'codex' });

    expect(result.archiveFilterCounts).toEqual({ active: 1, archived: 1, all: 2 });
    expect(result.statusCodeCounts).toEqual({ all: 2, '401': 1, '403': 0, '429': 1 });
    expect(result.filesMatchingStatusFilters.map((file) => file.name)).toEqual([
      'codex-active.json',
      'codex-archived.json',
    ]);
  });

  test('keeps provider counts global when lower filters change', () => {
    const result = buildPipeline({
      providerFilter: 'codex',
      archiveFilter: 'active',
      statusCodeFilter: '401',
    });

    expect(result.typeCounts).toEqual({ all: 5, codex: 2, xai: 3 });
    expect(result.existingTypes).toEqual(['all', 'codex', 'xai']);
    expect(result.statusCodeCounts.all).toBe(1);
    expect(result.filesMatchingStatusFilters.map((file) => file.name)).toEqual([
      'codex-active.json',
    ]);
  });

  test('applies result toggles inside the provider domain', () => {
    const result = buildPipeline({ providerFilter: 'xai', disabledOnly: true });

    expect(result.archiveFilterCounts.all).toBe(1);
    expect(result.statusCodeCounts['403']).toBe(1);
    expect(result.filesMatchingStatusFilters.map((file) => file.name)).toEqual([
      'xai-disabled.json',
    ]);
  });
});
