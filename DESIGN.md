---
version: alpha
name: Klui
description: >-
  The landing page's system, applied to a work surface. A neutral graphite ground and one warm surface,
  the plate; Newsreader announces, Inter explains, JetBrains Mono states facts. There is no brand hue —
  the primary fill is the ink, and an instance admin may override it through branding.
colors: {
  canvas: "#0b0b0c", column: "#171718", card: "#1e1e1f", surface: "#121213", surface-2: "#171718",
  surface-muted: "#1e1e1f", surface-raised: "#242425", border: "#2a2a2c", border-strong: "#3f3f42",
  control-border: "#78787c", ink: "#f5f5f5", ink-muted: "#a3a3a3", ink-subtle: "#8c8c8c",
  primary: "#f5f5f5", primary-hover: "#ffffff", primary-foreground: "#0e0e10",
  plate: "#e9e5dd", plate-ink: "#14120f", plate-muted: "#5f5a52", danger: "#e8836f",
  focus: "#f5f5f5", selection: "#333336", insert-line: "#e9e5dd", tag-tint: 18%
}
colors-light: {
  canvas: "#f5f5f4", column: "#ebebe9", card: "#ffffff", surface: "#f8f8f7", surface-2: "#ebebe9",
  surface-muted: "#e4e4e1", surface-raised: "#ffffff", border: "#dadad7", border-strong: "#bcbcba",
  control-border: "#77777a", ink: "#14120f", ink-muted: "#5f5a52", ink-subtle: "#68645b",
  primary: "#14120f", primary-hover: "#000000", primary-foreground: "#f5f5f5",
  plate: "#14120f", plate-ink: "#f5f5f5", plate-muted: "#a19c92", danger: "#a33a22",
  focus: "#14120f", selection: "#dadad7", insert-line: "#14120f", tag-tint: 12%
}
typography:
  h1: { fontFamily: Newsreader, fontSize: 32px, fontWeight: 400, lineHeight: 1.15, letterSpacing: "-0.015em" }
  h2: { fontFamily: Newsreader, fontSize: 24px, fontWeight: 400, lineHeight: 1.2, letterSpacing: "-0.015em" }
  h3: { fontFamily: Inter, fontSize: 16px, fontWeight: 500, lineHeight: 1.5, letterSpacing: "0.02em" }
  body: { fontFamily: Inter, fontSize: 16px, fontWeight: 400, lineHeight: 1.65, letterSpacing: "0.02em" }
  body-sm: { fontFamily: Inter, fontSize: 14px, fontWeight: 400, lineHeight: 1.5, letterSpacing: "0.04em" }
  label: { fontFamily: Inter, fontSize: 13px, fontWeight: 500, lineHeight: 1.4, letterSpacing: "0.05em" }
  mono: { fontFamily: JetBrains Mono, fontSize: 13px, fontWeight: 400, lineHeight: 1.5, letterSpacing: "0em" }
  mono-sm: { fontFamily: JetBrains Mono, fontSize: 12px, fontWeight: 400, lineHeight: 1.4, letterSpacing: "0.02em" }
rounded: { key: 4px, sm: 8px, full: 9999px }
spacing: { "1": 4px, "2": 8px, "3": 12px, "4": 16px, "6": 24px, "8": 32px, "12": 48px, "16": 64px }
components:
  button-primary: { backgroundColor: "{colors.primary}", textColor: "{colors.primary-foreground}", typography: "{typography.label}", rounded: "{rounded.sm}", height: 32px, padding: 12px }
  button-secondary: { backgroundColor: "transparent", textColor: "{colors.ink}", borderColor: "{colors.border-strong}", typography: "{typography.label}", rounded: "{rounded.sm}", height: 32px, padding: 12px }
  input: { backgroundColor: "{colors.surface}", textColor: "{colors.ink}", borderColor: "{colors.control-border}", typography: "{typography.body-sm}", rounded: "{rounded.sm}", height: 36px, padding: 12px }
  header: { backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", borderColor: "{colors.border}", height: 56px }
  column: { backgroundColor: "{colors.column}", textColor: "{colors.ink}", borderColor: "{colors.border}", rounded: "{rounded.sm}", width: 288px, padding: 8px }
  card: { backgroundColor: "{colors.card}", textColor: "{colors.ink}", borderColor: "{colors.border}", typography: "{typography.body-sm}", rounded: "{rounded.key}", width: 270px, padding: 12px }
  tag: { backgroundColor: "{colors.surface-2}", textColor: "{colors.ink}", borderColor: "{colors.border}", typography: "{typography.mono-sm}", rounded: "{rounded.key}", height: 20px, padding: 8px }
  dialog: { backgroundColor: "{colors.surface-raised}", textColor: "{colors.ink}", borderColor: "{colors.border-strong}", typography: "{typography.body}", rounded: "{rounded.sm}", width: 640px, padding: 24px }
  menu: { backgroundColor: "{colors.surface-raised}", textColor: "{colors.ink}", borderColor: "{colors.border-strong}", typography: "{typography.body-sm}", rounded: "{rounded.sm}", padding: 4px }
shadow:
  overlay: "0 10px 30px rgba(0, 0, 0, 0.35)"
  sheet: "0 -8px 40px rgba(0, 0, 0, 0.55)"
motion:
  fast: 140ms
  base: 180ms
  enter: 320ms
  stagger: 40ms
  ease: "cubic-bezier(0.2, 0, 0, 1)"
---

# Klui — Design System

`web/src/styles/tokens.css` owns every value here and `web/test/contrast.test.ts` measures the palette; a rule that disagrees with
either is a bug in this file. The front matter is the dark theme (`:root`), `colors-light` is `[data-theme="light"]`. The site's
`DESIGN.md` (`kluii/landing`) is the other half of the contract: §16 says what is identical, what is adapted, and why.

## 1. Overview

1. **A step, not a shadow.** Canvas → column → card → raised are four neutral fills, and a 1 px border marks the seam; a boundary
   that needs a shadow is a step chosen wrong.
2. **One warm surface.** The plate — parchment in dark, inverted ink in light — is the only thing with a temperature. One per
   screen, never a second ground.
3. **Three voices.** Newsreader announces (24 px and up, weight 400), Inter explains, JetBrains Mono states facts (dates, counts,
   roles, tags, code).
4. **Positive tracking is the signature**, and it is a token: 0.02 / 0.04 / 0.05 em by size. Never tightened "to look clean".

Refused: emoji, icon fonts, gradients, glass, a coloured ground, pills outside the avatar, a footer in the app.

## 2. Colour

`tokens.css` is the only file allowed a colour literal; components read tokens through the Tailwind mapping. `contrast.test.ts`
parses both blocks and asserts, per theme: `--ink`, `--ink-muted`, `--ink-subtle` and `--danger` at ≥ 4.5:1 on all seven surfaces
(canvas, column, card, surface, surface-2, surface-muted, surface-raised); `--control-border` at ≥ 3:1 on every surface;
`--primary-foreground` on `--primary`; the worst-case tag chip; the twelve hues; the tint capped; the plate's own pair
(`--plate-ink`, `--plate-muted` ≥ 4.5:1 on `--plate`) and its worst tag; **neutrality** — every surface and every border has
`max(R,G,B) − min(R,G,B) ≤ 3`, and the plate is the warm exception; and the radius set `{4px, 8px, 9999px}`.

- The steps are deliberately close (canvas → column 1.10:1, column → card 1.08:1). **The 1 px border carries the reading**, not the
  fill difference: a column is a well because it has an edge.
- `--border` is a decorative seam; a control boundary uses `--control-border`, the token measured at 3:1. `--danger` never
  decorates — a danger callout is danger text with a 2 px danger left rule, never a red block.

### 2.3 Tag colours (D-21)

A tag is the user's vocabulary, so it carries the user's colour and nothing else does. In `tokens.css`, `--tag-bg` mixes `--tag` at
`--tag-tint` into `--card`, `--tag-line` mixes 45 % into `--border`, and the label stays `--ink`. The tint is capped (18 % dark,
12 % light) so any hue reads — the test measures a white tag in dark and a black one in light, not 16 million colours. A coloured
chip carries a full-colour bar; a neutral tag is `--surface-2` with a `--border` hairline.

### 2.4 Instance branding, the one accent exception

An instance admin may set an accent (K5-01), the only palette override:

- `web/src/lib/branding.ts` re-points `--primary`, `--primary-hover`, `--primary-foreground` and `--focus` on the root; type,
  radii, spacing, motion, the plate and layout are not themeable. Defaults use the same variables: "unbranded" is not a code path.
- `server/src/settings/branding.ts` measures the accent before storing it — ≥ 4.5:1 for the readable foreground on the accent
  fill, ≥ 3.0:1 against the dark and light `--canvas` and `--surface` — and rejects a failing colour with the measured ratio. Its
  `SURFACES` constants mirror this file's ramp; a palette change moves them in the same commit.

## 3. Typography

Newsreader for `h1` (32) and `h2` (24); Inter for `h3` (16), `body` (16), `body-sm` (14), `label` (13); JetBrains Mono for `mono`
(13) and `mono-sm` (12). Three self-hosted latin subsets, because the CSP is `font-src 'self'`.

- **The serif never drops below 24 px** and never carries a body, a label or a button. A page title is `text-h1`; a dialog, a panel
  and the board's own title are `text-h2`.
- **Tracking is a token, never a component decision**: `--tracking-body` (0.02 em), `--tracking-small` (0.04 em),
  `--tracking-label` (0.05 em), `--tracking-serif` (−0.015 em). A `tracking-[…]` or a `letter-spacing` outside `tokens.css` is a
  defect.
- `tabular-nums` for every count, date and ordinal. One date format: `formatDate` (`lib/format.ts`).
- Sentence case everywhere; no uppercase, no eyebrow, no italic. A column header is `label`, sentence case, and wraps to two
  lines. Card titles clamp to three lines on the board, never in the read view.
- French copy uses ’ and non-breaking spaces (`docs/features/i18n.md` §5).

## 4. Layout and geometry

| Value | Token | Where |
|---|---|---|
| 1440 px | `--size-content` | maximum content width |
| 288 px | `--size-column` | a column, fixed |
| 270 px | `--size-card` | a card at rest, and the drag preview (288 − 2 border − 16 padding) |
| 560 / 640 px | `--size-dialog`, `--size-dialog-wide` | dialogs; a card detail is 640 |
| 56 px | `h-14` | the shell header and the board bar |
| 24 / 16 / 12 / 8 | spacing steps | page inset, rail gap, card padding, card gap |

- Spacing is Tailwind's 4 px scale, **pinned in px** (`--spacing: 4px`): the root font size is the body type token, so a
  rem-derived step would render 56 as 52.5. A named size beats an arbitrary value; `.5` steps do not exist.
- A column sizes to its content and aligns to the top of the rail (`items-start`); a sparse column never stretches to its tallest
  neighbour. The board page scrolls as one document — its header and bar scroll away with the columns — and only the rail scrolls sideways, under the tallest column.
- Breakpoints 390 / 640 (a dialog becomes a bottom sheet) / 768 / 1024 (the auth plate appears) / 1440.

## 5. Surfaces and depth

| Level | Token | Used for |
|---|---|---|
| 0 | `--canvas` | app and board ground |
| 1 | `--column` (= `--surface-2`) | a column well |
| 2 | `--card` (= `--surface-muted`, `#fff` in light) | cards, tiles, list rows |
| 2b | `--surface` | inputs, callouts, code blocks |
| 3 | `--surface-raised` | dialogs, menus, popovers, the bell panel |
| — | `--surface-muted` | the active rail row, hover fills |

Two shadows, both neutral: `--shadow-overlay` for anything that floats over the page, `--shadow-sheet` for the phone sheet
(the landing's one shadow). A resting card has neither. `--shadow-active` is the 1 px inner light on an active rail row and the
dark primary button — a highlight, not a lift.

## 6. Shapes

`--radius-key` 4 px for what sits inside something: a card in a column (8 − 8 = 0, so the 4 px floor applies), a tag, a menu item,
a column footer, the done tick's pastille. `--radius-sm` 8 px for surfaces and controls: columns, tiles, dialogs, menus, buttons,
inputs. `9999px` only for the avatar. Nested radii add up, and 4 is the floor.

## 7. Components

Every component is a copy-in under `web/src/components/ui/`, restyled once to these tokens; a variant is added in the component,
never at a call site.

- **Button.** 8 px radius, `label` type, 28 / 32 / 36 high, press is `translateY(1px)`. `primary` is the ink fill, one per region;
  `secondary` is the landing's ghost (transparent, 1 px `--border-strong`, hover `--surface-2`); `ghost` has no border; `danger`
  only inside a destructive confirm. Disabled is 40 % opacity; `loading` also sets `aria-busy`.
- **Input / Select.** `--surface`, 1 px `--control-border`, 36 high, 8 px radius; focus is a 2 px `--focus` outline at a 2 px
  offset. A select is `appearance-none` with a `ChevronDown` 16 and `pr-8` — never the OS frame.
- **Card.** `--card`, 1 px `--border`, **4 px radius**, padding 12 on four sides, title `body-sm` at 500. Hover raises the border
  to `--border-strong` and nothing lifts. A done card shows a filled tick and a strikethrough, one glyph, one meaning; its reopen
  control is `Undo2`, not a second check.
- **Column.** `--column`, 1 px `--border`, 8 px radius, 288 wide, padding 8, cards stacked at 8, a `label` header with a mono
  count, a ghost `Add card` footer at 4 px radius.
- **Tag chip.** 20 high, 4 px radius, `mono-sm`: `--surface-2` + `--border` when neutral, `--tag-bg` + `--tag-line` + a 2 px bar
  when coloured (§2.3).
- **Dialog.** A native `<dialog>` — focus trap, `Esc`, inert background, restoration come from the platform. `--surface-raised`,
  1 px `--border-strong`, 8 px radius, 640 for a card and 560 otherwise, padding 24, `--scrim` behind, **centred** (Tailwind's
  preflight zeroes the UA's `margin: auto`, so the rule puts it back). Fade + 8 px rise, 180 ms.
- **Menu.** The platform popover API — light dismiss, `Esc`, top layer — **anchored to its trigger**: a top-layer panel is laid
  out against the viewport, so it is positioned from the trigger's rect on open (`web/src/components/ui/popover.tsx`).
  `--surface-raised`, 8 px, padding 4, items 32 high at 4 px radius, destructive items in `--danger`.
- **Empty slot.** One shared component: a dashed 1 px `--border-strong` box, an `h3`, a `body-sm`, at most one action,
  **left-aligned**, no illustration. It is the same device as the dashes left by a held card.
- **Toast.** Bottom-left on `--surface-raised`, one at a time, one action at most.

## 8. The board

Board > column > card, nothing else; there is no sidebar, because the board is the page. The bar carries the title (serif 24), one
mono meta line (`Owner · Private`), then Filter with its count, `{shown} of {total} cards`, and the settings button.

Drag is four pieces, all in `tokens.css`: **a preview printed on the plate** (same geometry as the card, parchment/ink, the one
overlay shadow, 1.5° of tilt — the app's plate is *held*, where the landing's is *printed*); the source card left as a dashed
slot at 35 %; a 2 px `--insert-line` in the plate colour for the slot, with the target column outlined in `--border-strong` and
no fill change; and a single settle on landing (`--dur-base`). A card lifted with the keyboard takes the plate **in place**, with
its 2 px dashed focus ring: one plate on screen, never two. Under `prefers-reduced-motion` the line still appears and nothing
moves — a position is information. A card is the drop target, a gap is a line, never a hit band
(`docs/features/board-interaction.md` §1.2).

## 9. Motion and touch

`--dur-fast` 140 ms (hover, press, tick, insert line), `--dur-base` 180 ms (menus, popovers, dialogs, settle), `--dur-enter`
320 ms with `--stagger` 40 ms on at most six siblings for the one entrance a screen gets, and `--ease`
`cubic-bezier(0.2, 0, 0, 1)` — one curve, four durations, nothing longer, no bounce. Only `opacity`, `transform`,
`background-color`, `border-color` and `color` animate, and every transition names its properties. The **first screen of a
document stands still**; what arrives afterwards rises 8 px (`web/src/lib/entrance.ts`). Reduced motion collapses every duration
globally and keeps a static frame that still means something — the spinner freezes on its first frame, the insert line stays. A
coarse pointer gets 40 px hit targets; a mouse does not (`web/src/styles/app.css`).

## 10. Iconography

lucide-react only, stroke **1.5**, `currentColor`, no filled set: 12 inline metadata, 14 menu and button glyphs, 16 toolbar. One
exception, documented in place: the filled tick inside a done card's pastille is stroke 2. An icon-only control carries
`aria-label`, and an icon never replaces the word that is the affordance.

## 11. Voice

Sentence case, verbs for actions, no exclamation marks, no "Oops", no "Successfully", no marketing copy inside the app. Short
labels carry no full stop. An error says what happened, what to do, and carries the code for support. Copy is honest — a share
link says it lets anyone read the board — and every number displayed is greppable in the code.

## 12. Accessibility

- Text ≥ 4.5:1 and control boundaries ≥ 3:1 in both themes, measured in `contrast.test.ts`. Keyboard: every control in DOM order
  with a 2 px `--focus` ring at a 2 px offset; dialogs trap and restore focus; `Space` lifts, arrows move, `Space` drops, `Esc`
  cancels. The auth plate is `aria-hidden` with no focusable descendant, and its caption carries the meaning.
- Done is a tick and a strikethrough, never a tint. `<html lang>` follows the locale, `dir` is `ltr`, the skip link comes first.

## 13. Assets and identity

`web/src/assets/klui-logo-white.png` and `klui-logo-black.png`: the file name is the ink, not the theme — white for the dark
ground, black for the light one. The shell draws it at **24 px at every width**; the auth plate prints the black one on the
parchment mat. An admin may swap the wordmark and instance name (K5-01).

## 14. Loading, empty and error states

- **Spinner** for a short wait: the braille cycle in mono, `role="status"`, scheduled in CSS. A **skeleton** appears only after
  200 ms of pending state.
- **Empty** is the shared slot (§7), left-aligned, one action at most; a column with no card says so in one `body-sm` line, with
  no slot inside a slot.
- **Errors** are inline where the action failed, with the code and never a stack trace; a failed mutation patches the one row and
  keeps the last confirmed server state.

## 15. Implementation notes

- One colour literal (`tokens.css`); `npm run lint` rejects hex, `rgb()`/`hsl()` and arbitrary colours elsewhere. The one allowed
  inline style is `style={{ '--tag': color }}` on a tag chip, never a colour property.
- The theme is applied before React mounts by an inline bootstrap, so a light user never sees a dark frame. A tint mix, a scrim,
  the plate scope (`.card-plate`), the spinner schedule and the drag rules live in `tokens.css`, next to their tokens.
- Print re-points the tokens to black on white and hides the header (`docs/features/close-out.md` §4).

## 16. Rapport à la landing

The app is the dense tool, the site is the page that is read. The site's `DESIGN.md` (`kluii/landing`) owns the ramp, the three
voices, the positive tracking, the plate and the movement; this file owns how they are used on a work surface. On a divergence,
the token wins over both documents.

| Element | Landing | App | Status |
|---|---|---|---|
| Dark ground | `#0B0B0C`, neutrality ≤ 3 | same, both themes, tested | identical |
| Dark steps | surface `#121213`, surface-2 `#171718`, surface-muted `#1E1E1F` | same; `--column` = surface-2, `--card` = surface-muted | identical |
| Raised level | — | `--surface-raised #242425` (menus, dialogs, hover) | app only |
| Borders | `#2A2A2C` / `#3F3F42` | same, plus `--control-border #78787C` at ≥ 3:1 | identical + app only |
| Dark inks | `#F5F5F5` / `#A3A3A3` / `#8C8C8C` | same | identical |
| Light theme | refused (one theme) | neutral `#F5F5F4` …; inks from the plate | app only |
| Plate | `#E9E5DD`, ink `#14120F`, legend `#5F5A52`, one per page, flat | same tokens; inverted in light; one per screen; `.card-plate` scope | identical + adapted use |
| Plate usage | a mat holding the board mock | the auth mat **and** a card being held | adapted |
| Three voices | Newsreader / Inter / JetBrains Mono, same `woff2` | same | identical |
| Serif | ≥ 24 px, weight 400, −0.015 to −0.025 em | `h1` 32, `h2` 24 | identical |
| Sans tracking | 0.02 / 0.04 / 0.05 em, tokens | same tokens | identical |
| Scale | display 76 … mono-sm 12 | `h1` 32 (= the site's `h2`), `h2` 24, `h3` 16, body 16, body-sm 14, label 13, mono 13, mono-sm 12 | adapted (no display; `h3` 16 for density) |
| Radii | 8 px surfaces, 4 px inline code, pills on controls | 8 px controls and surfaces, 4 px tags/cards/menu items, pills only on the avatar | adapted (pills are site-only) |
| Shadows | none, except the phone sheet | `--shadow-overlay` for what floats + the same sheet | adapted |
| Primary button | `--primary` fill, 44 high, one per zone | same, 32 high | adapted (size) |
| Ghost button | transparent, `--border-strong`, hover `--surface-2` | the `secondary` variant, same rules | identical |
| Focus | 2 px `--focus`, offset 2 | same | identical |
| Movement | `cubic-bezier(0.2,0,0,1)`, hover 140 ms, reveal 500 ms | same curve, hover 140, menus 180, entrance 320 | adapted (the site says it is slower than the app) |
| Icons | typographic (`→`, `×`), no library | `lucide-react`, 16 px, stroke 1.5 | adapted (imposed stack) |
| Header / logo | 72 / 24 | 56 / 24 | adapted / identical |
| Footer | yes (`Made with <3 by Wyliam`) | no (`AGENTS.md` §5) | site only |
| Hue | none; `--danger` as text | none; `--danger` as text and as the fill of the one delete confirm | adapted |
| Voice | sentence case, no emoji, no uppercase, no `!` | same | identical |
| Print | white, black ink, no plate | same | identical |

**Changes requested of the site** (repo `kluii/landing`, not this one): its board mock's cards at 4 px, its tags 20 px high at
4 px with `rounded: full` removed from the front matter, its front matter synced with its measured §2.1 table, one line saying
the app's plate is *held* rather than printed, and its column headers in `label` rather than `mono-sm`.
