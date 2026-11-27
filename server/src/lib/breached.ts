// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The passwords that actually appear at the top of every breach corpus, plus
 * the shapes an attacker tries first. A full HIBP corpus is an operational
 * input (km-anonymity range query), deliberately not shipped: no clear password
 * may leave the instance, and a 600 MB list is not a container dependency.
 */
const COMMON = [
  '123456789012',
  'password1234',
  'qwertyuiop12',
  'letmein12345',
  'iloveyou1234',
  'administrator',
  'welcome12345',
  'monkey123456',
  'dragon123456',
  'football1234',
  'baseball1234',
  'superman1234',
  'trustno1trust',
  'sunshine1234',
  'princess1234',
  'azertyuiop12',
  'motdepasse12',
  'bonjour12345',
  'passwordpassword',
  'changeme1234',
  'correcthorsebatterystaple',
];

export const BREACHED_PASSWORDS: ReadonlySet<string> = new Set(COMMON);
