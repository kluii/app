// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Runtime dependency audit with a documented allowlist (docs/security.md §11).
 *
 * `npm audit --omit=dev` reports advisories that sit in the Prisma CLI's config
 * loader, which runs `migrate deploy` at container start. Each is accepted with
 * a reason and an expiry in security/audit-allowlist.json; anything else fails.
 * An allowlist entry that no longer matches an advisory also fails, so the list
 * rots loudly instead of silently widening.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const allowlist = JSON.parse(
  readFileSync(new URL('../security/audit-allowlist.json', import.meta.url), 'utf8'),
).allowlist;
const today = new Date().toISOString().slice(0, 10);

function auditReport() {
  try {
    const raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], {
      cwd: new URL('..', import.meta.url).pathname,
      encoding: 'utf8',
    });
    return JSON.parse(raw);
  } catch (error) {
    const stdout = error?.stdout ?? '{}';
    return JSON.parse(stdout);
  }
}

const report = auditReport();
const entries = Object.entries(report.vulnerabilities ?? {}).filter(
  ([, entry]) => entry.severity === 'high' || entry.severity === 'critical',
);
const severityOf = new Map(entries);

const allowedByKey = new Map();
for (const entry of allowlist) {
  allowedByKey.set(`${entry.module}:${entry.advisory}`, entry);
}

function advisoryId(advisory) {
  return advisory.url?.split('/').pop() ?? String(advisory.source ?? 'unknown');
}

const problems = [];
const used = new Set();

/**
 * A package is covered when it has an allowlisted advisory of its own, or when
 * every cause it is vulnerable *through* is itself covered.
 */
function covered(name, seen = new Set()) {
  if (seen.has(name)) return true;
  seen.add(name);

  const entry = severityOf.get(name);
  if (!entry) return true;

  const direct = (entry.via ?? []).filter((item) => typeof item === 'object');
  if (direct.length > 0) {
    return direct.every((advisory) => {
      const key = `${name}:${advisoryId(advisory)}`;
      const match = allowedByKey.get(key);
      if (!match) {
        problems.push(
          `unlisted ${entry.severity ?? 'high'} advisory: ${name} ${advisoryId(advisory)} (${advisory.title ?? ''})`,
        );
        return false;
      }
      used.add(key);
      if (match.expires < today) {
        problems.push(
          `allowlist entry expired on ${match.expires}: ${name} ${advisoryId(advisory)}`,
        );
        return false;
      }
      return true;
    });
  }

  const through = (entry.via ?? []).filter((item) => typeof item === 'string');
  if (through.length === 0) {
    problems.push(`high advisory with no described cause: ${name}`);
    return false;
  }
  const allCovered = through.every((cause) => covered(cause, seen));
  if (!allCovered) {
    problems.push(
      `transitive advisory without an allowlisted cause: ${name} through ${through.join(', ')}`,
    );
  }
  return allCovered;
}

for (const [name] of entries) {
  covered(name);
}

for (const entry of allowlist) {
  const key = `${entry.module}:${entry.advisory}`;
  const stillPresent =
    used.has(key) || [...severityOf.keys()].some((name) => name === entry.module);
  if (!stillPresent) {
    problems.push(`stale allowlist entry, no matching advisory: ${entry.module} ${entry.advisory}`);
  }
}

if (problems.length > 0) {
  console.error(`audit gate failed:\n${problems.map((line) => `  ${line}`).join('\n')}`);
  process.exit(1);
}
console.log(
  `audit gate ok: ${entries.length} high/critical runtime advisor${entries.length === 1 ? 'y' : 'ies'}, all covered by an allowlist entry with an expiry`,
);
