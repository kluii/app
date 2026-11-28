// SPDX-License-Identifier: AGPL-3.0-only
import {
  Book,
  Briefcase,
  Camera,
  Code,
  Folder,
  Heart,
  Layers,
  Palette,
  Rocket,
  ShoppingCart,
  type LucideIcon,
} from 'lucide-react';
import type { BoardIcon } from '../../api/types';

/**
 * The ten board icon names, mirrored from `server/src/contracts/boards.ts`
 * `BOARD_ICONS` (D-60): the server stores a name from this closed set, never
 * an upload or a colour, so the client maps the name to its own glyph
 * (`cart` is lucide's `ShoppingCart`).
 */
export const BOARD_ICONS: readonly BoardIcon[] = [
  'briefcase',
  'palette',
  'rocket',
  'book',
  'code',
  'folder',
  'layers',
  'camera',
  'cart',
  'heart',
];

const GLYPHS: Record<BoardIcon, LucideIcon> = {
  briefcase: Briefcase,
  palette: Palette,
  rocket: Rocket,
  book: Book,
  code: Code,
  folder: Folder,
  layers: Layers,
  camera: Camera,
  cart: ShoppingCart,
  heart: Heart,
};

/** The glyph a board icon name renders as, at the size the caller asks for. */
export function BoardIconGlyph({
  name,
  size,
  strokeWidth = 1.5,
}: {
  name: BoardIcon;
  size: number;
  strokeWidth?: number;
}) {
  const Glyph = GLYPHS[name];
  return <Glyph aria-hidden="true" size={size} strokeWidth={strokeWidth} />;
}
