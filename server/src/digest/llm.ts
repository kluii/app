// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Optional LLM rewrite layer for the daily digest (K5-06, D-37,
 * docs/features/digest.md §2.5).
 *
 * The deterministic builder (`build.ts`) decides what matters. This module
 * never sees card descriptions, comments, emails or user ids: it sends ONLY
 * `{ header, sections }` (titles, details, counts) and rewrites the prose.
 *
 * - `KLUI_DIGEST_LLM_URL` unset → zero outbound requests, deterministic text.
 * - Length cap: ≤ 400 words.
 * - Timeout: 5 s, one retry on failure.
 * - Any error (network, non-2xx, invalid JSON, empty or oversized output)
 *   silently returns the deterministic digest unchanged.
 */
import type { Digest } from './build.js';

const MAX_WORDS = 400;
const TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 2;

const SYSTEM_PROMPT = [
  'You rewrite a pre-computed Klui kanban daily digest into concise plain text.',
  'Never invent cards, drop listed items, add greetings, or use emoji.',
  'Keep the output under 400 words.',
].join(' ');

export type RewriteOptions = {
  url: string | null;
  apiKey: string | null;
};

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/u).length;
}

function extractText(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as {
    text?: unknown;
    choices?: { message?: { content?: unknown }; text?: unknown }[];
  };
  const candidate =
    typeof record.choices?.[0]?.message?.content === 'string'
      ? record.choices[0].message.content
      : typeof record.choices?.[0]?.text === 'string'
        ? record.choices[0].text
        : typeof record.text === 'string'
          ? record.text
          : null;
  if (candidate === null) return null;
  const trimmed = candidate.trim();
  if (trimmed === '') return null;
  if (wordCount(trimmed) > MAX_WORDS) return null;
  // Refuse raw JSON or HTML error documents masquerading as prose.
  if (/^[<[{]/u.test(trimmed)) return null;
  return trimmed;
}

async function attemptRewrite(
  digest: Digest,
  url: string,
  apiKey: string | null,
): Promise<string | null> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey !== null && apiKey !== '') headers.authorization = `Bearer ${apiKey}`;

  // Privacy boundary: ONLY the computed header and section titles/details leave
  // the instance — never descriptions, comments, emails, or account ids.
  const payload = {
    header: digest.header,
    sections: digest.sections.map((section) => ({
      key: section.key,
      title: section.title,
      items: section.items.map((item) => ({ title: item.title, detail: item.detail })),
    })),
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const raw = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    return extractText(parsed);
  } catch {
    return null;
  }
}

export async function rewriteDigest(digest: Digest, options: RewriteOptions): Promise<Digest> {
  if (digest.empty || options.url === null) return digest;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const rewritten = await attemptRewrite(digest, options.url, options.apiKey);
    if (rewritten !== null) {
      return { ...digest, text: rewritten };
    }
  }
  return digest;
}
