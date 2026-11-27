// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OIDC SSO behind per-provider flags (docs/features/auth.md §7–§8, D-14, K5-09).
 *
 * - Client secrets are encrypted at rest with the instance AES-256-GCM key and
 *   never returned by any API endpoint.
 * - Authorization code + PKCE (S256), state and nonce stored in a signed
 *   httpOnly cookie.
 * - Account linking is strictly explicit: an existing local account sharing an
 *   email address is NEVER auto-linked.
 * - A broken discovery URL or failing IdP never locks out local password login.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Db } from '../db.js';
import type { Env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { recordEvent } from '../lib/events.js';
import { newId } from '../lib/ids.js';
import { hashPassword } from '../lib/password.js';
import { isReserved } from '../lib/reserved.js';
import { open, seal } from '../lib/sealed.js';
import { registrationOpen } from './service.js';
import { issueSession, type IssuedSession } from './sessions.js';

export type OidcProviderDto = {
  id: string;
  slug: string;
  name: string;
  issuer_url: string;
  client_id: string;
  scopes: string;
  enabled: boolean;
  has_secret: boolean;
  created_at: string;
  updated_at: string;
};

export type PublicOidcProviderDto = {
  slug: string;
  name: string;
};

export type LinkedOidcAccountDto = {
  id: string;
  provider: string;
  provider_account_id: string;
  created_at: string;
};

export type OidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
};

export type OidcTestResult =
  | {
      ok: true;
      issuer: string;
      authorization_endpoint: string;
      token_endpoint: string;
    }
  | { ok: false; error: string };

export type OidcStateCookie = {
  state: string;
  nonce: string;
  code_verifier: string;
  provider: string;
  mode: 'login' | 'link';
  user_id?: string;
};

export const OIDC_STATE_COOKIE = 'klui_oidc';

async function requireInstanceAdmin(db: Db, userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { is_instance_admin: true },
  });
  if (!user?.is_instance_admin) {
    throw new AppError('forbidden', {
      message: 'Only an instance admin can do that.',
      hint: null,
    });
  }
}

function toProviderDto(row: {
  id: string;
  slug: string;
  name: string;
  issuer_url: string;
  client_id: string;
  client_secret_enc: string;
  scopes: string;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}): OidcProviderDto {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    issuer_url: row.issuer_url,
    client_id: row.client_id,
    scopes: row.scopes,
    enabled: row.enabled,
    has_secret: row.client_secret_enc.length > 0,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function listEnabledOidcProviders(db: Db): Promise<PublicOidcProviderDto[]> {
  const rows = await db.oidcProvider.findMany({
    where: { enabled: true },
    orderBy: [{ name: 'asc' }, { slug: 'asc' }],
    select: { slug: true, name: true },
  });
  return rows;
}

export async function listAdminOidcProviders(db: Db, adminId: string): Promise<OidcProviderDto[]> {
  await requireInstanceAdmin(db, adminId);
  const rows = await db.oidcProvider.findMany({
    orderBy: [{ created_at: 'asc' }, { slug: 'asc' }],
  });
  return rows.map(toProviderDto);
}

export async function createOidcProvider(
  db: Db,
  adminId: string,
  encryptionKey: Buffer,
  input: {
    slug: string;
    name: string;
    issuer_url: string;
    client_id: string;
    client_secret: string;
    scopes?: string;
    enabled?: boolean;
  },
): Promise<OidcProviderDto> {
  await requireInstanceAdmin(db, adminId);
  const slug = input.slug.toLowerCase();
  const sealed = seal(encryptionKey, input.client_secret);
  try {
    const created = await db.oidcProvider.create({
      data: {
        id: newId('oau'),
        slug,
        name: input.name,
        issuer_url: input.issuer_url.replace(/\/+$/u, ''),
        client_id: input.client_id,
        client_secret_enc: sealed,
        scopes: input.scopes ?? 'openid profile email',
        enabled: input.enabled ?? false,
      },
    });
    return toProviderDto(created);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError('conflict', {
        message: 'An OIDC provider with that slug already exists.',
        hint: 'Choose a different slug or update the existing provider.',
      });
    }
    throw error;
  }
}

export async function updateOidcProvider(
  db: Db,
  adminId: string,
  encryptionKey: Buffer,
  slug: string,
  input: {
    name?: string;
    issuer_url?: string;
    client_id?: string;
    client_secret?: string;
    scopes?: string;
    enabled?: boolean;
  },
): Promise<OidcProviderDto> {
  await requireInstanceAdmin(db, adminId);
  const normalized = slug.toLowerCase();
  const existing = await db.oidcProvider.findUnique({ where: { slug: normalized } });
  if (!existing) {
    throw new AppError('not_found', { message: 'OIDC provider not found.', hint: null });
  }
  const updated = await db.oidcProvider.update({
    where: { slug: normalized },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.issuer_url === undefined
        ? {}
        : { issuer_url: input.issuer_url.replace(/\/+$/u, '') }),
      ...(input.client_id === undefined ? {} : { client_id: input.client_id }),
      ...(input.client_secret === undefined
        ? {}
        : { client_secret_enc: seal(encryptionKey, input.client_secret) }),
      ...(input.scopes === undefined ? {} : { scopes: input.scopes }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    },
  });
  return toProviderDto(updated);
}

export async function deleteOidcProvider(db: Db, adminId: string, slug: string): Promise<void> {
  await requireInstanceAdmin(db, adminId);
  const deleted = await db.oidcProvider.deleteMany({ where: { slug: slug.toLowerCase() } });
  if (deleted.count === 0) {
    throw new AppError('not_found', { message: 'OIDC provider not found.', hint: null });
  }
}

export async function discoverOidc(
  issuerUrl: string,
): Promise<{ ok: true; doc: OidcDiscovery } | { ok: false; error: string }> {
  const wellKnown = `${issuerUrl.replace(/\/+$/u, '')}/.well-known/openid-configuration`;
  try {
    const response = await fetch(wellKnown, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return {
        ok: false,
        error: `Discovery endpoint ${wellKnown} returned HTTP ${response.status}.`,
      };
    }
    const raw = (await response.json()) as Record<string, unknown>;
    const issuer = typeof raw.issuer === 'string' ? raw.issuer : issuerUrl;
    const authorizationEndpoint =
      typeof raw.authorization_endpoint === 'string' ? raw.authorization_endpoint : '';
    const tokenEndpoint = typeof raw.token_endpoint === 'string' ? raw.token_endpoint : '';
    const userinfoEndpoint =
      typeof raw.userinfo_endpoint === 'string' ? raw.userinfo_endpoint : undefined;

    if (!authorizationEndpoint || !tokenEndpoint) {
      return {
        ok: false,
        error:
          'Discovery document is missing required authorization_endpoint or token_endpoint fields.',
      };
    }
    return {
      ok: true,
      doc: {
        issuer,
        authorization_endpoint: authorizationEndpoint,
        token_endpoint: tokenEndpoint,
        ...(userinfoEndpoint ? { userinfo_endpoint: userinfoEndpoint } : {}),
      },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `Could not reach discovery endpoint ${wellKnown}: ${detail}`,
    };
  }
}

export async function testOidcProvider(
  db: Db,
  adminId: string,
  slug: string,
): Promise<OidcTestResult> {
  await requireInstanceAdmin(db, adminId);
  const provider = await db.oidcProvider.findUnique({ where: { slug: slug.toLowerCase() } });
  if (!provider) {
    throw new AppError('not_found', { message: 'OIDC provider not found.', hint: null });
  }
  const result = await discoverOidc(provider.issuer_url);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return {
    ok: true,
    issuer: result.doc.issuer,
    authorization_endpoint: result.doc.authorization_endpoint,
    token_endpoint: result.doc.token_endpoint,
  };
}

export function generatePkce(): {
  state: string;
  nonce: string;
  codeVerifier: string;
  codeChallenge: string;
} {
  const state = randomBytes(24).toString('base64url');
  const nonce = randomBytes(24).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { state, nonce, codeVerifier, codeChallenge };
}

export async function buildAuthorizeRedirect(
  db: Db,
  input: {
    slug: string;
    redirectUri: string;
    mode: 'login' | 'link';
    userId?: string;
  },
): Promise<{ authorizeUrl: string; cookiePayload: OidcStateCookie }> {
  const provider = await db.oidcProvider.findUnique({ where: { slug: input.slug.toLowerCase() } });
  if (!provider || !provider.enabled) {
    throw new AppError('not_found', {
      message: 'OIDC provider is not enabled.',
      hint: null,
    });
  }
  const discovered = await discoverOidc(provider.issuer_url);
  if (!discovered.ok) {
    throw new AppError('service_unavailable', {
      message: discovered.error,
      hint: 'Check the provider discovery URL or sign in with your local password.',
    });
  }
  const { state, nonce, codeVerifier, codeChallenge } = generatePkce();
  const url = new URL(discovered.doc.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', provider.client_id);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', provider.scopes);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return {
    authorizeUrl: url.toString(),
    cookiePayload: {
      state,
      nonce,
      code_verifier: codeVerifier,
      provider: provider.slug,
      mode: input.mode,
      ...(input.userId ? { user_id: input.userId } : {}),
    },
  };
}

type OidcClaims = {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  preferredUsername: string | null;
  nonce: string | null;
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function exchangeCodeForClaims(input: {
  discovery: OidcDiscovery;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  expectedNonce: string;
}): Promise<OidcClaims> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code_verifier: input.codeVerifier,
  });

  const tokenRes = await fetch(input.discovery.token_endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(5_000),
  }).catch((error: unknown) => {
    throw new AppError('service_unavailable', {
      message: `OIDC token exchange failed: ${error instanceof Error ? error.message : String(error)}`,
      hint: 'Sign in with your local password or check the provider configuration.',
    });
  });

  if (!tokenRes.ok) {
    throw new AppError('service_unavailable', {
      message: `OIDC token endpoint answered HTTP ${tokenRes.status}.`,
      hint: 'Verify the client ID, client secret and redirect URI on the provider.',
    });
  }

  const tokens = (await tokenRes.json()) as {
    id_token?: unknown;
    access_token?: unknown;
  };
  let claims: Record<string, unknown> = {};
  if (typeof tokens.id_token === 'string') {
    const decoded = decodeJwtPayload(tokens.id_token);
    if (decoded) claims = { ...decoded };
  }

  if (
    typeof claims.nonce === 'string' &&
    claims.nonce.length > 0 &&
    claims.nonce !== input.expectedNonce
  ) {
    throw new AppError('unauthenticated', {
      message: 'OIDC nonce mismatch.',
      hint: 'Start the sign-in flow again.',
    });
  }

  if (
    (!claims.sub || !claims.email) &&
    input.discovery.userinfo_endpoint &&
    typeof tokens.access_token === 'string'
  ) {
    const userinfoRes = await fetch(input.discovery.userinfo_endpoint, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(5_000),
    }).catch(() => null);
    if (userinfoRes?.ok) {
      const info = (await userinfoRes.json()) as Record<string, unknown>;
      claims = { ...info, ...claims };
    }
  }

  const sub = typeof claims.sub === 'string' ? claims.sub.trim() : '';
  if (!sub) {
    throw new AppError('unauthenticated', {
      message: 'OIDC provider did not return a subject identifier (sub).',
      hint: null,
    });
  }
  const email =
    typeof claims.email === 'string' && claims.email.includes('@')
      ? claims.email.trim().toLowerCase()
      : null;

  return {
    sub,
    email,
    emailVerified: claims.email_verified === true,
    name: typeof claims.name === 'string' ? claims.name.trim().slice(0, 80) : null,
    preferredUsername:
      typeof claims.preferred_username === 'string' ? claims.preferred_username.trim() : null,
    nonce: typeof claims.nonce === 'string' ? claims.nonce : null,
  };
}

function sanitizeUsernameSeed(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  if (cleaned.length < 3 || isReserved(cleaned)) {
    return `user-${randomBytes(3).toString('hex')}`;
  }
  return cleaned;
}

async function allocateUniqueUsername(db: Db, seed: string): Promise<string> {
  const base = sanitizeUsernameSeed(seed);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base.slice(0, 24)}-${attempt + 1}`;
    const taken = await db.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  return `user-${randomBytes(6).toString('hex')}`;
}

export type OidcCallbackOutcome =
  | { kind: 'linked'; userId: string }
  | { kind: 'logged_in'; userId: string; session: IssuedSession }
  | { kind: 'link_required'; email: string };

export async function handleOidcCallback(
  db: Db,
  env: Env,
  secrets: { encryptionKey: Buffer; tokenPepper: string },
  input: {
    slug: string;
    code: string;
    redirectUri: string;
    cookie: OidcStateCookie;
    currentUserId: string | null;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<OidcCallbackOutcome> {
  const provider = await db.oidcProvider.findUnique({ where: { slug: input.slug.toLowerCase() } });
  if (!provider || !provider.enabled) {
    throw new AppError('not_found', { message: 'OIDC provider is not enabled.', hint: null });
  }
  const discovered = await discoverOidc(provider.issuer_url);
  if (!discovered.ok) {
    throw new AppError('service_unavailable', {
      message: discovered.error,
      hint: 'Sign in with your local password or retry later.',
    });
  }
  const clientSecret = open(secrets.encryptionKey, provider.client_secret_enc);
  const claims = await exchangeCodeForClaims({
    discovery: discovered.doc,
    clientId: provider.client_id,
    clientSecret,
    code: input.code,
    redirectUri: input.redirectUri,
    codeVerifier: input.cookie.code_verifier,
    expectedNonce: input.cookie.nonce,
  });

  if (input.cookie.mode === 'link') {
    if (!input.currentUserId || input.currentUserId !== input.cookie.user_id) {
      throw new AppError('unauthenticated', {
        message: 'Sign in locally before linking an OIDC provider.',
        hint: null,
      });
    }
    const existingLink = await db.oAuthAccount.findUnique({
      where: {
        provider_provider_account_id: {
          provider: provider.slug,
          provider_account_id: claims.sub,
        },
      },
    });
    if (existingLink && existingLink.user_id !== input.currentUserId) {
      throw new AppError('conflict', {
        message: 'That external identity is already linked to another account.',
        hint: null,
      });
    }
    if (!existingLink) {
      await db.$transaction(async (tx) => {
        await tx.oAuthAccount.create({
          data: {
            id: newId('oau'),
            user_id: input.currentUserId as string,
            provider: provider.slug,
            provider_account_id: claims.sub,
          },
        });
        await recordEvent(tx, {
          boardId: null,
          actor: { kind: 'user', userId: input.currentUserId as string },
          type: 'security.oidc_linked',
          payload: { provider: provider.slug },
        });
      });
    }
    return { kind: 'linked', userId: input.currentUserId };
  }

  // Login mode: look up by stable (provider, provider_account_id) first.
  const linked = await db.oAuthAccount.findUnique({
    where: {
      provider_provider_account_id: {
        provider: provider.slug,
        provider_account_id: claims.sub,
      },
    },
    include: { user: true },
  });

  if (linked) {
    const ban = await db.ban.findFirst({
      where: {
        subject: linked.user_id,
        subject_kind: 'user',
        OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
      },
      select: { id: true },
    });
    if (ban) throw new AppError('banned');

    const session = await issueSession(db, {
      userId: linked.user_id,
      pepper: secrets.tokenPepper,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    await db.$transaction(async (tx) => {
      await recordEvent(tx, {
        boardId: null,
        actor: { kind: 'user', userId: linked.user_id },
        type: 'security.login',
        payload: { method: 'oidc', provider: provider.slug },
      });
    });
    return { kind: 'logged_in', userId: linked.user_id, session };
  }

  // D-14: NEVER auto-link an existing local account by email.
  if (claims.email) {
    const sameEmail = await db.user.findUnique({
      where: { email: claims.email },
      select: { id: true },
    });
    if (sameEmail) {
      return { kind: 'link_required', email: claims.email };
    }
  }

  if (!(await registrationOpen(db, env))) {
    throw new AppError('registration_closed', {
      hint: 'Ask the instance admin to open registration.',
    });
  }

  const email = claims.email ?? `${provider.slug}-${randomBytes(6).toString('hex')}@oidc.local`;
  const usernameSeed = claims.preferredUsername ?? claims.email?.split('@')[0] ?? claims.sub;
  const username = await allocateUniqueUsername(db, usernameSeed);
  const randomSecretPassword = randomBytes(32).toString('base64url');
  const passwordHash = await hashPassword(randomSecretPassword);

  const created = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('klui:signup'))`;
    const count = await tx.user.count();
    const user = await tx.user.create({
      data: {
        id: newId('usr'),
        email,
        username,
        display_name: claims.name,
        password_hash: passwordHash,
        is_instance_admin: count === 0,
        email_verified_at: claims.emailVerified ? new Date() : null,
      },
    });
    await tx.oAuthAccount.create({
      data: {
        id: newId('oau'),
        user_id: user.id,
        provider: provider.slug,
        provider_account_id: claims.sub,
      },
    });
    await recordEvent(tx, {
      boardId: null,
      actor: { kind: 'user', userId: user.id },
      type: 'security.login',
      payload: { method: 'oidc', provider: provider.slug, action: 'signup' },
    });
    return user;
  });

  const session = await issueSession(db, {
    userId: created.id,
    pepper: secrets.tokenPepper,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { kind: 'logged_in', userId: created.id, session };
}

export async function listLinkedOidcAccounts(
  db: Db,
  userId: string,
): Promise<LinkedOidcAccountDto[]> {
  const rows = await db.oAuthAccount.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'asc' },
  });
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    provider_account_id: row.provider_account_id,
    created_at: row.created_at.toISOString(),
  }));
}

export async function unlinkOidcAccount(db: Db, userId: string, provider: string): Promise<void> {
  const normalized = provider.toLowerCase();
  await db.$transaction(async (tx) => {
    const deleted = await tx.oAuthAccount.deleteMany({
      where: { user_id: userId, provider: normalized },
    });
    if (deleted.count === 0) {
      throw new AppError('not_found', { message: 'No linked OIDC account for that provider.' });
    }
    await recordEvent(tx, {
      boardId: null,
      actor: { kind: 'user', userId },
      type: 'security.oidc_unlinked',
      payload: { provider: normalized },
    });
  });
}
