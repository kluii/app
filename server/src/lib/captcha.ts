// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Cap verification (D-46): a bot filter, off by default, never a security
 * control. It runs only past the anonymous-write threshold and it replaces
 * none of the buckets in anon/limits.ts.
 *
 * The contract with a Cap instance is deliberately the small one: `POST
 * {url}/siteverify` with `{"token": …}` and, when a key is configured, an
 * `Authorization: Bearer` header; the answer is `{"success": true}`. Everything
 * else — a timeout, a 500, a body that is not JSON — is "cannot verify", which
 * fails closed with 503 rather than silently letting the write through.
 */
export type CaptchaCheck =
  { ok: true } | { ok: false; reason: 'rejected' } | { ok: false; reason: 'unavailable' };

const TIMEOUT_MS = 5000;

export async function verifyCap(input: {
  url: string;
  secret: string | null;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<CaptchaCheck> {
  const send = input.fetchImpl ?? fetch;
  const endpoint = `${input.url.replace(/\/+$/, '')}/siteverify`;
  try {
    const response = await send(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(input.secret === null ? {} : { authorization: `Bearer ${input.secret}` }),
      },
      body: JSON.stringify({ token: input.token }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: 'unavailable' };
    const body = (await response.json()) as { success?: unknown };
    return body.success === true ? { ok: true } : { ok: false, reason: 'rejected' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
