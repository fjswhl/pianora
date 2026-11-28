import { createRemoteJWKSet, importSPKI, jwtVerify } from 'jose';

export interface AccountEnv {
  DB?: D1Database;
  PRIVATE_SCORES?: R2Bucket;
  APP_ORIGIN?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_JWT_KEY?: string;
}

let cachedKeys: { issuer: string; keys: ReturnType<typeof createRemoteJWKSet> } | undefined;

export async function signedInOwner(request: Request, env: AccountEnv): Promise<string | null> {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  // The issuer is selected exclusively by deployment configuration.
  const frontend = atob(env.CLERK_PUBLISHABLE_KEY!.split('_')[2]).replace(/\$$/, '');
  const issuer = 'https://' + frontend;
  if (cachedKeys?.issuer !== issuer) {
    cachedKeys = { issuer, keys: createRemoteJWKSet(new URL('/.well-known/jwks.json', issuer)) };
  }
  try {
    const keys = env.CLERK_JWT_KEY ? await importSPKI(env.CLERK_JWT_KEY, 'RS256') : cachedKeys.keys;
    const { payload } = await jwtVerify(header.slice(7), keys, {
      algorithms: ['RS256'], issuer, requiredClaims: ['exp', 'iat', 'sub', 'sid', 'azp'],
    });
    if (payload.azp !== env.APP_ORIGIN || payload.sts === 'pending' ||
        typeof payload.sid !== 'string' || !payload.sid.startsWith('sess_') ||
        typeof payload.sub !== 'string' || !/^user_[A-Za-z0-9]+$/.test(payload.sub)) return null;
    return payload.sub;
  } catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string' &&
        /^(ERR_JWT_|ERR_JWS_|ERR_JWKS_NO_MATCHING_KEY|ERR_JOSE_ALG_NOT_ALLOWED)/.test(error.code)) return null;
    throw error;
  }
}
