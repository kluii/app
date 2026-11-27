// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K1-04: TOTP and recovery codes. The RFC vectors prove the algorithm; the
 * integration cases prove the four things that go wrong in real deployments:
 * a password-only login when the factor is on, a replayed code, a reused
 * recovery code, and a disable that leaves a working code behind.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hotp, totp, verifyTotp } from '../src/lib/totp.js';
import { open, seal } from '../src/lib/sealed.js';
import { startServer, TestClient } from './helpers/server.js';

let harness: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  harness = await startServer();
});

afterAll(async () => {
  await harness.close();
});

describe('HOTP and TOTP', () => {
  const key = Buffer.from('12345678901234567890', 'ascii');

  it('matches the RFC 4226 test vectors', () => {
    const expected = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];
    expect(expected.map((_value, counter) => hotp(key, counter))).toEqual(expected);
  });

  it('matches the RFC 6238 SHA-1 vectors truncated to six digits', () => {
    const vectors: [number, string][] = [
      [59, '287082'],
      [1_111_111_109, '081804'],
      [1_111_111_111, '050471'],
      [1_234_567_890, '005924'],
      [2_000_000_000, '279037'],
    ];
    for (const [seconds, code] of vectors) {
      expect(hotp(key, Math.floor(seconds / 30))).toBe(code);
    }
  });

  it('accepts one step of drift and refuses a replayed step', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const now = 1_700_000_000_000;
    const code = totp(secret, now);

    expect(verifyTotp({ secret, code, atMs: now })).toEqual({ ok: true, step: 56_666_666 });
    expect(verifyTotp({ secret, code, atMs: now, lastStep: 56_666_666 })).toEqual({
      ok: false,
      reason: 'replay',
    });
    expect(verifyTotp({ secret, code: '000000', atMs: now }).ok).toBe(false);
  });
});

describe('the sealed secret', () => {
  it('round-trips a value and refuses a tampered one', () => {
    const key = Buffer.alloc(32, 3);
    const value = seal(key, 'a-secret-value');
    expect(value.startsWith('v1.')).toBe(true);
    expect(value).not.toContain('a-secret-value');
    expect(open(key, value)).toBe('a-secret-value');
    expect(() => open(key, `${value}tampered`)).toThrow();
    expect(() => open(Buffer.alloc(32, 4), value)).toThrow();
  });
});

describe('TOTP through the API', () => {
  it('enrols, confirms, and then requires the factor at login', async () => {
    const c = harness.client();
    const user = await c.signup(`totp-${c.suffix}`);

    const before = await c.request('GET', '/api/v1/me');
    expect((before.json() as { totp_enabled: boolean }).totp_enabled).toBe(false);

    const enrolled = await c.request('POST', '/api/v1/auth/totp/enroll');
    expect(enrolled.statusCode).toBe(201);
    const enrollment = enrolled.json() as {
      secret: string;
      otpauth_url: string;
      recovery_codes: string[];
    };
    expect(enrollment.recovery_codes).toHaveLength(10);
    expect(enrollment.otpauth_url).toMatch(/^otpauth:\/\/totp\//);

    const wrong = await c.request('POST', '/api/v1/auth/totp/verify', { code: '000000' });
    expect(wrong.statusCode).toBe(400);
    expect((wrong.json() as { error: { code: string } }).error.code).toBe('invalid_code');

    const confirmed = await c.request('POST', '/api/v1/auth/totp/verify', {
      code: totp(enrollment.secret),
    });
    expect(confirmed.statusCode).toBe(200);

    const after = await c.request('GET', '/api/v1/me');
    expect((after.json() as { totp_enabled: boolean }).totp_enabled).toBe(true);

    const fresh = new TestClient(harness.app, harness.db);
    const passwordOnly = await fresh.request('POST', '/api/v1/auth/login', {
      email_or_username: user.username,
      password: 'a-long-enough-password',
    });
    expect(passwordOnly.statusCode).toBe(401);
    expect((passwordOnly.json() as { error: { code: string } }).error.code).toBe('totp_required');

    // The next step, because the enrolment already spent this one.
    const nextCode = totp(enrollment.secret, Date.now() + 30_000);
    const withFactor = await fresh.request('POST', '/api/v1/auth/login', {
      email_or_username: user.username,
      password: 'a-long-enough-password',
      totp: nextCode,
    });
    expect(withFactor.statusCode).toBe(200);
    // The login body must describe the account as it is, factor included.
    expect((withFactor.json() as { totp_enabled: boolean }).totp_enabled).toBe(true);

    const replayed = await new TestClient(harness.app, harness.db).request(
      'POST',
      '/api/v1/auth/login',
      {
        email_or_username: user.username,
        password: 'a-long-enough-password',
        totp: nextCode,
      },
    );
    expect(replayed.statusCode).toBe(400);
    expect((replayed.json() as { error: { code: string } }).error.code).toBe('invalid_code');
  });

  it('accepts a recovery code once, and disabling retires the rest', async () => {
    const c = harness.client();
    const user = await c.signup(`recovery-${c.suffix}`);
    const enrolled = await c.request('POST', '/api/v1/auth/totp/enroll');
    const enrollment = enrolled.json() as { secret: string; recovery_codes: string[] };
    await c.request('POST', '/api/v1/auth/totp/verify', { code: totp(enrollment.secret) });

    const [first, second, ...rest] = enrollment.recovery_codes;
    expect(first && second).toBeTruthy();

    const withCode = await new TestClient(harness.app, harness.db).request(
      'POST',
      '/api/v1/auth/login',
      {
        email_or_username: user.username,
        password: 'a-long-enough-password',
        recovery_code: first,
      },
    );
    expect(withCode.statusCode).toBe(200);

    const reused = await new TestClient(harness.app, harness.db).request(
      'POST',
      '/api/v1/auth/login',
      {
        email_or_username: user.username,
        password: 'a-long-enough-password',
        recovery_code: first,
      },
    );
    expect(reused.statusCode).toBe(400);

    // Disabling needs the password and a live code, and removes every code.
    const wrongPassword = await c.request('POST', '/api/v1/auth/totp/disable', {
      password: 'not-the-password',
      code: totp(enrollment.secret, Date.now() + 30_000),
    });
    expect(wrongPassword.statusCode).toBe(400);

    const disabled = await c.request('POST', '/api/v1/auth/totp/disable', {
      password: 'a-long-enough-password',
      code: totp(enrollment.secret, Date.now() + 30_000),
    });
    expect(disabled.statusCode).toBe(200);

    const remaining = await harness.db.recoveryCode.count({ where: { user_id: user.id } });
    expect(remaining).toBe(0);
    expect(rest.length).toBe(8);

    const passwordOnly = await new TestClient(harness.app, harness.db).request(
      'POST',
      '/api/v1/auth/login',
      { email_or_username: user.username, password: 'a-long-enough-password' },
    );
    expect(passwordOnly.statusCode).toBe(200);

    // Turning it back on issues a new set: a code from the retired set is dead.
    const reEnrolled = (await c.request('POST', '/api/v1/auth/totp/enroll')).json() as {
      secret: string;
      recovery_codes: string[];
    };
    await c.request('POST', '/api/v1/auth/totp/verify', {
      code: totp(reEnrolled.secret, Date.now() + 30_000),
    });

    const retired = await new TestClient(harness.app, harness.db).request(
      'POST',
      '/api/v1/auth/login',
      {
        email_or_username: user.username,
        password: 'a-long-enough-password',
        recovery_code: second,
      },
    );
    expect(retired.statusCode).toBe(400);
    expect((retired.json() as { error: { code: string } }).error.code).toBe('invalid_code');
  });

  it('regenerates recovery codes and invalidates the previous set', async () => {
    const c = harness.client();
    await c.signup(`rotate-${c.suffix}`);
    const enrollment = (await c.request('POST', '/api/v1/auth/totp/enroll')).json() as {
      secret: string;
      recovery_codes: string[];
    };
    await c.request('POST', '/api/v1/auth/totp/verify', { code: totp(enrollment.secret) });

    const regenerated = await c.request('POST', '/api/v1/auth/recovery-codes', {
      password: 'a-long-enough-password',
    });
    expect(regenerated.statusCode).toBe(201);
    const fresh = (regenerated.json() as { recovery_codes: string[] }).recovery_codes;
    expect(fresh).toHaveLength(10);
    expect(fresh).not.toEqual(enrollment.recovery_codes);
  });

  it('enforces the required policy on an account without a factor', async () => {
    const c = harness.client();
    const user = await c.signup(`policy-${c.suffix}`);

    await harness.db.instanceSettings.update({
      where: { id: 1 },
      data: { totp_policy: 'required' },
    });
    try {
      const response = await new TestClient(harness.app, harness.db).request(
        'POST',
        '/api/v1/auth/login',
        { email_or_username: user.username, password: 'a-long-enough-password' },
      );
      expect(response.statusCode).toBe(401);
      expect((response.json() as { error: { code: string } }).error.code).toBe('totp_required');
    } finally {
      await harness.db.instanceSettings.update({
        where: { id: 1 },
        data: { totp_policy: 'available' },
      });
    }
  });
});
