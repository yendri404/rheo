import { randomUUID } from 'node:crypto';
import {
  companyNameTaken,
  type CompanyChanges,
  type CompanyRepository,
  type CompanyWithRoutes,
  type Route,
  type RouteInput,
} from '../../companies/company.ts';

/** Test and local-dev adapter. */
export class InMemoryCompanyRepository implements CompanyRepository {
  readonly #companies = new Map<string, CompanyWithRoutes>();

  async list(): Promise<CompanyWithRoutes[]> {
    return [...this.#companies.values()].sort((a, b) => a.name.localeCompare(b.name)).map(copy);
  }

  async findById(id: string): Promise<CompanyWithRoutes | null> {
    const company = this.#companies.get(id);
    return company ? copy(company) : null;
  }

  async create(name: string, routes: RouteInput[]): Promise<CompanyWithRoutes> {
    this.#requireFreeName(name, null);
    const company = { id: randomUUID(), name, routes: mergeRoutes([], routes) };
    this.#companies.set(company.id, company);
    return copy(company);
  }

  async update(id: string, changes: CompanyChanges): Promise<CompanyWithRoutes | null> {
    const company = this.#companies.get(id);
    if (!company) return null;
    if (changes.name !== undefined) {
      this.#requireFreeName(changes.name, id);
      company.name = changes.name;
    }
    if (changes.routes !== undefined) company.routes = mergeRoutes(company.routes, changes.routes);
    return copy(company);
  }

  async delete(id: string): Promise<boolean> {
    return this.#companies.delete(id);
  }

  #requireFreeName(name: string, ownId: string | null): void {
    const wanted = name.toLowerCase();
    for (const company of this.#companies.values()) {
      if (company.id !== ownId && company.name.toLowerCase() === wanted) throw companyNameTaken();
    }
  }
}

function mergeRoutes(current: Route[], next: RouteInput[]): Route[] {
  const owned = new Set(current.map((route) => route.id));
  return next.map(({ id, name, kind }) => ({ id: id !== undefined && owned.has(id) ? id : randomUUID(), name, kind }));
}

function copy(company: CompanyWithRoutes): CompanyWithRoutes {
  return { id: company.id, name: company.name, routes: company.routes.map((route) => ({ ...route })) };
}
