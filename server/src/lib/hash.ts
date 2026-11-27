// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';

/** sha256 with the instance pepper: every opaque token is stored hashed (D-33). */
export function hashToken(raw: string, pepper: string): string {
  return createHmac('sha256', pepper).update(raw, 'utf8').digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return nodeTimingSafeEqual(left, right);
}
