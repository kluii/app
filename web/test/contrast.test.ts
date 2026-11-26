// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The contrast gate (DESIGN.md §2, docs/testing.md §6).
 *
 * The values are parsed from `tokens.css`, never duplicated here: a palette
 * change must travel through this test. Text tokens are measured against every
 * surface they can sit on, in both themes.
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

const SURFACES = ['canvas', 'column', 'card', 'surface', 'surface-2', 'surface-muted'] as const;
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
        const measured = ratio(hexToRgb(value), hexToRgb(surfaceValue));
        expect(
          measured,
          `${name}: --${text} on --${surface} measures ${measured.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the control boundary at 3:1 against the surfaces it separates', () => {
    const control = tokens['control-border'];
    expect(control).toBeDefined();
    if (!control) return;
    for (const surface of ['canvas', 'surface-2'] as const) {
      const surfaceValue = tokens[surface];
      if (!surfaceValue) continue;
      const measured = ratio(hexToRgb(control), hexToRgb(surfaceValue));
      expect(measured, `${name}: --control-border on --${surface}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps the primary action readable', () => {
    const foreground = tokens['primary-foreground'];
    const primary = tokens.primary;
    expect(foreground).toBeDefined();
    expect(primary).toBeDefined();
    if (!foreground || !primary) return;
    expect(ratio(hexToRgb(foreground), hexToRgb(primary))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps a tag chip readable for the two extreme hues', () => {
    const tint = Number.parseFloat((tokens['tag-tint'] ?? '18%').replace('%', ''));
    const card = tokens.card;
    const ink = tokens.ink;
    expect(card).toBeDefined();
    expect(ink).toBeDefined();
    if (!card || !ink) return;

    const extreme: Rgb = name === 'dark' ? [255, 255, 255] : [0, 0, 0];
    const chip = mix(extreme, tint, hexToRgb(card));
    const measured = ratio(hexToRgb(ink), chip);
    expect(
      measured,
      `${name}: ink on a ${name === 'dark' ? 'white' : 'black'} tag`,
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

  it('uses only the two radii the system allows', () => {
    expect(CSS).toContain('--radius-sm: 4px');
    expect(CSS).toContain('--radius-md: 8px');
    const radii = [...CSS.matchAll(/--radius-[a-z]+:\s*([^;]+);/g)].map((match) =>
      match[1]?.trim(),
    );
    expect(new Set(radii)).toEqual(new Set(['4px', '8px']));
  });
});
