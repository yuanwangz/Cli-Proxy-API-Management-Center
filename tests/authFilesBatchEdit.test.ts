import { describe, expect, test } from 'bun:test';
import {
  buildAuthFilesBatchPatch,
  createAuthFilesBatchEditDraft,
} from '@/features/authFiles/batchEdit';

describe('auth-files batch edit patch', () => {
  test('submits only explicitly enabled fields', () => {
    const draft = createAuthFilesBatchEditDraft();
    draft.enabled.note = true;
    draft.note = ' team account ';
    draft.priority = '42';

    expect(buildAuthFilesBatchPatch(draft)).toEqual({
      patch: { note: 'team account' },
      fieldCount: 1,
      error: null,
    });
  });

  test('rejects empty selection and invalid priority', () => {
    expect(buildAuthFilesBatchPatch(createAuthFilesBatchEditDraft()).error).toBe(
      'batch_edit_no_fields'
    );

    const draft = createAuthFilesBatchEditDraft();
    draft.enabled.priority = true;
    draft.priority = '1.5';
    expect(buildAuthFilesBatchPatch(draft).error).toBe('batch_edit_priority_invalid');
  });

  test('builds incremental header set and remove operations', () => {
    const draft = createAuthFilesBatchEditDraft();
    draft.enabled.headers = true;
    draft.headersText = JSON.stringify({ Authorization: 'Bearer token', 'X-Remove': '' });

    expect(buildAuthFilesBatchPatch(draft)).toEqual({
      patch: {
        headers: {
          Authorization: 'Bearer token',
          'X-Remove': '',
        },
      },
      fieldCount: 1,
      error: null,
    });
  });

  test('rejects case-insensitive duplicate header names', () => {
    const draft = createAuthFilesBatchEditDraft();
    draft.enabled.headers = true;
    draft.headersText = JSON.stringify({ Authorization: 'a', authorization: 'b' });

    expect(buildAuthFilesBatchPatch(draft).error).toBe('batch_edit_headers_duplicate');
  });

  test('preserves explicit false values for provider switches', () => {
    const draft = createAuthFilesBatchEditDraft();
    draft.enabled.websockets = true;
    draft.enabled.usingApi = true;

    expect(buildAuthFilesBatchPatch(draft)).toEqual({
      patch: { websockets: false, using_api: false },
      fieldCount: 2,
      error: null,
    });
  });
});
