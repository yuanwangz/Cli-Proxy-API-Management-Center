import { describe, expect, test } from 'bun:test';
import {
  buildAuthFilesFilterPipeline,
  filterAuthFilesByInspectionStatus,
} from '@/features/authFiles/filtering';
import type {
  CredentialInspectionResult,
  CredentialInspectionStatus,
} from '@/features/authFiles/credentialInspection';
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

const inspectionResult = (status: CredentialInspectionStatus): CredentialInspectionResult => ({
  name: `${status}.json`,
  provider: 'codex',
  status,
  message: status,
  checkedAt: '2026-08-18T00:00:00.000Z',
  checkedAtMs: 0,
  action: 'none',
  actionReason: '',
  evidence: [],
  currentDisabled: false,
  currentArchived: false,
});

describe('auth-files inspection result filter', () => {
  const inspectionFiles: AuthFileItem[] = [
    { name: 'healthy.json', type: 'codex' },
    { name: 'reauth.json', type: 'codex' },
    { name: 'review.json', type: 'codex' },
    { name: 'unchecked.json', type: 'codex' },
  ];
  const results = {
    'healthy.json': inspectionResult('healthy'),
    'reauth.json': inspectionResult('reauth'),
    'review.json': inspectionResult('review'),
  };

  test('healthy filter excludes auth-invalid and unchecked credentials', () => {
    expect(
      filterAuthFilesByInspectionStatus(inspectionFiles, 'healthy', results).map(
        (file) => file.name
      )
    ).toEqual(['healthy.json']);
  });

  test('not checked filter only returns credentials without an inspection result', () => {
    expect(
      filterAuthFilesByInspectionStatus(inspectionFiles, 'not_checked', results).map(
        (file) => file.name
      )
    ).toEqual(['unchecked.json']);
  });
});
