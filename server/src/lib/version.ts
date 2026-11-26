// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';

type PackageJson = { version?: string };

/**
 * The version reported by /healthz comes from the package.json of the running
 * build (D-42). A version bump is the only honest deploy proof.
 */
export function readVersion(): string {
  try {
    const url = new URL('../../package.json', import.meta.url);
    const parsed = JSON.parse(readFileSync(url, 'utf8')) as PackageJson;
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
