// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { atUsername } from '../src/lib/username';

/**
 * A username is an identity and is printed the way people write it (brief, "a
 * username carries its at sign"). One implementation, so `/will` and `@will`
 * cannot both appear on the same screen; a display name never takes the sign,
 * which is why nothing here touches one.
 */
describe('a username on screen', () => {
  it('carries one at sign', () => {
    expect(atUsername('will')).toBe('@will');
    expect(atUsername('will-2f9')).toBe('@will-2f9');
  });

  it('never carries two, even if the value already has one', () => {
    expect(atUsername('@will')).toBe('@will');
  });

  it('leaves the rest of the string alone', () => {
    expect(atUsername('a.b_c-1')).toBe('@a.b_c-1');
    expect(atUsername('')).toBe('@');
  });
});
