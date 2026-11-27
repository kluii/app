// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The twelve tag hues of DESIGN.md (D-21). The hexes live in tokens.css and
 * nowhere else, so this module reads them from the document at call time: a
 * palette copied into TypeScript would be the second source of colour the
 * non-negotiable forbids.
 */
export const TAG_HUES = [
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
] as const;

export type TagHue = (typeof TAG_HUES)[number];

function readToken(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--tag-${name}`).trim();
  return value === '' ? null : value;
}

export function hueColor(hue: TagHue): string {
  return readToken(hue) ?? '';
}

/** The palette for the current theme, in the order the swatches are shown. */
export function palette(): { hue: TagHue; color: string }[] {
  return TAG_HUES.map((hue) => ({ hue, color: hueColor(hue) })).filter(
    (entry): entry is { hue: TagHue; color: string } => entry.color !== '',
  );
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

export function isHex(value: string): boolean {
  return HEX.test(value);
}

/** Lowercase `[a-z0-9-]`, 1–24 characters, the rule the server enforces too. */
export function normalizeTag(value: string): string | null {
  const name = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return name === '' ? null : name;
}
