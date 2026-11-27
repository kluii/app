// SPDX-License-Identifier: AGPL-3.0-only
/**
 * minidenticons, vendored (MIT, laurentpayot/minidenticons).
 *
 * A 5×5 symmetric identicon, deterministic for a seed, as an SVG string. The
 * seed is a username, and it only ever selects rectangles and a hue: it is
 * never interpolated into the markup, so there is nothing to escape.
 */
const COLORS_NB = 9;
const DEFAULT_SATURATION = 95;
const DEFAULT_LIGHTNESS = 45;
const MAGIC_NUMBER = 5;

function simpleHash(str: string): number {
  return (
    str
      .split('')
      .reduce((hash, char) => (hash ^ char.charCodeAt(0)) * -MAGIC_NUMBER, MAGIC_NUMBER) >>> 2
  );
}

/** A 5×5 symmetric identicon as an SVG string. Deterministic for a seed. */
export function minidenticon(
  seed = '',
  saturation = DEFAULT_SATURATION,
  lightness = DEFAULT_LIGHTNESS,
): string {
  const hash = simpleHash(seed);
  const hue = (hash % COLORS_NB) * (360 / COLORS_NB);
  return (
    [...Array<unknown>(seed ? 25 : 0)].reduce(
      (acc, _e, i) =>
        hash & (1 << (i % 15))
          ? acc +
            `<rect x="${i > 14 ? 7 - ~~(i / 5) : ~~(i / 5)}" y="${i % 5}" width="1" height="1"/>`
          : acc,
      `<svg viewBox="-1.5 -1.5 8 8" xmlns="http://www.w3.org/2000/svg" fill="hsl(${hue} ${saturation}% ${lightness}%)">`,
    ) + '</svg>'
  );
}
