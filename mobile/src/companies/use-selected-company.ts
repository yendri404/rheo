import { useCallback, useEffect, useState } from 'react';
import type { Company } from '../api/types';
import { secureStorage } from '../session/secure-storage';
import { selectedCompany } from './selected-company';

const STORAGE_KEY = 'driver-company';

/**
 * The company the driver chose to work with, remembered on the device between app starts.
 * `ready` is false until the stored choice was read, so the screen does not connect to one
 * company and immediately jump to another.
 */
export function useSelectedCompany(companies: Company[]): {
  company: Company | null;
  ready: boolean;
  select: (companyId: string) => void;
} {
  const [pickedId, setPickedId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    secureStorage
      .get(STORAGE_KEY)
      .then((stored) => setPickedId(stored ?? null))
      .catch(() => setPickedId(null));
  }, []);

  const select = useCallback((companyId: string) => {
    setPickedId(companyId);
    secureStorage.set(STORAGE_KEY, companyId).catch(() => {});
  }, []);

  return { company: selectedCompany(companies, pickedId ?? null), ready: pickedId !== undefined, select };
}
