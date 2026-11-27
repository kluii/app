// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Second factors (docs/features/auth.md §5). The secret is sealed with the
 * instance key because the server must read it back; recovery codes are
 * argon2id-hashed because they are only ever compared, and shown exactly once.
 */
import type { Db } from '../db.js';
import { AppError } from '../lib/errors.js';
import { newId, opaqueToken } from '../lib/ids.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { open, seal } from '../lib/sealed.js';
import { generateTotpSecret, otpauthUrl, totp, verifyTotp } from '../lib/totp.js';
import { recordEvent } from '../lib/events.js';
import type { Env } from '../env.js';

export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 20;

export type TotpPolicy = Env['KLUI_TOTP_POLICY'];

type TotpUser = { id: string; username: string; email: string };

export type Enrollment = { secret: string; otpauth_url: string; recovery_codes: string[] };

/** A code with its grouping dashes, for a human copying it off the screen. */
function formatRecoveryCode(raw: string): string {
  return raw.match(/.{5}/g)?.join('-') ?? raw;
}

function normaliseRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

async function issueRecoveryCodes(tx: Pick<Db, 'recoveryCode'>, userId: string): Promise<string[]> {
  await tx.recoveryCode.deleteMany({ where: { user_id: userId } });
  const codes: string[] = [];
  for (let index = 0; index < RECOVERY_CODE_COUNT; index += 1) {
    const raw = opaqueToken(RECOVERY_CODE_LENGTH).toUpperCase();
    codes.push(raw);
    await tx.recoveryCode.create({
      data: { id: newId('rcv'), user_id: userId, code_hash: await hashPassword(raw) },
    });
  }
  return codes.map(formatRecoveryCode);
}

export async function enroll(
  db: Db,
  secrets: { encryptionKey: Buffer },
  user: TotpUser,
  issuer: string,
  policy: TotpPolicy,
): Promise<Enrollment> {
  if (policy === 'disabled') {
    throw new AppError('forbidden', {
      message: 'Two-factor authentication is disabled on this instance.',
      hint: 'An instance admin can change KLUI_TOTP_POLICY.',
    });
  }

  const secret = generateTotpSecret();
  const recoveryCodes = await db.$transaction(async (tx) => {
    await tx.totpSecret.upsert({
      where: { user_id: user.id },
      create: {
        user_id: user.id,
        secret_enc: seal(secrets.encryptionKey, secret),
        confirmed_at: null,
        last_step: null,
      },
      update: {
        secret_enc: seal(secrets.encryptionKey, secret),
        confirmed_at: null,
        last_step: null,
      },
    });
    return issueRecoveryCodes(tx, user.id);
  });

  return {
    secret,
    otpauth_url: otpauthUrl({ secret, issuer, account: user.username }),
    recovery_codes: recoveryCodes,
  };
}

export async function confirmEnrollment(
  db: Db,
  secrets: { encryptionKey: Buffer },
  user: TotpUser,
  code: string,
): Promise<{ enabled: true }> {
  const row = await db.totpSecret.findUnique({ where: { user_id: user.id } });
  if (!row) throw new AppError('invalid_code', { hint: 'Start the enrolment first.' });
  if (row.confirmed_at) {
    throw new AppError('invalid_code', { hint: 'Two-factor authentication is already on.' });
  }

  const result = verifyTotp({
    secret: open(secrets.encryptionKey, row.secret_enc),
    code,
    lastStep: row.last_step,
  });
  if (!result.ok) throw new AppError('invalid_code');

  await db.$transaction(async (tx) => {
    await tx.totpSecret.update({
      where: { user_id: user.id },
      data: { confirmed_at: new Date(), last_step: result.step },
    });
    await recordEvent(tx, {
      boardId: null,
      actor: { kind: 'user', userId: user.id },
      type: 'security.totp_enabled',
      payload: {},
    });
  });
  return { enabled: true };
}

export async function disable(
  db: Db,
  secrets: { encryptionKey: Buffer },
  user: TotpUser,
  input: { password: string; code: string },
): Promise<{ enabled: false }> {
  const row = await db.totpSecret.findUnique({ where: { user_id: user.id } });
  const account = await db.user.findUnique({ where: { id: user.id } });
  const passwordOk = account ? await verifyPassword(account.password_hash, input.password) : false;
  if (!row || !row.confirmed_at || !passwordOk) {
    throw new AppError('invalid_code', {
      hint: 'The password and the current code must both be right.',
    });
  }

  const result = verifyTotp({
    secret: open(secrets.encryptionKey, row.secret_enc),
    code: input.code,
    lastStep: row.last_step,
  });
  if (!result.ok) throw new AppError('invalid_code');

  await db.$transaction(async (tx) => {
    await tx.totpSecret.delete({ where: { user_id: user.id } });
    // A recovery code is a way *in*; disabling the factor retires the set,
    // otherwise an old code survives a decision to turn the factor off.
    await tx.recoveryCode.deleteMany({ where: { user_id: user.id } });
    await recordEvent(tx, {
      boardId: null,
      actor: { kind: 'user', userId: user.id },
      type: 'security.totp_disabled',
      payload: {},
    });
  });
  return { enabled: false };
}

export async function regenerateRecoveryCodes(
  db: Db,
  user: TotpUser,
  password: string,
): Promise<{ recovery_codes: string[] }> {
  const account = await db.user.findUnique({ where: { id: user.id } });
  const ok = account ? await verifyPassword(account.password_hash, password) : false;
  if (!ok)
    throw new AppError('unauthenticated', { message: 'The password is incorrect.', hint: null });

  const row = await db.totpSecret.findUnique({ where: { user_id: user.id } });
  if (!row?.confirmed_at) {
    throw new AppError('invalid_code', { hint: 'Turn two-factor authentication on first.' });
  }

  const codes = await db.$transaction(async (tx) => issueRecoveryCodes(tx, user.id));
  return { recovery_codes: codes };
}

async function consumeRecoveryCode(db: Db, userId: string, submitted: string): Promise<boolean> {
  const candidate = normaliseRecoveryCode(submitted);
  if (candidate.length !== RECOVERY_CODE_LENGTH) return false;
  const rows = await db.recoveryCode.findMany({ where: { user_id: userId, used_at: null } });
  for (const row of rows) {
    if (await verifyPassword(row.code_hash, candidate)) {
      await db.recoveryCode.update({ where: { id: row.id }, data: { used_at: new Date() } });
      return true;
    }
  }
  return false;
}

export type SecondFactorOutcome = { method: 'totp' | 'recovery_code' } | { method: null };

/**
 * Called by `login` once the password matched. `totp_required` is the only
 * answer when a factor is required and absent: it names no account and no
 * state beyond the instance policy.
 */
export async function checkSecondFactor(
  db: Db,
  secrets: { encryptionKey: Buffer },
  user: { id: string },
  input: { totp?: string; recovery_code?: string },
  policy: TotpPolicy,
): Promise<SecondFactorOutcome> {
  const row = await db.totpSecret.findUnique({ where: { user_id: user.id } });
  const enrolled = Boolean(row?.confirmed_at);

  if (!enrolled) {
    if (policy === 'required') {
      throw new AppError('totp_required', {
        message: 'This instance requires two-factor authentication.',
        hint: 'Enrol an authenticator app, then sign in again.',
      });
    }
    return { method: null };
  }
  if (!row) return { method: null };

  if (input.recovery_code) {
    if (await consumeRecoveryCode(db, user.id, input.recovery_code)) {
      return { method: 'recovery_code' };
    }
    throw new AppError('invalid_code', { hint: 'A recovery code works once.' });
  }

  if (!input.totp) {
    throw new AppError('totp_required', {
      message: 'This account has two-factor authentication on.',
      hint: 'Send the six-digit code from the authenticator app as `totp`.',
    });
  }

  const result = verifyTotp({
    secret: open(secrets.encryptionKey, row.secret_enc),
    code: input.totp,
    lastStep: row.last_step,
  });
  if (!result.ok) throw new AppError('invalid_code');
  await db.totpSecret.update({ where: { user_id: user.id }, data: { last_step: result.step } });
  return { method: 'totp' };
}

/** The instance policy, from the settings row the boot created, else the env default. */
export async function totpPolicy(db: Db, env: Env): Promise<TotpPolicy> {
  const settings = await db.instanceSettings.findUnique({ where: { id: 1 } });
  return settings?.totp_policy ?? env.KLUI_TOTP_POLICY;
}

/** A secret and a code in one assertion, used by the tests to drive the flow. */
export function currentCode(secret: string): string {
  return totp(secret);
}
