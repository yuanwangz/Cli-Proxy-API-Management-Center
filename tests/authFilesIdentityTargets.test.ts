import { describe, expect, spyOn, test } from 'bun:test';
import { authFilesApi } from '../src/services/api/authFiles';
import { apiClient } from '../src/services/api/client';
import type { AuthFileItem } from '../src/types/authFile';

const indexedFile = (authIndex: string): AuthFileItem => ({
  name: 'shared.json',
  type: 'codex',
  authIndex,
});

describe('auth-file identity targets', () => {
  test('serializes the full target for status, archive, and field mutations', async () => {
    const patch = spyOn(apiClient, 'patch').mockResolvedValue({});
    const file = indexedFile('auth-b');

    try {
      await authFilesApi.setStatus(file, true);
      await authFilesApi.setArchived(file, true);
      await authFilesApi.patchFields(file, { note: 'kept separate' });

      expect(patch).toHaveBeenNthCalledWith(1, '/auth-files/status', {
        name: 'shared.json',
        auth_index: 'auth-b',
        disabled: true,
      });
      expect(patch).toHaveBeenNthCalledWith(2, '/auth-files/status', {
        name: 'shared.json',
        auth_index: 'auth-b',
        archived: true,
      });
      expect(patch).toHaveBeenNthCalledWith(3, '/auth-files/fields', {
        name: 'shared.json',
        auth_index: 'auth-b',
        note: 'kept separate',
      });
    } finally {
      patch.mockRestore();
    }
  });

  test('keeps indexed duplicates in batch delete targets while preserving legacy names', async () => {
    const remove = spyOn(apiClient, 'delete').mockResolvedValue({ status: 'ok', deleted: 2 });

    try {
      await authFilesApi.deleteFiles([indexedFile('auth-a'), indexedFile('auth-b')]);

      expect(remove).toHaveBeenCalledWith('/auth-files', {
        data: {
          names: [],
          targets: [
            { name: 'shared.json', auth_index: 'auth-a' },
            { name: 'shared.json', auth_index: 'auth-b' },
          ],
        },
      });
    } finally {
      remove.mockRestore();
    }
  });

  test('passes auth_index to model and download lookups', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue({ models: [] });
    const getRaw = spyOn(apiClient, 'getRaw').mockResolvedValue({ data: {} } as never);

    try {
      await authFilesApi.getModelsForAuthFile(indexedFile('auth-c'));
      await authFilesApi.download(indexedFile('auth-c'));

      expect(get).toHaveBeenCalledWith('/auth-files/models?name=shared.json&auth_index=auth-c');
      expect(getRaw).toHaveBeenCalledWith(
        '/auth-files/download?name=shared.json&auth_index=auth-c',
        {
          responseType: 'blob',
        }
      );
    } finally {
      get.mockRestore();
      getRaw.mockRestore();
    }
  });

  test('preserves indexed duplicate names when normalizing partial delete results', async () => {
    const remove = spyOn(apiClient, 'delete').mockResolvedValue({
      status: 'partial',
      deleted: 1,
      failed: [{ name: 'shared.json', auth_index: 'auth-b', error: 'locked' }],
    });

    try {
      const result = await authFilesApi.deleteFiles([indexedFile('auth-a'), indexedFile('auth-b')]);

      expect(result.deleted).toBe(1);
      expect(result.files).toEqual(['shared.json']);
      expect(result.failed).toEqual([
        { name: 'shared.json', authIndex: 'auth-b', error: 'locked' },
      ]);
    } finally {
      remove.mockRestore();
    }
  });

  test('derives repeated successful names for indexed duplicate delete targets', async () => {
    const remove = spyOn(apiClient, 'delete').mockResolvedValue({ status: 'ok', deleted: 2 });

    try {
      const result = await authFilesApi.deleteFiles([indexedFile('auth-a'), indexedFile('auth-b')]);

      expect(result.deleted).toBe(2);
      expect(result.files).toEqual(['shared.json', 'shared.json']);
    } finally {
      remove.mockRestore();
    }
  });
});
