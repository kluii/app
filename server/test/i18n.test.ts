// SPDX-License-Identifier: AGPL-3.0-only
/**
 * K5-07 — one catalogue rule for the whole product.
 *
 * The web has had `en`/`fr` since K2-03 and `web/test/i18n.test.ts` held those
 * two files to their parity rules. The server had English literals: the error
 * envelope, the validation hint, the reset mail, the unsubscribe page. This test
 * is the same rule applied to both packages at once — a key added to one
 * language and not the other fails here, whichever package it lives in — plus
 * the exits the roadmap names: every error code has copy, a French client reads
 * French, and an English client reads the bytes it read before.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from './helpers/server.js';
import { recordingMailer } from '../src/lib/mail.js';
import { localeOf, translate } from '../src/i18n/index.js';
import { AppError, toWire } from '../src/lib/errors.js';

const SERVER = new URL('../src/', import.meta.url).pathname;
const REPO = new URL('../../', import.meta.url).pathname;

type Catalog = Record<string, string>;

function read(path: string): Catalog {
  return JSON.parse(readFileSync(path, 'utf8')) as Catalog;
}

const PAIRS: { name: string; en: Catalog; fr: Catalog }[] = [
  {
    name: 'web',
    en: read(`${REPO}web/src/i18n/en.json`),
    fr: read(`${REPO}web/src/i18n/fr.json`),
  },
  {
    name: 'server',
    en: read(`${SERVER}i18n/en.json`),
    fr: read(`${SERVER}i18n/fr.json`),
  },
];

const placeholders = (value: string): string[] =>
  [...value.matchAll(/\{(\w+)\}/gu)].map((match) => match[1] ?? '').sort();

describe('the catalogs, in both packages', () => {
  it('are parsed, so the rules below are not checking an empty object', () => {
    for (const pair of PAIRS) {
      expect({ name: pair.name, keys: Object.keys(pair.en).length > 20 }).toEqual({
        name: pair.name,
        keys: true,
      });
    }
  });

  it('hold exactly the same keys in both languages', () => {
    for (const pair of PAIRS) {
      expect({ name: pair.name, fr: Object.keys(pair.fr).sort() }).toEqual({
        name: pair.name,
        fr: Object.keys(pair.en).sort(),
      });
    }
  });

  it('have no empty value, in either language, in either package', () => {
    const empties = PAIRS.flatMap((pair) =>
      [...Object.entries(pair.en), ...Object.entries(pair.fr)]
        .filter(([, value]) => value.trim() === '')
        .map(([key]) => `${pair.name}:${key}`),
    );
    expect(empties).toEqual([]);
  });

  it('use the same placeholders in both languages', () => {
    const mismatched = PAIRS.flatMap((pair) =>
      Object.keys(pair.en)
        .filter(
          (key) =>
            placeholders(pair.fr[key] ?? '').join() !== placeholders(pair.en[key] ?? '').join(),
        )
        .map((key) => `${pair.name}:${key}`),
    );
    expect(mismatched).toEqual([]);
  });

  it('carry no emoji', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}/u;
    const offenders = PAIRS.flatMap((pair) =>
      [...Object.entries(pair.en), ...Object.entries(pair.fr)]
        .filter(([, value]) => emoji.test(value))
        .map(([key]) => `${pair.name}:${key}`),
    );
    expect(offenders).toEqual([]);
  });

  it('give every error code a message in both languages', () => {
    // The union in `lib/errors.ts` is the list; a code added there without copy
    // would ship as `error.some_new_code` to a reader.
    const source = readFileSync(`${SERVER}lib/errors.ts`, 'utf8');
    const union = /export type ErrorCode =([\s\S]*?);/u.exec(source)?.[1] ?? '';
    const codes = [...union.matchAll(/'([a-z_]+)'/gu)].map((match) => match[1] ?? '');
    expect(codes.length).toBeGreaterThanOrEqual(30);
    const catalogEn = read(`${SERVER}i18n/en.json`);
    const catalogFr = read(`${SERVER}i18n/fr.json`);
    const missing = codes.filter(
      (code) =>
        catalogEn[`error.${code}`] === undefined || catalogFr[`error.${code}`] === undefined,
    );
    expect(missing).toEqual([]);
  });
});

describe('the request language', () => {
  it('reads the first tag the catalogue covers, and defaults to English', () => {
    expect(localeOf('fr-CH, fr;q=0.9, en;q=0.8')).toBe('fr');
    expect(localeOf('en-GB,en;q=0.9')).toBe('en');
    expect(localeOf('de-DE,de;q=0.9')).toBe('en');
    expect(localeOf(undefined)).toBe('en');
    expect(localeOf(['fr'])).toBe('fr');
  });

  it('falls back to English, then to the key, never to a blank', () => {
    expect(translate('fr', 'error.not_found')).toBe('Introuvable.');
    expect(translate('fr', 'not.a.key')).toBe('not.a.key');
    expect(translate('fr', 'mail.reset.link', { url: 'https://x/y' })).toContain('https://x/y');
  });

  it('translates the envelope, and leaves an explicit message alone', () => {
    const absent = toWire(new AppError('board_not_found'), 'req-1', 'fr');
    expect(absent.body.error).toEqual({
      code: 'board_not_found',
      message: 'Tableau introuvable.',
      hint: null,
    });
    const explicit = toWire(
      new AppError('conflict', { message: 'That username is taken.' }),
      'req-2',
      'fr',
    );
    expect(explicit.body.error.message).toBe('That username is taken.');
    // The Error's own text is the log line, and the log stays English.
    expect(new AppError('board_not_found').message).toBe('Board not found.');
  });
});

const WEB_DIR = new URL('./fixtures/web', import.meta.url).pathname;

describe('a French client', () => {
  let harness: Awaited<ReturnType<typeof startServer>>;
  const mailer = recordingMailer();

  beforeAll(async () => {
    harness = await startServer({ webDir: WEB_DIR, mail: mailer });
  });

  afterAll(async () => {
    await harness.close();
  });

  it('reads a French error message for the same failure', async () => {
    const client = harness.client();
    await client.signup(`i18n-${client.suffix}`);

    const french = await client.request('GET', '/api/v1/boards/brd_missing/state', undefined, {
      'accept-language': 'fr',
    });
    expect(french.statusCode).toBe(404);
    expect((french.json() as { error: { message: string } }).error.message).toBe(
      'Tableau introuvable.',
    );

    // No header, and an English one, both keep the bytes an existing client reads.
    const plain = await client.request('GET', '/api/v1/boards/brd_missing/state');
    expect((plain.json() as { error: { message: string } }).error.message).toBe('Board not found.');
    const english = await client.request('GET', '/api/v1/boards/brd_missing/state', undefined, {
      'accept-language': 'en-GB,en;q=0.9',
    });
    expect((english.json() as { error: { message: string } }).error.message).toBe(
      'Board not found.',
    );
  });

  it('reads the validation message and hint in French', async () => {
    const client = harness.client();
    await client.signup(`i18n-validate-${client.suffix}`);
    const bad = await client.request(
      'POST',
      '/api/v1/boards',
      { name: '' },
      { 'accept-language': 'fr' },
    );
    expect(bad.statusCode).toBe(400);
    const body = bad.json() as { error: { message: string; hint: string; details: unknown[] } };
    expect(body.error.message).toBe("Le corps de la requête n'est pas valide.");
    expect(body.error.hint).toBe('Corrigez les champs listés dans details.');
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it('receives the reset mail in French', async () => {
    const client = harness.client();
    const account = await client.signup(`i18n-mail-${client.suffix}`);
    mailer.sent.length = 0;
    const requested = await client.request(
      'POST',
      '/api/v1/auth/reset/request',
      { email: `${account.username}@example.com` },
      { 'accept-language': 'fr-FR,fr;q=0.9' },
    );
    expect(requested.statusCode).toBe(202);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.subject).toBe('Réinitialisez votre mot de passe Klui');
    expect(mailer.sent[0]?.text).toContain('Ouvrez ce lien dans les 30 minutes');
  });

  it('reads the unsubscribe page in French, with no session at all', async () => {
    const client = harness.client();
    await client.signup(`i18n-unsub-${client.suffix}`);
    const patched = await client.request('PATCH', '/api/v1/me/digest', { enabled: true });
    const unsubscribePath = (patched.json() as { unsubscribe_url: string }).unsubscribe_url;
    const page = await harness.app.inject({
      method: 'GET',
      url: unsubscribePath,
      headers: { 'accept-language': 'fr' },
    });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Vous êtes désabonné.');
    expect(page.body).toContain('lang="fr"');
  });
});
