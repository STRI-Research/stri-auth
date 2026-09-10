import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT, generateKeyPair, exportPKCS8, exportSPKI } from "jose";
import {
  mintKey,
  hashKey,
  requireWorkload,
  encodeCursor,
  decodeCursor,
  pageLimit,
  type ApiKeyRecord,
  type KeyStore,
} from "./api";
import { createApiKeyHandlers, type AdminKeyStore } from "./api-admin";

let privateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  privateKey = pair.privateKey as CryptoKey;
  process.env.STRI_AUTH_PUBLIC_KEY = await exportSPKI(pair.publicKey as CryptoKey);
  process.env.STRI_APP_NAME = "Test App";
  process.env.STRI_SUITE_URL = "";
  delete process.env.VERCEL_ENV; // development
  void exportPKCS8; // keep import used for clarity in error output
});

function record(over: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  const m = mintKey("test");
  return {
    id: "k1",
    name: "Test consumer",
    consumer: "Job Board",
    prefix: m.prefix,
    hash: m.hash,
    scopes: ["jobs:read"],
    environment: "development",
    createdBy: "u1",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 86_400_000),
    revokedAt: null,
    lastUsedAt: null,
    useCount: 0,
    ...over,
  };
}

function storeFor(...records: ApiKeyRecord[]): KeyStore & { touched: string[] } {
  const touched: string[] = [];
  return {
    touched,
    async findByHash(h) {
      return records.find((r) => r.hash === h) ?? null;
    },
    async touch(id) {
      touched.push(id);
    },
  };
}

function req(headers: Record<string, string> = {}, url = "https://app.test/api/v1/x"): Request {
  return new Request(url, { headers });
}

async function sessionJwt(claims: Record<string, unknown>, expSeconds = 3600): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expSeconds)
    .sign(privateKey);
}

describe("mintKey", () => {
  it("produces a greppable, high-entropy key and a stable hash", () => {
    const m = mintKey("planner");
    expect(m.secret.startsWith("stri_planner_")).toBe(true);
    expect(m.secret.length).toBeGreaterThan(50);
    expect(m.prefix).toBe(m.secret.slice(0, 16));
    expect(hashKey(m.secret)).toBe(m.hash);
    expect(mintKey("planner").secret).not.toBe(m.secret);
  });
  it("rejects a bad slug", () => {
    expect(() => mintKey("Bad Slug")).toThrow();
  });
});

describe("requireWorkload", () => {
  it("401 without a bearer", async () => {
    const r = await requireWorkload(req(), storeFor(record()));
    expect(r).toBeInstanceOf(Response);
    expect((r as Response).status).toBe(401);
  });

  it("401 for an unknown key", async () => {
    const r = await requireWorkload(req({ authorization: `Bearer ${mintKey("test").secret}` }), storeFor(record()));
    expect((r as Response).status).toBe(401);
  });

  it("401 for a JWT-shaped token (no workload JWTs yet)", async () => {
    const r = await requireWorkload(req({ authorization: "Bearer a.b.c" }), storeFor(record()));
    expect((r as Response).status).toBe(401);
  });

  it("accepts a valid key with the right scope and touches it", async () => {
    const m = mintKey("test");
    const rec = record({ hash: m.hash, prefix: m.prefix });
    const store = storeFor(rec);
    const r = await requireWorkload(req({ authorization: `Bearer ${m.secret}` }), store, { scope: "jobs:read" });
    expect(r).not.toBeInstanceOf(Response);
    const w = r as Exclude<typeof r, Response>;
    expect(w.consumer).toBe("Job Board");
    expect(w.actor).toBeNull();
    await new Promise((res) => setTimeout(res, 0));
    expect(store.touched).toEqual(["k1"]);
  });

  it("403 insufficient_scope with required and granted in details", async () => {
    const m = mintKey("test");
    const rec = record({ hash: m.hash });
    const r = (await requireWorkload(req({ authorization: `Bearer ${m.secret}` }), storeFor(rec), {
      scope: "jobs:write",
    })) as Response;
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.code).toBe("insufficient_scope");
    expect(body.details).toEqual({ required: "jobs:write", granted: ["jobs:read"] });
  });

  it("401 for revoked and expired keys", async () => {
    const a = mintKey("test");
    const b = mintKey("test");
    const store = storeFor(
      record({ id: "a", hash: a.hash, revokedAt: new Date() }),
      record({ id: "b", hash: b.hash, expiresAt: new Date(Date.now() - 1000) })
    );
    expect(((await requireWorkload(req({ authorization: `Bearer ${a.secret}` }), store)) as Response).status).toBe(401);
    expect(((await requireWorkload(req({ authorization: `Bearer ${b.secret}` }), store)) as Response).status).toBe(401);
  });

  it("401 for a key from another environment", async () => {
    const m = mintKey("test");
    const r = (await requireWorkload(
      req({ authorization: `Bearer ${m.secret}` }),
      storeFor(record({ hash: m.hash, environment: "production" }))
    )) as Response;
    expect(r.status).toBe(401);
    expect((await r.json()).error).toMatch(/production key/);
  });

  it("verifies a forwarded actor and ignores its app claim", async () => {
    const m = mintKey("test");
    const jwt = await sessionJwt({ sub: "user_1", email: "sam@strigroup.com", name: "Sam", role: "USER", app: "Some Other App" });
    const r = await requireWorkload(
      req({ authorization: `Bearer ${m.secret}`, "x-stri-actor": jwt }),
      storeFor(record({ hash: m.hash })),
      { actor: "required" }
    );
    expect(r).not.toBeInstanceOf(Response);
    expect((r as { actor: { suiteUserId: string } }).actor.suiteUserId).toBe("user_1");
  });

  it("403 actor_required when required and absent; 403 actor_invalid when garbage", async () => {
    const m = mintKey("test");
    const store = storeFor(record({ hash: m.hash }));
    const missing = (await requireWorkload(req({ authorization: `Bearer ${m.secret}` }), store, { actor: "required" })) as Response;
    expect((await missing.json()).code).toBe("actor_required");
    const bad = (await requireWorkload(
      req({ authorization: `Bearer ${m.secret}`, "x-stri-actor": "not.a.jwt" }),
      store
    )) as Response;
    expect((await bad.json()).code).toBe("actor_invalid");
  });

  it("rejects an expired actor token", async () => {
    const m = mintKey("test");
    const jwt = await sessionJwt({ sub: "user_1", email: "x@y", name: "X", role: "USER" }, -10);
    const r = (await requireWorkload(
      req({ authorization: `Bearer ${m.secret}`, "x-stri-actor": jwt }),
      storeFor(record({ hash: m.hash }))
    )) as Response;
    expect((await r.json()).code).toBe("actor_invalid");
  });
});

describe("pagination helpers", () => {
  it("round-trips a cursor and clamps limit", () => {
    const c = encodeCursor({ after: "abc", ts: 1 });
    expect(decodeCursor(c)).toEqual({ after: "abc", ts: 1 });
    expect(decodeCursor("!!!")).toBeNull();
    expect(pageLimit(new URL("https://x/?limit=999"))).toBe(200);
    expect(pageLimit(new URL("https://x/?limit=0"))).toBe(50);
    expect(pageLimit(new URL("https://x/?limit=7"))).toBe(7);
  });
});

describe("admin handlers", () => {
  function adminStore(): AdminKeyStore & { rows: ApiKeyRecord[] } {
    const rows: ApiKeyRecord[] = [];
    return {
      rows,
      async findByHash(h) {
        return rows.find((r) => r.hash === h) ?? null;
      },
      async touch() {},
      async list() {
        return rows;
      },
      async create(rec) {
        const row: ApiKeyRecord = { ...rec, id: `k${rows.length + 1}`, createdAt: new Date(), lastUsedAt: null, useCount: 0, revokedAt: null };
        rows.push(row);
        return row;
      },
      async revoke(id) {
        const row = rows.find((r) => r.id === id);
        if (!row) return false;
        row.revokedAt ??= new Date();
        return true;
      },
    };
  }

  it("mints, lists without the hash, and revokes", async () => {
    const store = adminStore();
    const h = createApiKeyHandlers({
      appSlug: "test",
      scopes: ["jobs:read", "jobs:write"],
      store,
      isAdmin: async () => ({ id: "admin_1" }),
    });
    const created = await h.POST(
      new Request("https://x/api/v1/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: "JB", consumer: "Job Board", scopes: ["jobs:read"], environment: "development" }),
      })
    );
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.secret.startsWith("stri_test_")).toBe(true);
    expect(body.hash).toBeUndefined();

    const listed = await (await h.GET(new Request("https://x/api/v1/api-keys"))).json();
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].hash).toBeUndefined();
    expect(listed.items[0].secret).toBeUndefined();

    // The minted secret authenticates through the same store.
    const w = await requireWorkload(
      new Request("https://x/api/v1/jobs", { headers: { authorization: `Bearer ${body.secret}` } }),
      store,
      { scope: "jobs:read" }
    );
    expect(w).not.toBeInstanceOf(Response);

    const del = await h.DELETE(new Request(`https://x/api/v1/api-keys/${body.id}`, { method: "DELETE" }), {
      params: { id: body.id },
    });
    expect(del.status).toBe(204);
    const after = await requireWorkload(
      new Request("https://x/api/v1/jobs", { headers: { authorization: `Bearer ${body.secret}` } }),
      store
    );
    expect((after as Response).status).toBe(401);
  });

  it("validates scopes and refuses non-admins", async () => {
    const store = adminStore();
    const h = createApiKeyHandlers({ appSlug: "test", scopes: ["jobs:read"], store, isAdmin: async () => ({ id: "a" }) });
    const bad = await h.POST(
      new Request("https://x/", { method: "POST", body: JSON.stringify({ name: "x", consumer: "y", scopes: ["nope"] }) })
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()).details.scopes).toMatch(/unknown scope/);

    const denied = createApiKeyHandlers({ appSlug: "test", scopes: ["jobs:read"], store, isAdmin: async () => null });
    expect((await denied.GET(new Request("https://x/"))).status).toBe(403);
  });
});
