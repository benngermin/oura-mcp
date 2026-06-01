import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTenantStore, type TenantBlob } from "./tenant-store.js";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "oura-tenants-"));
}

const blobA: TenantBlob = {
  label: "Benn",
  client_id: "cid-a",
  client_secret: "secret-a",
  access_token: "access-a",
  refresh_token: "refresh-a",
};
const blobB: TenantBlob = {
  client_id: "cid-b",
  client_secret: "secret-b",
  access_token: "access-b",
  refresh_token: "refresh-b",
};

test("save → load round-trips a tenant blob", () => {
  const dir = tmpDir();
  try {
    const store = createTenantStore(dir);
    store.saveTenant("benn", blobA);
    assert.deepEqual(store.loadTenant("benn"), blobA);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadTenant returns null for an unknown owner", () => {
  const dir = tmpDir();
  try {
    const store = createTenantStore(dir);
    assert.equal(store.loadTenant("nobody"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saving a second owner preserves the first; listOwners returns both", () => {
  const dir = tmpDir();
  try {
    const store = createTenantStore(dir);
    store.saveTenant("benn", blobA);
    store.saveTenant("matthew", blobB);
    assert.deepEqual(store.loadTenant("benn"), blobA);
    assert.deepEqual(store.loadTenant("matthew"), blobB);
    assert.deepEqual(store.listOwners().sort(), ["benn", "matthew"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveTenant overwrites an existing owner and leaves a clean (atomic) file — no temp leftover", () => {
  const dir = tmpDir();
  try {
    const store = createTenantStore(dir);
    store.saveTenant("benn", blobA);
    store.saveTenant("benn", blobB);
    assert.deepEqual(store.loadTenant("benn"), blobB);
    // Atomic write = temp-then-rename; no stray temp files should remain.
    const stray = readdirSync(dir).filter((f) => f !== "tenants.json");
    assert.deepEqual(stray, [], `unexpected leftover files: ${stray.join(", ")}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("updateTokens replaces only the tokens, preserving client creds + label", () => {
  const dir = tmpDir();
  try {
    const store = createTenantStore(dir);
    store.saveTenant("benn", blobA);
    store.updateTokens("benn", { access: "new-access", refresh: "new-refresh" });
    assert.deepEqual(store.loadTenant("benn"), {
      label: "Benn",
      client_id: "cid-a",
      client_secret: "secret-a",
      access_token: "new-access",
      refresh_token: "new-refresh",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("updateTokens throws for an unknown owner", () => {
  const dir = tmpDir();
  try {
    const store = createTenantStore(dir);
    assert.throws(() => store.updateTokens("ghost", { access: "x", refresh: "y" }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tenants.json is written with 0600 permissions", () => {
  const dir = tmpDir();
  try {
    const store = createTenantStore(dir);
    store.saveTenant("benn", blobA);
    const mode = statSync(join(dir, "tenants.json")).mode & 0o777;
    assert.equal(mode, 0o600, `expected 0600, got 0${mode.toString(8)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a corrupt tenants.json is treated as empty rather than crashing loads", () => {
  const dir = tmpDir();
  try {
    writeFileSync(join(dir, "tenants.json"), "{ not valid json", { mode: 0o600 });
    const store = createTenantStore(dir);
    assert.equal(store.loadTenant("benn"), null);
    assert.deepEqual(store.listOwners(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
