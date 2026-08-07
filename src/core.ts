import { jwtVerify, importSPKI, type JWTPayload } from "jose";

// These are read lazily (inside functions) rather than at module load: a bare
// `process.env.X!` at the top level throws during bundling if the var is absent,
// which would break `next build` in any app that forgot to set it.
function suiteUrl(): string {
  return process.env.STRI_SUITE_URL!;
}
function appName(): string {
  return process.env.STRI_APP_NAME!;
}
function publicKeyPem(): string {
  return process.env.STRI_AUTH_PUBLIC_KEY!.replace(/\\n/g, "\n");
}

let cachedKey: CryptoKey | null = null;

async function getPublicKey(): Promise<CryptoKey> {
  if (!cachedKey) {
    cachedKey = await importSPKI(publicKeyPem(), "EdDSA");
  }
  return cachedKey;
}

export interface StriUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

/**
 * Verify a Suite-issued token and confirm it was minted for THIS app.
 * Returns the payload on success, or null on any failure (bad signature,
 * expiry, or wrong `app` claim). Never throws.
 */
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const key = await getPublicKey();
    const { payload } = await jwtVerify(token, key, {
      // Pin the algorithm and require an expiry so a token minted without one
      // can never verify forever. (`maxTokenAge` is intentionally omitted: it
      // would require an `iat` claim and reject tokens that lack one — the
      // cookie's own maxAge already bounds the session window.)
      algorithms: ["EdDSA"],
      requiredClaims: ["exp"],
    });
    if (payload.app !== appName()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function payloadToUser(payload: JWTPayload): StriUser {
  return {
    id: payload.sub as string,
    email: payload.email as string,
    name: payload.name as string,
    role: payload.role as string,
  };
}

export const config = {
  suiteUrl,
  appName,
  // Session cookie lifetime — must match APP_TOKEN_TTL_SECONDS in Suite's
  // stri-signing.ts. Apps re-broker silently on expiry, so this also bounds
  // how fast an access revocation propagates.
  sessionMaxAge: 60 * 60,
  cookieName: "stri-session",
};
