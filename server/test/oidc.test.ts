// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K5-09 — OIDC SSO behind a flag: encrypted secrets, discovery test without
 * lockout, PKCE login, explicit linking, and strict refusal to auto-link by
 * email (D-14, docs/features/auth.md §7).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startServer, type TestClient } from './helpers/server.js';

/** The published signing key, and a second pair no JWKS entry mentions. */
const KEY_PAIR = generateKeyPairSync('rsa', { modulusLength: 2048 });
const FOREIGN_KEY_PAIR = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SIGNING_KID = 'test-signing-key-1';
const PUBLIC_JWK = {
  ...KEY_PAIR.publicKey.export({ format: 'jwk' }),
  kid: SIGNING_KID,
  alg: 'RS256',
  use: 'sig',
};

type FakeIdpState = {
  sub: string;
  email: string;
  name: string;
  preferredUsername: string;
  lastCodeChallenge: string | null;
  lastNonce: string | null;
  lastCodeVerifier: string | null;
  lastClientSecret: string | null;
  /** How the next ID token is minted; tests flip these to prove each refusal. */
  algorithm: 'RS256' | 'HS256' | 'none';
  signingKey: 'published' | 'foreign';
  /** `null` means "whatever the client sent as client_id". */
  audience: string | null;
  /** `null` means "the fake issuer's own base URL". */
  issuer: string | null;
  expiresInSeconds: number;
};

function resetTokenMinting(state: FakeIdpState): void {
  state.algorithm = 'RS256';
  state.signingKey = 'published';
  state.audience = null;
  state.issuer = null;
  state.expiresInSeconds = 300;
}

function startFakeIdp(state: FakeIdpState): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    let baseUrl = '';
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', baseUrl);
      if (url.pathname === '/.well-known/openid-configuration') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            issuer: baseUrl,
            authorization_endpoint: `${baseUrl}/authorize`,
            token_endpoint: `${baseUrl}/token`,
            userinfo_endpoint: `${baseUrl}/userinfo`,
            jwks_uri: `${baseUrl}/jwks`,
          }),
        );
        return;
      }
      if (url.pathname === '/jwks') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ keys: [PUBLIC_JWK] }));
        return;
      }
      if (url.pathname === '/token' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
          state.lastCodeVerifier = params.get('code_verifier');
          state.lastClientSecret = params.get('client_secret');
          const clientId = params.get('client_id') ?? 'unknown-client';
          const now = Math.floor(Date.now() / 1000);

          const header: Record<string, unknown> = { typ: 'JWT', alg: state.algorithm };
          if (state.algorithm !== 'none') header.kid = SIGNING_KID;
          const payload: Record<string, unknown> = {
            iss: state.issuer ?? baseUrl,
            aud: state.audience ?? clientId,
            sub: state.sub,
            email: state.email,
            email_verified: true,
            name: state.name,
            preferred_username: state.preferredUsername,
            nonce: state.lastNonce,
            iat: now,
            exp: now + state.expiresInSeconds,
          };

          const headerSegment = Buffer.from(JSON.stringify(header)).toString('base64url');
          const payloadSegment = Buffer.from(JSON.stringify(payload)).toString('base64url');
          const signingInput = `${headerSegment}.${payloadSegment}`;
          let signatureSegment = '';
          if (state.algorithm === 'RS256') {
            const privateKey =
              state.signingKey === 'published' ? KEY_PAIR.privateKey : FOREIGN_KEY_PAIR.privateKey;
            signatureSegment = cryptoSign('sha256', Buffer.from(signingInput), privateKey).toString(
              'base64url',
            );
          } else if (state.algorithm === 'HS256') {
            signatureSegment = createHmac('sha256', state.lastClientSecret ?? '')
              .update(signingInput)
              .digest('base64url');
          }

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              access_token: 'fake-access-token',
              token_type: 'Bearer',
              id_token: `${signingInput}.${signatureSegment}`,
            }),
          );
        });
        return;
      }
      if (url.pathname === '/userinfo') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            sub: state.sub,
            email: state.email,
            name: state.name,
            preferred_username: state.preferredUsername,
          }),
        );
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        url: baseUrl,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

let harness: Awaited<ReturnType<typeof startServer>>;
let idp: { url: string; close: () => Promise<void> };
const idpState: FakeIdpState = {
  sub: 'oidc-sub-initial',
  email: 'initial@example.test',
  name: 'Initial User',
  preferredUsername: 'initial',
  lastCodeChallenge: null,
  lastNonce: null,
  lastCodeVerifier: null,
  lastClientSecret: null,
  algorithm: 'RS256',
  signingKey: 'published',
  audience: null,
  issuer: null,
  expiresInSeconds: 300,
};

beforeAll(async () => {
  harness = await startServer();
  idp = await startFakeIdp(idpState);
});

afterAll(async () => {
  await idp.close();
  await harness.close();
});

async function makeAdmin(suffix: string) {
  const client = harness.client();
  const user = await client.signup(`oidc-admin-${suffix}`);
  await harness.db.user.update({
    where: { id: user.id },
    data: { is_instance_admin: true },
  });
  return { client, user };
}

describe('OIDC SSO behind a flag (K5-09)', () => {
  it('stores client secrets encrypted at rest, reports readable discovery errors, and never locks out local login', async () => {
    const { client: admin, user: adminUser } = await makeAdmin('broken');
    const rawSecret = 'super-secret-oidc-client-value-42';

    const created = await admin.request('POST', '/api/v1/admin/oidc/providers', {
      slug: `broken-${admin.suffix}`,
      name: 'Broken IdP',
      issuer_url: 'http://127.0.0.1:1',
      client_id: 'klui-broken-client',
      client_secret: rawSecret,
      enabled: true,
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json() as {
      slug: string;
      has_secret: boolean;
      client_secret?: string;
    };
    expect(createdBody.has_secret).toBe(true);
    expect(createdBody.client_secret).toBeUndefined();

    // Secret must be encrypted at rest in Postgres, never plaintext.
    const rawRow = await harness.db.$queryRawUnsafe<{ client_secret_enc: string }[]>(
      `SELECT client_secret_enc FROM oidc_providers WHERE slug = $1`,
      createdBody.slug,
    );
    expect(rawRow[0]?.client_secret_enc).toBeDefined();
    expect(rawRow[0]?.client_secret_enc).not.toContain(rawSecret);
    expect(rawRow[0]?.client_secret_enc.startsWith('v1.')).toBe(true);

    // Admin discovery test returns a readable error without throwing 500.
    const tested = await admin.request(
      'POST',
      `/api/v1/admin/oidc/providers/${createdBody.slug}/test`,
      {},
    );
    expect(tested.statusCode).toBe(200);
    const testBody = tested.json() as { ok: boolean; error?: string };
    expect(testBody.ok).toBe(false);
    expect(testBody.error).toBeTruthy();

    // Break-glass local password login still succeeds even with a broken provider enabled.
    const localClient = harness.client();
    const localLogin = await localClient.request('POST', '/api/v1/auth/login', {
      email_or_username: adminUser.username,
      password: 'a-long-enough-password',
    });
    expect(localLogin.statusCode).toBe(200);
  });

  it('refuses to auto-link an existing local account by email, then allows explicit linking and subsequent OIDC sign-in', async () => {
    const cookieHeaderFor = (
      response: { cookies: { name: string; value: string }[] },
      existing?: string,
    ): string => {
      const oidc = response.cookies.find((c) => c.name === 'klui_oidc');
      const parts = [existing, oidc ? `klui_oidc=${oidc.value}` : undefined].filter(
        (v): v is string => Boolean(v),
      );
      return parts.join('; ');
    };

    const { client: admin } = await makeAdmin('flow');
    const slug = `fake-${admin.suffix}`;
    const secret = 'oidc-live-secret-999';

    const created = await admin.request('POST', '/api/v1/admin/oidc/providers', {
      slug,
      name: 'Fake OIDC',
      issuer_url: idp.url,
      client_id: 'klui-live-client',
      client_secret: secret,
      enabled: true,
    });
    expect(created.statusCode).toBe(201);

    // Discovery test succeeds against the local fake IdP.
    const tested = await admin.request('POST', `/api/v1/admin/oidc/providers/${slug}/test`, {});
    expect(tested.statusCode).toBe(200);
    expect((tested.json() as { ok: boolean }).ok).toBe(true);

    // Create a local account first.
    const local = harness.client();
    const localUser = await local.signup(`oidc-local-${local.suffix}`);
    const localRow = await harness.db.user.findUniqueOrThrow({ where: { id: localUser.id } });

    // Configure fake IdP to emit the SAME email as the existing local account.
    idpState.sub = `sub-for-${local.suffix}`;
    idpState.email = localRow.email;
    idpState.name = 'Local User';
    idpState.preferredUsername = localUser.username;

    // 1. Unauthenticated OIDC login attempt with matching email MUST NOT auto-link.
    const anon = harness.client();
    const startRes = await anon.request('GET', `/api/v1/auth/oidc/${slug}/start`);
    expect(startRes.statusCode).toBe(302);
    const authorizeUrl = new URL(String(startRes.headers.location));
    const state = authorizeUrl.searchParams.get('state') ?? '';
    idpState.lastNonce = authorizeUrl.searchParams.get('nonce');
    idpState.lastCodeChallenge = authorizeUrl.searchParams.get('code_challenge');
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(state).toBeTruthy();

    const callbackRefused = await anon.request(
      'GET',
      `/api/v1/auth/oidc/${slug}/callback?code=auth-code-1&state=${encodeURIComponent(state)}`,
      undefined,
      {
        cookie: cookieHeaderFor(
          startRes as unknown as { cookies: { name: string; value: string }[] },
        ),
      },
    );
    expect(callbackRefused.statusCode).toBe(409);
    // Must not have created a session or an OAuthAccount row.
    const who = await anon.request('GET', '/api/v1/me');
    expect(who.statusCode).toBe(401);
    const linkedBefore = await harness.db.oAuthAccount.findMany({
      where: { user_id: localUser.id },
    });
    expect(linkedBefore).toHaveLength(0);

    // 2. Explicit linking while signed in locally succeeds.
    const linkStart = await local.request('POST', `/api/v1/auth/oidc/${slug}/link`, {});
    expect(linkStart.statusCode).toBe(200);
    const linkUrl = new URL((linkStart.json() as { url: string }).url);
    const linkState = linkUrl.searchParams.get('state') ?? '';
    idpState.lastNonce = linkUrl.searchParams.get('nonce');

    const linkCallback = await local.request(
      'GET',
      `/api/v1/auth/oidc/${slug}/callback?code=link-code-2&state=${encodeURIComponent(linkState)}`,
      undefined,
      {
        cookie: cookieHeaderFor(
          linkStart as unknown as { cookies: { name: string; value: string }[] },
          local.headers().cookie,
        ),
      },
    );
    expect(linkCallback.statusCode).toBe(302);
    expect(idpState.lastClientSecret).toBe(secret);
    expect(idpState.lastCodeVerifier).toBeTruthy();

    const linkedAfter = await harness.db.oAuthAccount.findMany({
      where: { user_id: localUser.id, provider: slug },
    });
    expect(linkedAfter).toHaveLength(1);
    expect(linkedAfter[0]?.provider_account_id).toBe(idpState.sub);

    // 3. Subsequent OIDC login resolves to the linked local account via provider_account_id.
    const freshBrowser = harness.client();
    const loginStart = await freshBrowser.request('GET', `/api/v1/auth/oidc/${slug}/start`);
    expect(loginStart.statusCode).toBe(302);
    const loginAuthUrl = new URL(String(loginStart.headers.location));
    const loginState = loginAuthUrl.searchParams.get('state') ?? '';
    idpState.lastNonce = loginAuthUrl.searchParams.get('nonce');

    const loginCb = await freshBrowser.request(
      'GET',
      `/api/v1/auth/oidc/${slug}/callback?code=login-code-3&state=${encodeURIComponent(loginState)}`,
      undefined,
      {
        cookie: cookieHeaderFor(
          loginStart as unknown as { cookies: { name: string; value: string }[] },
        ),
      },
    );
    expect(loginCb.statusCode).toBe(302);
    expect(loginCb.headers.location).toBe('/boards');

    const me = await freshBrowser.request('GET', '/api/v1/me');
    expect(me.statusCode).toBe(200);
    expect((me.json() as { id: string }).id).toBe(localUser.id);
  });
});

/**
 * H1 — the ID token is verified before any claim is trusted: signature against
 * the provider JWKS, then iss/aud/azp/exp/iat/nonce. An unsigned token is not
 * "unverified but continue", it is refused.
 */
describe('OIDC ID token verification', () => {
  const RUN = Date.now().toString(36);

  beforeEach(() => {
    resetTokenMinting(idpState);
  });

  let providerSeq = 0;

  async function configureProvider(): Promise<{ slug: string; client: TestClient }> {
    providerSeq += 1;
    const { client } = await makeAdmin(`v${RUN}-${providerSeq}`);
    const slug = `verify-${client.suffix}`;
    const created = await client.request('POST', '/api/v1/admin/oidc/providers', {
      slug,
      name: 'Verifying IdP',
      issuer_url: idp.url,
      client_id: 'klui-verify-client',
      client_secret: 'verify-secret-456',
      enabled: true,
    });
    expect(created.statusCode).toBe(201);
    return { slug, client };
  }

  /** Run start → callback with the fake IdP minting whatever `idpState` says. */
  async function attemptLogin(slug: string): Promise<{
    browser: TestClient;
    callback: Awaited<ReturnType<TestClient['request']>>;
  }> {
    const browser = harness.client();
    const startRes = await browser.request('GET', `/api/v1/auth/oidc/${slug}/start`);
    expect(startRes.statusCode).toBe(302);
    const authorizeUrl = new URL(String(startRes.headers.location));
    const state = authorizeUrl.searchParams.get('state') ?? '';
    idpState.lastNonce = authorizeUrl.searchParams.get('nonce');
    const oidc = (startRes.cookies as { name: string; value: string }[]).find(
      (cookie) => cookie.name === 'klui_oidc',
    );
    const callback = await browser.request(
      'GET',
      `/api/v1/auth/oidc/${slug}/callback?code=auth-code-verify&state=${encodeURIComponent(state)}`,
      undefined,
      { cookie: oidc ? `klui_oidc=${oidc.value}` : '' },
    );
    return { browser, callback };
  }

  it('accepts an RS256 ID token signed by a key published in the JWKS', async () => {
    const { slug } = await configureProvider();
    idpState.sub = `rs256-sub-${RUN}`;
    idpState.email = `rs256-${RUN}@example.test`;
    idpState.preferredUsername = `rs256-${RUN}`;

    const { browser, callback } = await attemptLogin(slug);
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('/boards');

    const me = await browser.request('GET', '/api/v1/me');
    expect(me.statusCode).toBe(200);
    const created = await harness.db.user.findUnique({ where: { email: idpState.email } });
    expect(created).not.toBeNull();
    expect((me.json() as { id: string }).id).toBe(created?.id);
    const link = await harness.db.oAuthAccount.findFirst({
      where: { provider: slug, provider_account_id: idpState.sub },
    });
    expect(link?.user_id).toBe(created?.id);
  });

  it('accepts an HS256 ID token signed with the provider client secret', async () => {
    const { slug } = await configureProvider();
    idpState.algorithm = 'HS256';
    idpState.sub = `hs256-sub-${RUN}`;
    idpState.email = `hs256-${RUN}@example.test`;
    idpState.preferredUsername = `hs256-${RUN}`;

    const { browser, callback } = await attemptLogin(slug);
    expect(callback.statusCode).toBe(302);
    expect((await browser.request('GET', '/api/v1/me')).statusCode).toBe(200);
  });

  it('refuses an ID token signed by a key the JWKS does not publish, and creates no session', async () => {
    const { slug } = await configureProvider();
    idpState.signingKey = 'foreign';
    idpState.sub = `forged-sub-${RUN}`;
    idpState.email = `forged-${RUN}@example.test`;
    idpState.preferredUsername = `forged-${RUN}`;

    const { browser, callback } = await attemptLogin(slug);
    expect(callback.statusCode).toBe(401);
    expect((callback.json() as { error: { code: string } }).error.code).toBe('unauthenticated');

    expect((await browser.request('GET', '/api/v1/me')).statusCode).toBe(401);
    expect(await harness.db.user.findUnique({ where: { email: idpState.email } })).toBeNull();
    expect(
      await harness.db.oAuthAccount.findFirst({
        where: { provider: slug, provider_account_id: idpState.sub },
      }),
    ).toBeNull();
  });

  it('refuses an expired ID token', async () => {
    const { slug } = await configureProvider();
    idpState.expiresInSeconds = -120;
    idpState.sub = `expired-sub-${RUN}`;
    idpState.email = `expired-${RUN}@example.test`;
    idpState.preferredUsername = `expired-${RUN}`;

    const { browser, callback } = await attemptLogin(slug);
    expect(callback.statusCode).toBe(401);
    expect((callback.json() as { error: { message: string } }).error.message).toContain('exp');
    expect((await browser.request('GET', '/api/v1/me')).statusCode).toBe(401);
  });

  it('refuses an ID token whose aud names another client', async () => {
    const { slug } = await configureProvider();
    idpState.audience = 'some-other-client';
    idpState.sub = `aud-sub-${RUN}`;
    idpState.email = `aud-${RUN}@example.test`;
    idpState.preferredUsername = `aud-${RUN}`;

    const { browser, callback } = await attemptLogin(slug);
    expect(callback.statusCode).toBe(401);
    expect((callback.json() as { error: { message: string } }).error.message).toContain('aud');
    expect((await browser.request('GET', '/api/v1/me')).statusCode).toBe(401);
  });

  it('refuses an ID token whose iss names another issuer', async () => {
    const { slug } = await configureProvider();
    idpState.issuer = 'https://issuer.example.test';
    idpState.sub = `iss-sub-${RUN}`;
    idpState.email = `iss-${RUN}@example.test`;
    idpState.preferredUsername = `iss-${RUN}`;

    const { browser, callback } = await attemptLogin(slug);
    expect(callback.statusCode).toBe(401);
    expect((callback.json() as { error: { message: string } }).error.message).toContain('iss');
    expect((await browser.request('GET', '/api/v1/me')).statusCode).toBe(401);
  });

  it('refuses an alg: none ID token', async () => {
    const { slug } = await configureProvider();
    idpState.algorithm = 'none';
    idpState.sub = `none-sub-${RUN}`;
    idpState.email = `none-${RUN}@example.test`;
    idpState.preferredUsername = `none-${RUN}`;

    const { browser, callback } = await attemptLogin(slug);
    expect(callback.statusCode).toBe(401);
    const body = callback.json() as { error: { code: string; hint: string | null } };
    expect(body.error.code).toBe('unauthenticated');
    expect(body.error.hint).toBe('This instance verifies RS256, PS256 and HS256 ID tokens.');
    expect((await browser.request('GET', '/api/v1/me')).statusCode).toBe(401);
  });
});
