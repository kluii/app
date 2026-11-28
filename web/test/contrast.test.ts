// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The contrast gate (DESIGN.md §2, docs/testing.md §6).
 *
 * The values are parsed from `tokens.css`, never duplicated here: a palette
 * change must travel through this test. Text tokens are measured against every
 * surface they can sit on, in both themes. Aliases (`--column: var(--surface-2)`)
 * are resolved recursively before measuring, so an alias is never read as a
 * literal.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Rgb = [number, number, number];

const CSS = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(selector);
  expect(start, `selector ${selector} missing from tokens.css`).toBeGreaterThanOrEqual(0);
  const open = CSS.indexOf('{', start);
  const close = CSS.indexOf('}', open);
  const body = CSS.slice(open + 1, close);
  const values: Record<string, string> = {};
  for (const match of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) values[name] = value.trim();
  }
  return values;
}

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((char) => char + char)
          .join('')
      : clean;
  const value = Number.parseInt(full.slice(0, 6), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Follows `var(--name)` references inside one theme block, with a depth guard. */
function resolve(value: string, tokens: Record<string, string>, depth = 0): string {
  if (depth > 8) throw new Error(`var() chain too deep while resolving "${value}"`);
  return value.replace(/var\(--([a-z0-9-]+)\)/g, (_match, name: string) => {
    const target = tokens[name];
    if (target === undefined) throw new Error(`--${name} is not defined in this theme`);
    return resolve(target, tokens, depth + 1);
  });
}

/** Resolves aliases, then parses a hex or rgb()/rgba() literal into channels. */
function toRgb(value: string, tokens: Record<string, string>): Rgb {
  const resolved = resolve(value, tokens).trim();
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(resolved);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  if (!/^#[0-9a-f]{3,8}$/i.test(resolved)) {
    throw new Error(`cannot parse "${value}" (resolved to "${resolved}")`);
  }
  return hexToRgb(resolved);
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(foreground: Rgb, background: Rgb): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return (light + 0.05) / (dark + 0.05);
}

function mix(tag: Rgb, percent: number, base: Rgb): Rgb {
  const t = percent / 100;
  return [
    Math.round(tag[0] * t + base[0] * (1 - t)),
    Math.round(tag[1] * t + base[1] * (1 - t)),
    Math.round(tag[2] * t + base[2] * (1 - t)),
  ];
}

const dark = block(':root {');
const light = block(
  CSS.includes('[data-theme="light"]') ? '[data-theme="light"] {' : "[data-theme='light'] {",
);

const SURFACES = [
  'canvas',
  'column',
  'card',
  'surface',
  'surface-2',
  'surface-muted',
  'surface-raised',
] as const;
const TEXT_TOKENS = ['ink', 'ink-muted', 'ink-subtle', 'danger'] as const;

describe.each([
  ['dark', dark],
  ['light', light],
])('the %s theme', (name, tokens) => {
  it('keeps every text token at 4.5:1 against every surface it can sit on', () => {
    for (const text of TEXT_TOKENS) {
      const value = tokens[text];
      expect(value, `${name}: --${text} is missing`).toBeDefined();
      if (!value) continue;
      for (const surface of SURFACES) {
        const surfaceValue = tokens[surface];
        expect(surfaceValue, `${name}: --${surface} is missing`).toBeDefined();
        if (!surfaceValue) continue;
        const measured = ratio(toRgb(value, tokens), toRgb(surfaceValue, tokens));
        expect(
          measured,
          `${name}: --${text} on --${surface} measures ${measured.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the control boundary at 3:1 against every surface it separates', () => {
    const control = tokens['control-border'];
    expect(control).toBeDefined();
    if (!control) return;
    for (const surface of SURFACES) {
      const surfaceValue = tokens[surface];
      if (!surfaceValue) continue;
      const measured = ratio(toRgb(control, tokens), toRgb(surfaceValue, tokens));
      expect(
        measured,
        `${name}: --control-border on --${surface} measures ${measured.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps the primary action readable', () => {
    const foreground = tokens['primary-foreground'];
    const primary = tokens.primary;
    expect(foreground).toBeDefined();
    expect(primary).toBeDefined();
    if (!foreground || !primary) return;
    expect(ratio(toRgb(foreground, tokens), toRgb(primary, tokens))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps a tag chip readable for the two extreme hues', () => {
    const tint = Number.parseFloat((tokens['tag-tint'] ?? '18%').replace('%', ''));
    const card = tokens.card;
    const ink = tokens.ink;
    expect(card).toBeDefined();
    expect(ink).toBeDefined();
    if (!card || !ink) return;

    const extreme: Rgb = name === 'dark' ? [255, 255, 255] : [0, 0, 0];
    const chip = mix(extreme, tint, toRgb(card, tokens));
    const measured = ratio(toRgb(ink, tokens), chip);
    expect(
      measured,
      `${name}: ink on a ${name === 'dark' ? 'white' : 'black'} tag`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps every surface and seam neutral: max(R,G,B) − min(R,G,B) ≤ 3', () => {
    const ramp = [...SURFACES, 'border', 'border-strong'] as const;
    for (const token of ramp) {
      const value = tokens[token];
      expect(value, `${name}: --${token} is missing`).toBeDefined();
      if (!value) continue;
      const [r, g, b] = toRgb(value, tokens);
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      expect(
        chroma,
        `${name}: --${token} ${resolve(value, tokens)} has a chroma of ${chroma} (${r},${g},${b})`,
      ).toBeLessThanOrEqual(3);
    }
  });

  it('keeps the plate text at 4.5:1 on the plate', () => {
    const plate = tokens.plate;
    expect(plate, `${name}: --plate is missing`).toBeDefined();
    if (!plate) return;
    for (const text of ['plate-ink', 'plate-muted'] as const) {
      const value = tokens[text];
      expect(value, `${name}: --${text} is missing`).toBeDefined();
      if (!value) continue;
      const measured = ratio(toRgb(value, tokens), toRgb(plate, tokens));
      expect(
        measured,
        `${name}: --${text} on --plate measures ${measured.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the worst tag label readable on the plate', () => {
    const tint = Number.parseFloat((tokens['tag-tint'] ?? '18%').replace('%', ''));
    const plate = tokens.plate;
    const plateInk = tokens['plate-ink'];
    expect(plate).toBeDefined();
    expect(plateInk).toBeDefined();
    if (!plate || !plateInk) return;

    const extreme: Rgb = name === 'dark' ? [255, 255, 255] : [0, 0, 0];
    const chip = mix(extreme, tint, toRgb(plate, tokens));
    const measured = ratio(toRgb(plateInk, tokens), chip);
    expect(
      measured,
      `${name}: plate-ink on a ${name === 'dark' ? 'white' : 'black'} tag over --plate measures ${measured.toFixed(2)}`,
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the palette', () => {
  it('defines the twelve tag hues in both themes', () => {
    const hues = [
      'slate',
      'gray',
      'red',
      'orange',
      'amber',
      'lime',
      'green',
      'teal',
      'sky',
      'blue',
      'violet',
      'pink',
    ];
    for (const hue of hues) {
      expect(dark[`tag-${hue}`], `dark --tag-${hue}`).toBeDefined();
      expect(light[`tag-${hue}`], `light --tag-${hue}`).toBeDefined();
    }
  });

  it('caps the light-theme tag tint lower than the dark one', () => {
    expect(Number.parseFloat((dark['tag-tint'] ?? '').replace('%', ''))).toBe(18);
    expect(Number.parseFloat((light['tag-tint'] ?? '').replace('%', ''))).toBe(12);
  });

  it('keeps the plate the warm exception in the dark theme (R > G > B)', () => {
    for (const token of ['plate', 'plate-ink', 'plate-muted'] as const) {
      const value = dark[token];
      expect(value, `dark: --${token} is missing`).toBeDefined();
      if (!value) continue;
      const [r, g, b] = toRgb(value, dark);
      expect(
        r,
        `dark: --${token} ${resolve(value, dark)} must have R > G (${r},${g},${b})`,
      ).toBeGreaterThan(g);
      expect(
        g,
        `dark: --${token} ${resolve(value, dark)} must have G > B (${r},${g},${b})`,
      ).toBeGreaterThan(b);
    }
  });

  it('uses only the two radii the system allows', () => {
    expect(CSS).toContain('--radius-sm: 8px');
    expect(CSS).toContain('--radius-full: 9999px');
    const radii = [...CSS.matchAll(/--radius-[a-z]+:\s*([^;]+);/g)].map((match) =>
      match[1]?.trim(),
    );
    expect(new Set(radii)).toEqual(new Set(['8px', '9999px']));
  });
});
