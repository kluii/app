---
version: alpha
name: Klui
description: >-
  The landing page's system, applied to a work surface. Warm graphite in dark, warm paper in light;
  Newsreader for display, Inter for interface, JetBrains Mono for machine facts. There is no brand
  hue — the primary fill is the ink, and an instance admin may override it through branding.
colors: {
  canvas: "#121110", column: "#171514", card: "#201e1c", surface: "#1a1817", surface-2: "#242220",
  surface-muted: "#2a2724", border: "#302d29", border-strong: "#46413a", control-border: "#767065",
  ink: "#f4f1eb", ink-muted: "#ada79e", ink-subtle: "#948e85", primary: "#f5f2ec",
  primary-hover: "#fffdf8", primary-foreground: "#14120f", plate: "#e9e5dd", plate-ink: "#14120f",
  danger: "#e8836f", focus: "#f5f2ec", selection: "#2e2b27", insert-line: "#f5f2ec", tag-tint: 18%
}
colors-light: {
  canvas: "#f7f5f0", column: "#ebe7de", card: "#ffffff", surface: "#fcfbf7", surface-2: "#f3efe7",
  surface-muted: "#e8e3d8", border: "#d9d3c6", border-strong: "#b5ae9e", control-border: "#7a7365",
  ink: "#14120f", ink-muted: "#5b564d", ink-subtle: "#635e54", primary: "#14120f",
  primary-hover: "#000000", primary-foreground: "#fffdf8", plate: "#14120f", plate-ink: "#f7f5f0",
  danger: "#a33a22", focus: "#14120f", selection: "#e4dfd3", insert-line: "#14120f", tag-tint: 12%
}
typography:
  display: { fontFamily: Newsreader, fontSize: 44px, fontWeight: 400, lineHeight: 1.05, letterSpacing: "-0.025em" }
  h1: { fontFamily: Newsreader, fontSize: 32px, fontWeight: 400, lineHeight: 1.1, letterSpacing: "-0.02em" }
  h2: { fontFamily: Newsreader, fontSize: 24px, fontWeight: 400, lineHeight: 1.2, letterSpacing: "-0.015em" }
  h3: { fontFamily: Inter, fontSize: 18px, fontWeight: 500, lineHeight: 1.3, letterSpacing: "0.01em" }
  body: { fontFamily: Inter, fontSize: 15px, fontWeight: 400, lineHeight: 1.6, letterSpacing: "0.01em" }
  body-sm: { fontFamily: Inter, fontSize: 13px, fontWeight: 400, lineHeight: 1.5, letterSpacing: "0.02em" }
  label: { fontFamily: Inter, fontSize: 12px, fontWeight: 500, lineHeight: 1.4, letterSpacing: "0.05em" }
  mono: { fontFamily: JetBrains Mono, fontSize: 12px, fontWeight: 400, lineHeight: 1.5, letterSpacing: "0em" }
  mono-sm: { fontFamily: JetBrains Mono, fontSize: 11px, fontWeight: 400, lineHeight: 1.4, letterSpacing: "0.02em" }
rounded: { sm: 8px, md: 8px, full: 9999px }
spacing: { "1": 4px, "2": 8px, "3": 12px, "4": 16px, "6": 24px, "8": 32px, "12": 48px, "16": 64px }
components:
  button-primary: { backgroundColor: "{colors.primary}", textColor: "{colors.primary-foreground}", typography: "{typography.label}", rounded: "{rounded.full}", height: 32px, padding: 12px }
  button-secondary: { backgroundColor: "{colors.surface-2}", textColor: "{colors.ink}", typography: "{typography.label}", rounded: "{rounded.full}", height: 32px, padding: 12px }
  button-ghost: { backgroundColor: "{colors.canvas}", textColor: "{colors.ink-muted}", typography: "{typography.label}", rounded: "{rounded.full}", height: 32px, padding: 8px }
  input: { backgroundColor: "{colors.surface-2}", textColor: "{colors.ink}", borderColor: "{colors.control-border}", typography: "{typography.body}", rounded: "{rounded.sm}", height: 32px, padding: 8px }
  header: { backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", borderColor: "{colors.border}", height: 56px }
  column: { backgroundColor: "{colors.column}", textColor: "{colors.ink}", rounded: "{rounded.sm}", width: 288px, padding: 8px }
  card: { backgroundColor: "{colors.card}", textColor: "{colors.ink}", borderColor: "{colors.border}", typography: "{typography.body-sm}", rounded: "{rounded.sm}", width: 272px, padding: 12px }
  chip: { backgroundColor: "{colors.surface-2}", textColor: "{colors.ink-muted}", borderColor: "{colors.border}", typography: "{typography.mono-sm}", rounded: "{rounded.full}", height: 20px, padding: 8px }
  dialog: { backgroundColor: "{colors.surface}", textColor: "{colors.ink}", typography: "{typography.body}", rounded: "{rounded.sm}", width: 560px, padding: 20px }
  menu: { backgroundColor: "{colors.surface}", textColor: "{colors.ink}", borderColor: "{colors.border}", typography: "{typography.body-sm}", rounded: "{rounded.sm}", padding: 4px }
shadow:
  overlay: "0 10px 30px rgba(0, 0, 0, 0.35)"
motion:
  fast: 120ms
  base: 180ms
  ease: "cubic-bezier(0.2, 0.6, 0.2, 1)"
---

# Klui — Design System

`web/src/styles/tokens.css` owns every value here and `web/test/contrast.test.ts` measures the palette; a rule that disagrees with
either is a bug in this file. The front matter is the dark theme (`:root`), `colors-light` is `[data-theme="light"]`.

## 1. Overview

1. **A step, not a shadow.** Canvas → column → card are three fills, a border marks the seam; a boundary that needs a shadow is a step chosen wrong.
2. **No brand hue.** `--primary` is the ink and fills the single primary action; colour lives only in `--danger` and in a tag chip the user coloured.
3. **Machine facts in mono.** Counts, ids, dates, ranks and shortcuts are JetBrains Mono, prose Inter, a title Newsreader.

Refused: emoji, icon fonts, gradients, glass, a coloured dark ground, a footer in the app.

## 2. Colour

`tokens.css` is the only file allowed a colour literal; components read tokens through the Tailwind mapping. `contrast.test.ts` parses both blocks and asserts, per theme: ink, `--ink-muted`, `--ink-subtle` and `--danger` at ≥ 4.5:1 on all six surfaces; `--control-border` at ≥ 3:1 on `--canvas` and `--surface-2`; the primary pair and the worst-case tag chip at ≥ 4.5:1; the twelve hues defined; the tint capped; no radius but 8 px and `9999px`.

- `--border` is a decorative seam; a control boundary uses `--control-border`, the token measured at 3:1. `--danger` never
  decorates, there is no success colour, and `--plate` is the inverted surface, not a second ground.

### 2.3 Tag colours (D-21)

A tag is the user's vocabulary, so it carries the user's colour and nothing else does. In `tokens.css`, `--tag-bg` mixes `--tag` at `--tag-tint` into `--card`, `--tag-line` mixes 45 % into `--border`, and the label stays `--ink`. The tint is capped (18 % dark, 12 % light) so any hue reads — the test measures a white tag in dark and a black one in light, not 16 million colours. A coloured chip carries a full-colour bar; a neutral tag is `--surface-2`.

### 2.4 Instance branding, the one accent exception

An instance admin may set an accent (K5-01), the only palette override:

- `web/src/lib/branding.ts` re-points `--primary`, `--primary-hover`, `--primary-foreground` and `--focus` on the root; type, radii,
  spacing, motion and layout are not themeable. Defaults use the same variables: "unbranded" is not a code path.
- `server/src/settings/branding.ts` measures the accent before storing it — ≥ 4.5:1 for the readable foreground on the accent
  fill, ≥ 3.0:1 against the dark and light `--canvas` and `--surface` — and rejects a failing colour with the measured ratio.

## 3. Typography

Newsreader for `display`, `h1`, `h2`; Inter for `h3`, `body`, `body-sm`, `label`; JetBrains Mono for `mono` and `mono-sm` (counts,
ids, dates, ranks, hints, the spinner). Three self-hosted latin subsets, because the CSP is `font-src 'self'`.

- `tabular-nums` for every count, table and date; a column header is `label` with `--tracking-caps` (0.08em), and no uppercase
  eyebrow text exists anywhere else. Card titles clamp to 3 lines on the board and never in the read view; a column title wraps.
- French copy uses ’ and non-breaking spaces (`docs/features/i18n.md` §5).

## 4. Layout and geometry

| Value | Token | Where |
|---|---|---|
| 1440 px | `--size-content` | maximum content width |
| 288 px | `--size-column` | a column, fixed |
| 272 px | `--size-card` | a card at rest, and the drag preview |
| 560 / 640 px | `--size-dialog`, `--size-dialog-wide` | dialogs |
| 56 px | `h-14` | the header: canvas ground, `--border` hairline, no shadow |

- A column sizes to its content and aligns to the top of the rail (`items-start`); a sparse column never stretches to its tallest
  neighbour. Space is Tailwind's 4 px scale, and a named size beats an arbitrary value.
- The board is a fixed frame: `h-dvh overflow-hidden`, the rail scrolls inside the content area, so the horizontal scrollbar sits
  at the bottom of the viewport and not under the columns (`web/src/components/layout/app-shell.tsx`).
- Breakpoints 390 / 640 (a dialog becomes a bottom sheet) / 768 / 1024 / 1440; below 640 the rail snaps sideways and only auth cards and the 404 centre (`web/src/styles/app.css`).

## 5. Surfaces and depth

| Level | Token | Used for |
|---|---|---|
| 0 | `--canvas` | app and board ground |
| 1 | `--column` | a column well |
| 2 | `--card` | cards, list rows |
| 3 | `--surface` | dialogs, menus, popovers |
| 4 | `--surface-2` | inputs, chips, hover fills |
| — | `--surface-muted` | inset blocks, table head, selected row |

One shadow, `--shadow-overlay`, for overlays only: a dialog, a menu, the drag preview — never a resting card.

## 6. Shapes

8 px (`--radius-sm`, `--radius-md`) for surfaces, inputs, cards, columns, dialogs and menus; `9999px` for anything you press. The
4 px step is gone. Borders are 1 px, and 2 px exists only as the focus ring.

## 7. Components

Every component is a copy-in under `web/src/components/ui/`, restyled once to these tokens; a variant is added in the component, never at a call site.

- **Button.** Pill, 28 / 32 / 36 high, `label` type: `primary` is the ink fill and one per region, `secondary` the default, `ghost`
  for icon-only, `danger` only in a destructive confirm. Disabled is 40 % opacity; `loading` also sets `aria-busy`.
- **Input.** `--surface-2`, 1 px `--control-border`, 8 px radius, height 32; focus is a 2 px `--focus`
  outline at a 2 px offset; no floating labels.
- **Card.** `--card`, 1 px `--border`, 8 px radius, padding 12 × 10: the border is the card's edge, hover raises it to
  `--border-strong` and nothing lifts. The done tick renders only when done.
- **Column.** `--column`, 8 px radius, 288 wide, padding 8, cards stacked at 8 px, a `label` header.
- **Chip and tag chip.** Pill, 20 high, `mono-sm`, `--surface-2` with `--border`; an active filter chip is the ink fill, a coloured tag adds `--tag-bg`, `--tag-line` and a bar (§2.3).
- **Dialog.** A native `<dialog>` — focus trap, `Esc`, inert background, restoration come from the platform. `--surface`, 8 px, 560
  wide (640 for a card), 20 padding, `--scrim` behind, primary action last.
- **Menu.** The platform popover API — light dismiss, `Esc`, top layer — **anchored to its trigger**: a top-layer panel is laid
  out against the viewport, so it is positioned from the trigger's rect on open (`web/src/components/ui/popover.tsx`). `--surface`,
  8 px, `--border`, destructive items in `--danger`.
- **Toast and empty state.** Toast bottom-left on `--surface`, one at a time, one action at most. An empty state is one `h3` and one
  `body-sm` explanation, at most one action, no illustration.

## 8. The board

Board > column > card, nothing else; there is no sidebar, because the board is the page.

Drag is four pieces, all in `tokens.css`: a preview that follows the pointer (card-sized, `--card`, `--border-strong`, the one shadow,
a 1.5° tilt); the source card dimmed to 35 % behind a dashed outline; a 2 px `--insert-line` for the slot plus the lit column
(`--surface-2` step, `--border-strong` outline); and a single settle on landing (`--dur-base`). Under `prefers-reduced-motion` the
line still appears and nothing moves — a position is information. A card is the drop target, a gap is a line, never a hit band
(`docs/features/board-interaction.md` §1.2).

## 9. Motion and touch

`--dur-fast` 120 ms (hover, press, tick), `--dur-base` 180 ms (drop, settle), `--ease` `cubic-bezier(0.2, 0.6, 0.2, 1)`: nothing longer, no bounce. Only `opacity`, `transform`, `background-color`, `border-color` and `color` animate. Reduced motion collapses every duration globally and keeps a static frame that still means something — the spinner freezes on its first frame. A coarse pointer gets 40 px hit targets; a mouse does not (`web/src/styles/app.css`).

## 10. Iconography

lucide-react only, stroke 1.5, `currentColor`, no filled set: 12 inline metadata, 14 menu and button glyphs, 16 toolbar. An
icon-only control carries `aria-label`, and an icon never replaces the word that is the affordance.

## 11. Voice

Sentence case, verbs for actions, no exclamation marks, no "Oops", no "Successfully", no marketing copy inside the app. An error
says what happened, what to do, and carries the code for support. Copy is honest — a share link says it lets anyone read the
board — and every number displayed is greppable in the code.

## 12. Accessibility

- Text ≥ 4.5:1 and control boundaries ≥ 3:1 in both themes, measured in `contrast.test.ts`. Keyboard: every control in DOM order
  with a 2 px `--focus` ring at a 2 px offset; dialogs trap and restore focus; `Space` lifts, arrows move, `Space` drops, `Esc` cancels.
- Done is a tick and a strikethrough, never a tint. `<html lang>` follows the locale, `dir` is `ltr`, the skip link comes first.

## 13. Assets and identity

`web/src/assets/klui-logo-white.png` and `klui-logo-black.png`: the file name is the ink, not the theme — white for the dark ground,
black for the light one, chosen in the shell at 28 px, 32 px from `sm`. An admin may swap the wordmark and instance name (K5-01).

## 14. Loading, empty and error states

- **Spinner** for a short wait: the braille cycle in mono, `role="status"`, scheduled in CSS. A **skeleton** appears only after 200 ms of pending state.
- **Errors** are inline where the action failed, with the code and never a stack trace; a failed mutation patches the one row and keeps the last confirmed server state.

## 15. Implementation notes

- One colour literal (`tokens.css`); `npm run lint` rejects hex, `rgb()`/`hsl()` and arbitrary colours elsewhere. The one allowed
  inline style is `style={{ '--tag': color }}` on a tag chip, never a colour property.
- The theme is applied before React mounts by an inline bootstrap, so a light user never sees a dark frame. A tint mix, a scrim, the
  spinner schedule and the drag rules live in `tokens.css`, next to their tokens.
- Print re-points the tokens to black on white and hides the header (`docs/features/close-out.md` §4).
