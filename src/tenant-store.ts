import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/** One owner's Oura credential set — the unit of tenancy for the HTTP server. */
export interface TenantBlob {
  label?: string;
  client_id: string;
  client_secret: string;
  access_token: string;
  refresh_token: string;
}

export interface TenantStore {
  loadTenant(owner: string): TenantBlob | null;
  saveTenant(owner: string, blob: TenantBlob): void;
  updateTokens(owner: string, tokens: { access: string; refresh: string }): void;
  listOwners(): string[];
}

type TenantsFile = Record<string, TenantBlob>;

/**
 * Per-owner token store backed by a single JSON file at `${dataDir}/tenants.json`
 * (0600), keyed by owner. Writes are atomic (temp file + rename) so a crash mid-
 * write never corrupts the store. No native deps — fine for a handful of tenants;
 * swap for SQLite if it ever grows large.
 */
export function createTenantStore(dataDir: string): TenantStore {
  const file = join(dataDir, "tenants.json");
  const tmpFile = join(dataDir, "tenants.json.tmp");

  function readAll(): TenantsFile {
    if (!existsSync(file)) return {};
    try {
      const parsed = JSON.parse(readFileSync(file, "utf-8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as TenantsFile;
      }
      return {};
    } catch {
      // A corrupt store is treated as empty rather than crashing every request.
      return {};
    }
  }

  function writeAll(data: TenantsFile): void {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    writeFileSync(tmpFile, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmpFile, file); // atomic on the same filesystem
  }

  return {
    loadTenant(owner) {
      return readAll()[owner] ?? null;
    },
    saveTenant(owner, blob) {
      const all = readAll();
      all[owner] = blob;
      writeAll(all);
    },
    updateTokens(owner, tokens) {
      const all = readAll();
      const existing = all[owner];
      if (!existing) {
        throw new Error(`updateTokens: unknown owner "${owner}"`);
      }
      existing.access_token = tokens.access;
      existing.refresh_token = tokens.refresh;
      writeAll(all);
    },
    listOwners() {
      return Object.keys(readAll());
    },
  };
}
