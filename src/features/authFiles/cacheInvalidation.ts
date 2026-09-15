import { useQuotaStore } from '@/stores/useQuotaStore';
import { getQuotaCacheFileName } from '@/utils/quota/identity';

type ModelsInvalidator = (identityKeys?: string[]) => void;

/** Invalidate every cache whose contents depend on an auth file's credentials. */
export const invalidateAuthFileDerivedCaches = (
  invalidateModels: ModelsInvalidator,
  identityKeys?: string[]
): void => {
  invalidateModels(identityKeys);
  useQuotaStore
    .getState()
    .clearQuotaCache(identityKeys?.map((identityKey) => getQuotaCacheFileName(identityKey)));
};
