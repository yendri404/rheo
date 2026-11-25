// Kept free of Expo and React imports so it runs under `node --test`.
import type { Company } from '../api/types.ts';

/**
 * The company a driver works with: the one they picked if they still belong to it, otherwise the
 * first of their companies. Null when they are not registered in any.
 */
export function selectedCompany(companies: Company[], pickedId: string | null): Company | null {
  return companies.find((company) => company.id === pickedId) ?? companies[0] ?? null;
}
