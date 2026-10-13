import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT, generateKeyPair, exportSPKI } from "jose";
import { verifyToken, verifyActorToken } from "./core";

let privateKey: CryptoKey;
let publicPem: string;

beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  privateKey = pair.privateKey as CryptoKey;
  publicPem = await exportSPKI(pair.publicKey as CryptoKey);
  process.env.STRI_AUTH_PUBLIC_KEY = publicPem;
  process.env.STRI_APP_NAME = "Test App";
  process.env.STRI_SUITE_URL = "";
});

function claims(over: Record<string, unknown> = {}) {
  return { sub: "u1", email: "a@b.c", name: "A", role: "USER", app: "Test App", ...over };
}

async function eddsa(over: Record<string, unknown> = {}, withExp = true) {
  let jwt = new SignJWT(claims(over)).setProtectedHeader({ alg: "EdDSA" }).setIssuedAt();
  if (withExp) jwt = jwt.setExpirationTime("1h");
  return jwt.sign(privateKey);
}

describe("verifyToken", () => {
  it("accepts a well-formed Suite token for this app", async () => {
    expect(await verifyToken(await eddsa())).not.toBeNull();
  });

  it("rejects a token without exp", async () => {
    expect(await verifyToken(await eddsa({}, false))).toBeNull();
  });

  it("rejects a token for another app", async () => {
    expect(await verifyToken(await eddsa({ app: "Other App" }))).toBeNull();
  });

  it("rejects an expired token", async () => {
    const t = await new SignJWT(claims())
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(privateKey);
    expect(await verifyToken(t)).toBeNull();
  });

  it("rejects alg:none", async () => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const t = `${enc({ alg: "none", typ: "JWT" })}.${enc(claims({ exp }))}.`;
    expect(await verifyToken(t)).toBeNull();
  });

  it("rejects HS256 signed with the public key as the secret", async () => {
    const t = await new SignJWT(claims())
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(publicPem));
    expect(await verifyToken(t)).toBeNull();
  });
});

describe("verifyActorToken", () => {
  it("accepts a sibling app's token", async () => {
    expect(await verifyActorToken(await eddsa({ app: "Other App" }))).not.toBeNull();
  });

  it("rejects a token without exp", async () => {
    expect(await verifyActorToken(await eddsa({}, false))).toBeNull();
  });
});
