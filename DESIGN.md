---
version: alpha
name: Klui
description: A monochrome, high-density work surface. Ink on near-black by default, ink on white in light. The accent is the ink itself; colour carries no brand meaning.
colors:
  canvas: "#0C0C0C"
  surface: "#121212"
  surface-2: "#171717"
  surface-muted: "#1C1C1C"
  column: "#111111"
  card: "#191919"
  border: "#2A2A2A"
  border-strong: "#3D3D3D"
  control-border: "#6B6B6B"
  ink: "#F2F2F2"
  ink-muted: "#A6A6A6"
  ink-subtle: "#8A8A8A"
  primary: "#F5F5F5"
  primary-hover: "#FFFFFF"
  primary-foreground: "#0C0C0C"
  danger: "#F87171"
  focus: "#FAFAFA"
  selection: "#262626"
typography:
  display:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  h1:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  h2:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  h3:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0em"
  body:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0em"
  label:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.01em"
  mono:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0em"
  mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "0.02em"
rounded:
  sm: 4px
  md: 8px
spacing:
  "1": 4px
  "2": 8px
  "3": 12px
  "4": 16px
  "5": 20px
  "6": 24px
  "8": 32px
  "10": 40px
  "12": 48px
  "16": 64px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    height: 32px
    padding: 12px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.sm}"
    height: 32px
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    height: 32px
    padding: 12px
  button-ghost:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    height: 32px
    padding: 8px
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    height: 32px
    padding: 12px
  input:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    height: 32px
    padding: 8px
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: 12px
  column:
    backgroundColor: "{colors.column}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: 8px
    width: 288px
  chip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.mono-sm}"
    rounded: "{rounded.sm}"
    height: 20px
    padding: 6px
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: 20px
  popover:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 8px
  avatar:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.mono-sm}"
    rounded: "{rounded.sm}"
    size: 24px
  banner:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: 12px
  divider:
    backgroundColor: "{colors.border}"
    height: 1px
  divider-strong:
    backgroundColor: "{colors.border-strong}"
    height: 1px
  focus-ring:
    backgroundColor: "{colors.focus}"
    rounded: "{rounded.sm}"
    size: 2px
  selection:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.ink}"
  placeholder:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-subtle}"
    typography: "{typography.body-sm}"
  control-outline:
    backgroundColor: "{colors.control-border}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: 1px
  checkbox-checked:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.sm}"
    size: 16px
---

# Klui — Design System

This file is the single source of truth for how Klui looks and behaves. A component that disagrees with it is wrong, even if it looks fine. A token that is not here does not exist.

The front matter is the **dark theme**, which is the default. The light theme is the same system with a different set of values, listed in §2.2 — not a second design.

---

## 1. Overview

Klui is a tool people keep open for six hours. The interface must survive that: quiet surfaces, one strong contrast relationship (ink on ground), no decoration competing with the work. Density is a feature; emptiness is a bug unless it is an empty state.

Three principles, in order:

1. **The work is the only colour.** Dark is monochrome near-black; light is white. There is no accent hue: the accent *is* the ink, used as fill for the single primary action and as the focus ring. A colourful kanban looks like a toy; a monochrome one looks like a tool.
2. **Structure over ornament.** Separation comes from surface steps (canvas → column → card) and hairline borders, not shadows, glows or gradients. If a boundary needs a shadow to be seen, the surface step is wrong.
3. **Every state is drawn.** Hover, active, focus, selected, disabled, loading, empty, error, read-only and pending each have a defined treatment. A control with no visible disabled state is a control someone will click.

**What this system refuses:** emoji in the interface, icon fonts, filled icon sets, gradients, glassmorphism, coloured dark mode, pale tinted light mode, pill shapes, three font families, animated illustrations, hero blocks inside the app.

---

## 2. Colors

### 2.1 Dark theme (default)

Measured with WCAG 2.1 relative luminance against each surface the token can sit on. Numbers below are measured, not estimated; the CI contrast test re-measures them from `tokens.css`.

| Token | Value | Role | Measured |
|---|---|---|---|
| `--canvas` | `#0C0C0C` | App ground, board background | — |
| `--column` | `#111111` | Column well | 1.04 vs canvas |
| `--card` | `#191919` | Card surface | 1.11 vs canvas |
| `--surface` | `#121212` | Popovers, dialogs, panels | 1.05 vs canvas |
| `--surface-2` | `#171717` | Inputs, chips, hover fill | 1.06 vs canvas |
| `--surface-muted` | `#1C1C1C` | Inset blocks, table head, selected row | 1.09 vs canvas |
| `--border` | `#2A2A2A` | Hairline seam (decorative) | 1.22 vs card, 1.32 vs column |
| `--border-strong` | `#3D3D3D` | Divider that must read | 1.57 vs `--surface-muted` |
| `--control-border` | `#6B6B6B` | Input and control boundary | 3.52 vs `--surface`, 3.67 vs canvas |
| `--ink` | `#F2F2F2` | Primary text | 17.47 / 16.73 / 16.01 / 15.22 (canvas / surface / surface-2 / muted) |
| `--ink-muted` | `#A6A6A6` | Secondary text, labels | 8.04 / 7.70 / 7.36 / 7.00 |
| `--ink-subtle` | `#8A8A8A` | Metadata, timestamps, placeholders | 5.67 / 5.43 / 5.19 / 4.94 |
| `--primary` | `#F5F5F5` | Primary fill | 17.94 with `--primary-foreground` |
| `--primary-foreground` | `#0C0C0C` | Text on primary fill | 17.94 |
| `--danger` | `#F87171` | Destructive label, error text | 7.07 / 6.77 / 6.48 / 6.16 |
| `--focus` | `#FAFAFA` | Focus ring | 18.74 vs canvas |
| `--selection` | `#262626` | Text selection, drag-target tint | 1.20 vs canvas |

Rules:

- `--danger` and the tag palette are the only chromatic values. `--danger` appears on destructive labels, error text and the destructive confirm button; it never decorates, never fills a surface at full opacity, and is never used as a "success" substitute. Tag hues appear only inside a tag chip (§2.3) and never as a surface, a border of a container, or a text colour.
- There is no success colour. Success is a filled tick, a neutral toast, or the absence of an error.
- Text contrast is never measured against `--canvas` alone. Chips sit on `--surface-2`, metadata sits on `--column`, dialogs sit on `--surface`. The gate measures every text token against **all four** surfaces.
- Borders are decorative seams: 1.2–1.8 is intentional and reads as a hairline. Anything a user must perceive as an interactive boundary (input, checkbox, focused control) uses `--control-border` at ≥ 3:1.

### 2.2 Light theme (`[data-theme="light"]`)

| Token | Value | Measured |
|---|---|---|
| `--canvas` | `#FFFFFF` | — |
| `--column` | `#F1F1F1` | 1.13 vs white card |
| `--card` | `#FFFFFF` | 18.42 ink |
| `--surface` | `#FFFFFF` | — |
| `--surface-2` | `#F7F7F7` | inputs, chips, hover |
| `--surface-muted` | `#F2F2F2` | inset blocks, table head |
| `--border` | `#D8D8D8` | 1.26 vs column, 1.43 vs white |
| `--border-strong` | `#B8B8B8` | 1.76 vs column |
| `--control-border` | `#767676` | 4.54 vs white, 4.24 vs `surface-2` |
| `--ink` | `#141414` | 18.42 / 18.42 / 17.20 / 16.46 |
| `--ink-muted` | `#5C5C5C` | 6.69 / 6.69 / 6.24 / 5.97 |
| `--ink-subtle` | `#6E6E6E` | 5.10 / 5.10 / 4.76 / 4.55 |
| `--primary` | `#141414` | inverted action |
| `--primary-hover` | `#000000` | |
| `--primary-foreground` | `#FFFFFF` | 18.42 |
| `--danger` | `#B42318` | 6.57 / 6.57 / 6.14 / 5.87 |
| `--focus` | `#141414` | 18.42 vs white |
| `--selection` | `#E8E8E8` | |

Rules:

- The light theme is **white**, not tinted. No pale blue, green, cream or lavender surfaces — ever. Neutral gray is the only non-white surface.
- A white card on a gray column must be separated by `--border` **and** the column must be dark enough to read as a well (`#F1F1F1`). A card on a `#F5F5F5` column was reviewed and rejected as a washed-out block.
- The primary action is a black fill with white text. Hover darkens to `#000000`; it never becomes a coloured button.
- Theme is applied before React mounts by an inline bootstrap reading `localStorage.klui-theme` then `prefers-color-scheme`. A light user must never see a dark frame.

### 2.3 Tag colours

Tags are the **one** place where a user chooses a colour, because a tag is the user's own vocabulary: a client, a priority, a surface. The interface stays monochrome; the vocabulary is theirs.

A tag chip is built from one stored hex (`CardTag.color`, falling back to the board default in `BoardTagColor`), and the rendering is constrained so no hue can break readability:

```css
--tag-tint: 18%;                                   /* dark */
--tag-bg:   color-mix(in srgb, var(--tag) var(--tag-tint), var(--card));
--tag-line: color-mix(in srgb, var(--tag) 45%, var(--border));
/* light theme */
--tag-tint: 12%;
--tag-bg:   color-mix(in srgb, var(--tag) var(--tag-tint), #FFFFFF);
```

- The label is `--ink`, never the tag colour. The tint is capped, so the chip stays a surface with a hue, not a saturated block.
- Measured worst case over all hues, using an sRGB mix: **8.98:1** in dark (white tag) and **13.96:1** in light (black tag). Any hex is therefore safe, and the contrast test asserts the two extremes rather than 16 million colours.
- The chip also carries a 1 px `--tag-line` border and a 3 px full-colour leading bar, so a muted hue (slate, gray) still reads as "this tag has a colour" at a glance.
- Neutral tags (no colour anywhere) render on `--surface-2` with `--border`, and are visually quieter than any coloured tag. That is the incentive to colour your vocabulary, not a penalty.
- No hash-to-hue function, no automatic colour assignment: a colour is chosen, or it is absent. Two tags with the same name on two cards may legitimately differ (card override wins).

Palette offered in the picker (both sets live in `tokens.css`; the picker shows the theme's values):

| Token | Dark | Light |
|---|---|---|
| `--tag-slate` | `#94A3B8` | `#64748B` |
| `--tag-gray` | `#A1A1AA` | `#71717A` |
| `--tag-red` | `#F87171` | `#DC2626` |
| `--tag-orange` | `#FB923C` | `#EA580C` |
| `--tag-amber` | `#FBBF24` | `#D97706` |
| `--tag-lime` | `#A3E635` | `#65A30D` |
| `--tag-green` | `#4ADE80` | `#16A34A` |
| `--tag-teal` | `#2DD4BF` | `#0D9488` |
| `--tag-sky` | `#38BDF8` | `#0284C7` |
| `--tag-blue` | `#60A5FA` | `#2563EB` |
| `--tag-violet` | `#A78BFA` | `#7C3AED` |
| `--tag-pink` | `#F472B6` | `#DB2777` |

The picker is twelve swatches plus a hex field. There is no free colour wheel, no opacity slider, no gradient.

### 2.4 Instance branding

- Instance branding can set exactly one accent (`--brand-accent`) and only when it passes the AA gate at save time; the accent feeds links, focus and the primary action *inside the admin's instance*, never the dark monochrome ground. If the accent fails, the save is rejected with the measured ratio.

---

## 3. Typography

Two families, no exceptions:

- **Inter** — all interface text. Loaded as a variable font, weights 400 / 500 / 600 only.
- **JetBrains Mono** — metadata, counts, dates, ids, keyboard shortcuts, ASCII accents, code, the activity log timestamps. Never body prose, never headings.

| Token | Size / line / weight / tracking | Use |
|---|---|---|
| `display` | 32 / 1.15 / 600 / -0.02em | Auth pages, close-out title, 404 |
| `h1` | 24 / 1.25 / 600 / -0.015em | Page title (boards index, board name) |
| `h2` | 18 / 1.3 / 600 / -0.01em | Section, dialog title |
| `h3` | 15 / 1.4 / 600 / 0 | Card title in the read modal, settings group |
| `body` | 14 / 1.5 / 400 | Default text, descriptions, inputs |
| `body-sm` | 13 / 1.45 / 400 | Card title in the board, dense rows, popover items |
| `label` | 12 / 1.3 / 500 / 0.01em | Buttons, field labels, tabs, chips with words |
| `mono` | 12 / 1.4 / 400 | Counts, dates, ids, shortcuts |
| `mono-sm` | 11 / 1.35 / 400 / 0.02em | Chips, metadata under a card, keyboard hints |

Rules:

- **No uppercase tracking-wide eyebrows.** A section label is `label` in `--ink-muted`, sentence case. Letter-spaced capitals are the single most generic tell of an AI-built app.
- Numerals in tables, counts and dates use `font-variant-numeric: tabular-nums`.
- Line length caps at 72 characters in prose blocks (card descriptions, docs inside the app, close-out summary).
- Card titles clamp to 3 lines on the board and are never truncated in the read modal.
- Column titles **wrap fully** — never clamp, never ellipsis. The contract caps a column name at 64 characters, so wrapping cannot break layout. Verify with `scrollWidth === clientWidth` plus the measured height.
- No italic for emphasis in UI. Use weight 500 or `--ink` on `--ink-muted`.
- French copy uses the typographic apostrophe (’) and non-breaking spaces before `:` `;` `!` `?` `»` and after `«`.

---

## 4. Layout

**Grid.** A single 12-column fluid grid with a maximum content width of 1440 px. Page gutters: 24 px ≥ 1024 px, 16 px below. Nothing is centred inside the app except auth cards (max 380 px) and the 404 block.

**App shell.** Top bar 48 px, `--canvas` ground, `--border` bottom hairline, no shadow. Left: wordmark (24 px tall) then breadcrumb. Right: primary action, then the account menu (24 px avatar). No sidebar in 2.0 — the board is the page.

**Density.** Control height 32 px (28 compact, 36 large). Row height 36 px. Card padding 12 px. Board gutter 16 px. Nothing stretches to fill vertical space; columns size to their content (`align-items: flex-start`).

**Spacing scale.** 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64. Only these values. A one-off `margin: 13px` is a defect.

**Board geometry.**
- Column width: 288 px, fixed. Gap: 16 px. Column padding: 8 px. 8 px inner gutter between cards.
- Column header: 32 px, title `body-sm` weight 500, wrap allowed, `--ink`, action menu on hover/focus.
- Card: min-height 56 px, `--card`, 1 px `--border`, radius 4 px, padding 12 px, title `body-sm` weight 500, metadata row `mono-sm` in `--ink-subtle`.
- Drag ghost: same width as the card at rest (288 − 16 = 272 px), 1 px `--border-strong`, `--card` fill, radius 4 px, 2 % scale, no rotation, no shadow beyond the overlay token.
- Insertion line: 2 px `--ink`, radius 0, full column width minus padding. It is an affordance only — never a hit target.

**Breakpoints.** 390 (phone) / 640 (large phone, modal becomes a sheet) / 768 (tablet) / 1024 (desktop) / 1440 (wide). At < 768 the board scrolls horizontally with snap (`scroll-snap-type: x mandatory`, column `scroll-snap-align: start`), headers stick to the top of the rail, and the page itself never scrolls horizontally.

**Touch.** Coarse pointers get 40 px minimum hit targets, regardless of the visible control size. Hit area never smaller than 40 × 40 even when the icon is 16 px.

---

## 5. Elevation & Depth

Depth is a **surface step plus a border**, not a shadow.

| Level | Token | Used for |
|---|---|---|
| 0 | `--canvas` | App ground, board |
| 1 | `--column` | Column well |
| 2 | `--card` | Cards, list rows |
| 3 | `--surface` | Popovers, dropdowns, dialogs |
| 4 | `--surface-2` | Inputs, hover fills, chips |

- One shadow exists in the system, for overlays only: `0 8px 24px rgba(0,0,0,0.48)` in dark, `0 8px 24px rgba(16,16,16,0.10)` in light, always paired with a 1 px `--border`. Never on a resting card, never on a button, never on a column.
- No inner shadows, no glows, no `box-shadow` stacks, no `backdrop-filter`.
- Modal scrim: `rgba(0,0,0,0.64)` dark, `rgba(16,16,16,0.32)` light, no blur.
- Drag overlay is the only element allowed to sit above the scrim besides the dialog itself.

---

## 6. Shapes

- Radii: **4 px** (`--radius-sm`) and **8 px** (`--radius-md`). Nothing else. No `9999px`, no circles except the avatar (4 px square with initials) and status dots (6 px).
- Buttons, inputs, cards, chips, tags, menu items, toasts: 4 px.
- Columns, dialogs, popovers, panels, sheets: 8 px.
- Borders are always 1 px. A 2 px border exists only as the focus ring and the drag insertion line.
- No decorative shapes, no corner flourishes, no angled cuts, no notched cards.

---

## 7. Components

Every component is a shadcn copy-in under `web/src/components/ui/`, restyled once to these tokens. Variants live in the component; a per-screen override is a defect.

**Button.** Height 32 (28 `/sm`, 36 `/lg`), padding 0 12, `label` typography, radius 4, gap 6 with a 16 px icon.
- `primary`: `--primary` fill, `--primary-foreground` text. Exactly one per view region. Hover `--primary-hover`; active 1 px inset translate of 1 px; disabled 40 % opacity and `cursor: not-allowed`.
- `secondary`: `--surface-2` fill, `--border`, `--ink` text. The default for most actions.
- `ghost`: transparent, `--ink-muted` text, `--surface-2` fill on hover. Icon-only buttons use ghost with an accessible label.
- `danger`: `--danger` fill only in the confirm step of a destructive dialog; otherwise a ghost button with `--danger` text.
- `link`: `--ink` text underlined on hover only, 4 px underline offset.

**Input / textarea / select.** `--surface-2` fill, 1 px `--control-border`, radius 4, height 32 (textarea auto, min 72). Placeholder `--ink-subtle`. Focus: `--control-border` becomes `--focus`, plus a 2 px `--focus` ring at 2 px offset. Invalid: `--danger` border and a `label` message with the code's hint. No floating labels, no inner icon unless it is a search glyph.

**Card.** `--card`, 1 px `--border`, radius 4, padding 12. Title `body-sm` weight 500 `--ink`, max 3 lines. Metadata row `mono-sm` `--ink-subtle`: due date, assignee initial, tag chips. Hover raises the border to `--border-strong`; no lift, no shadow. Done: title `line-through` in `--ink-subtle`, tick filled and visible; the tick does not render at all when the card is not done.

**Column.** `--column`, radius 8, padding 8, width 288, min-height 120. Header 32 px with title and a ghost overflow button. Body is a vertical stack with 8 px gaps. Empty column shows a single `body-sm` `--ink-subtle` line explaining why it is empty (no icon, no illustration).

**Chip (metadata, filter).** Height 20, `mono-sm`, `--surface-2` fill, 1 px `--border`, radius 4, padding 0 6. Active filter chip: `--ink` fill, `--primary-foreground` text, with a 12 px remove glyph.

**Tag chip.** Same geometry as a chip, with the tag's colour: `--tag-bg` tint, `--tag-line` border, `--ink` label, 3 px full-colour leading bar (inside the 6 px padding, radius 1 px). Neutral tags use `--surface-2` / `--border` and no bar. The tag editor shows the 12 swatches plus a hex field; changing a colour is a single `PATCH /cards/:id` and appears on that card only, with "Apply to all cards using this tag" offered as a second, explicit action (it writes the board default).

**Dialog.** `--surface`, radius 8, padding 20, max width 560 (card read: 640), 1 px `--border`, overlay scrim, title `h2`, description `body-sm` `--ink-muted`, actions right-aligned with the primary last. Focus trap, `Esc` closes, focus returns to the trigger. No close glyph on the top-right when a Cancel button exists.

**Popover / dropdown.** `--surface`, radius 8, padding 4, 1 px `--border`, item height 32, `body-sm`, hover `--surface-2`, destructive item in `--danger`. Max height 320 with internal scroll.

**Toast.** Bottom-left, `--surface`, 1 px `--border`, radius 8, padding 12, `body-sm`, auto-dismiss 5 s, one action max. Never more than one visible; a second replaces the first.

**Done tick.** 16 px box, 1 px `--control-border`, radius 4. Checked: `--ink` fill, `--primary-foreground` glyph, no animation beyond a 120 ms opacity. On a read-only board it renders as a static mark, not a disabled control.

**Avatar.** 24 px, `--surface-muted`, radius 4, initials in `mono-sm`, `--ink-muted`. Anonymous actors render initials from their display name with a dashed `--border` outline. Agents render the same shape with a `mono-sm` label of their key name.

**Banner.** `--surface-2`, 1 px `--border`, radius 4, padding 12, `body-sm`. Used for moderation notices, read-only explanations and degraded states. No coloured variants; an error banner uses `--danger` text and a `--danger` left border of 2 px.

**Empty state.** Centred, max 320 px: `h3` line, one `body-sm` `--ink-muted` explanation, one action at most. No illustration, no emoji, no ASCII art except the loading skeleton (see §8.4).

**Table / list row.** 36 px, 1 px `--border` bottom, `body-sm`, hover `--surface-2`, selected `--surface-muted`, numeric columns right-aligned with tabular numerals.

---

## 8. Do's and Don'ts

**Do**

- Use one primary button per region; everything else is secondary or ghost.
- Let the surface step carry hierarchy before adding a border, and the border before adding text weight.
- Put counts, dates and shortcuts in mono — it is how the interface signals "machine fact" versus "human sentence".
- Draw disabled, loading and read-only states explicitly.
- Keep the board quiet: no count badges on columns, no coloured strips, no shadows. The only colour on a board is the tag chips.
- Test at 390 px before calling a screen done.

**Don't**

- Don't use emoji, anywhere, including empty states, toasts, seeded data and commit copy rendered in the activity feed.
- Don't introduce a second accent, a gradient, a glow, a glass panel or a coloured dark surface.
- Don't clamp a column title, don't ellipsis a card title in the read modal, don't hide a permission you cannot act on behind a disabled control — remove it.
- Don't add icons to satisfy a layout gap. An icon earns its place by carrying meaning a word cannot.
- Don't use uppercase micro-labels, eyebrow text, index numbers or "01 / 02 / 03" decoration.
- Don't use pills, oversized radii, floating action buttons or a card inside a card inside a card.
- Don't let a tag colour become a background block: the tint is capped, the label is ink, and a hue never fills a surface larger than a chip.
- Don't write a hex value in a component, a `style={{color: ...}}`, or a Tailwind arbitrary colour (`text-[#fff]`).

---

## 9. Motion

- Durations: 120 ms (hover, press, tick), 160 ms (popover, dropdown, tooltip), 220 ms (dialog enter/exit), 240 ms (sheet). Nothing longer.
- Easing: `cubic-bezier(0.2, 0, 0, 1)` for entrances, `cubic-bezier(0.4, 0, 1, 1)` for exits. No bounce, no spring, no overshoot.
- Only these properties animate: `opacity`, `transform`, `background-color`, `border-color`, `color`. Never `height`, `width`, `top`, `left`, `box-shadow`.
- Drag has no CSS animation: the card follows the pointer, the placeholder holds the space, the overlay settles in 120 ms on drop.
- `prefers-reduced-motion: reduce` sets every duration to 0 ms and replaces the loading skeleton with a static frame plus `aria-busy`. Every animation must have a static frame that still conveys the state.

---

## 10. Iconography

- One family: **Lucide**, stroke 1.5 px, `currentColor`, no filled variants. Sizes 16 (inline with `label`), 18 (toolbar), 20 (empty states), 24 only in the 404 block.
- An icon is either meaningful or absent. No icon in front of a heading, no icon on every list row, no decorative icon cluster.
- Icon-only buttons always carry `aria-label` and a tooltip on hover/focus after 400 ms.
- Icons never replace a word where the word is the affordance ("Save", not a floppy disk).
- The keyboard hint glyph is the mono character `⌘` / `Ctrl` / `↵` / `Esc` set in `mono-sm`, not an icon.
- No emoji, no ASCII art in the interface except the loading skeleton (§14), no third-party animated-art library.

---

## 11. Voice and copy

- Sentence case everywhere. No Title Case In Buttons.
- Verbs for actions: "Create board", "Move card", "Close project". Not "Submit", not "OK".
- Short, concrete, no exclamation marks, no "Oops", no "Whoops", no "Successfully".
- Errors say what happened, what to do, and nothing else: "This board changed while you were editing. Reload to see the current version." A hint field may name the fix; it never apologises.
- Permission copy is honest about what the visitor can do: "Read-only link" / "You can edit" / "Your changes are visible to the board owner once approved."
- Empty states explain the mechanism, not the emotion: "No cards yet. Press C to add the first one." (The shortcut is real; if it is not implemented, do not print it.)
- No marketing language inside the app. The word "powerful" does not appear in the product.
- All strings come from i18n catalogs. English is the source; French ships in 2.0.

---

## 12. Accessibility

Non-negotiable, and gated in CI:

- Body text ≥ 4.5:1 against the surface it actually sits on; large text and links ≥ 3:1; interactive boundaries (inputs, checkboxes) ≥ 3:1 against their surroundings.
- Every interactive element is reachable and operable by keyboard, in DOM order, with a visible 2 px focus ring at 2 px offset using `--focus`.
- Focus is trapped in dialogs, restored to the trigger on close, and never lost on a mutation.
- Live regions announce mutations: a moved card, an approved pending card, a failed save.
- The board is fully usable without a mouse: lift with `Space`, move with arrows, drop with `Space`, cancel with `Esc`.
- No information conveyed by colour alone. Done is a tick plus a strikethrough; pending is a label, not a tint.
- Every image has an alt; every icon-only control has an accessible name; every form field has a visible label (a placeholder is not a label).
- `lang` is set per locale; `dir` is `ltr` in 2.0.

---

## 13. Assets and identity

The repository ships `assets/light-logo.png` and `assets/dark-logo.png`. **The file name describes the ink, not the theme** — this is a trap:

| File | Ink | Use on |
|---|---|---|
| `assets/light-logo.png` | `#FFFFFF` | dark surfaces (`--canvas`, `--column`) |
| `assets/dark-logo.png` | `#0C0C0C` | light surfaces (white canvas) |

- Both are 1:1 square PNG with transparent background and contain the wordmark "Klui".
- Render height: 24 px in the app bar, 32 px on auth pages, 48 px on the 404 and close-out pages. Never scale below 20 px or above 64 px.
- Clear space: half the logo height on every side. Never place it on a busy surface, never inside a bordered box, never recolour it, never add a shadow or outline.
- Favicon: derive from the logo matching the theme's ground; ship both and switch with the theme.
- The instance admin may upload a different logo and set an accent (§2.3). Everything else — type, spacing, radii, density, motion, layout — is not themeable. That is what keeps the product recognisable under a company's brand.
- Defaults are served through the same variables as a branded instance. "Unbranded" is not a code path.

---

## 14. Loading, empty and error states

- **Skeleton:** an ASCII board skeleton drawn in `mono-sm` with `--ink-subtle` on `--surface-2`, three columns of dimmed glyph blocks. It appears after 200 ms of pending state, never before (a flash of skeleton is worse than a blank column).
- **Short waits:** a braille spinner in mono (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`), one character, `aria-label` on a `role="status"` wrapper.
- **Long operations** (import, export, close-out): an ASCII progress bar in mono, width 32 characters, with the percentage right-aligned in `tabular-nums`.
- All three are home-grown JSX text in the app's mono font — no canvas, no third-party player, no image. They inherit tokens and repaint on theme change.
- **Empty states** follow §7 (`Empty state`) and §11 (voice). A filtered board with no matches says `{shown} of {total}` and offers "Clear filters"; it never pretends the board is empty.
- **Errors** are inline where the action failed, with the error code available in a `title` or a details row for support, never a raw stack trace. A failed mutation leaves the UI in the last confirmed server state and says so.

---

## 15. Implementation notes (for the coding agent)

- Tokens live in `web/src/styles/tokens.css` as CSS custom properties, two sets: `:root` (dark) and `[data-theme="light"]`. shadcn consumes the same variables through the Tailwind `@theme inline` mapping. Product tokens beyond shadcn's set: `--column`, `--card`, `--surface-muted`, `--control-border`, `--selection`, `--insert-line`, `--tag-*` (12 hues × 2 themes) and `--tag-tint`.
- Tailwind config maps every token; no arbitrary values (`w-[272px]` is a defect, `w-card` is not). Define the three off-scale sizes that are genuinely needed (272 card width, 288 column width, 560 dialog width) as named theme values.
- The theme bootstrap is a three-line inline script in `index.html`, before the bundle: read `localStorage`, else `prefers-color-scheme`, set `data-theme` on `<html>`. It is the only inline script and it needs a CSP hash.
- The only allowed inline style in the app is `style={{ '--tag': color }}` on a tag chip (and its `--tag-tint` sibling): it sets a custom property from data, never a colour property. A `style={{ color: … }}` anywhere is a defect.
- A lint rule rejects hex, `rgb()`, `hsl()` and Tailwind arbitrary colours outside `tokens.css` (and outside `server/` templates that render email or OG images, which have their own embedded palette — those live in `server/src/og/palette.ts` and are the same values).
- Contrast is tested by parsing both token sets from `tokens.css` (do not duplicate the values in the test), computing WCAG ratios, and asserting `--ink`, `--ink-muted`, `--ink-subtle`, `--danger` and `--primary-foreground` against each of `--canvas`, `--column`, `--card`, `--surface`, `--surface-2`, `--surface-muted`, plus `--control-border` against `--canvas` and `--surface-2` at ≥ 3:1.
- A second test asserts the board geometry: column width, card padding, radius values and the `items-start` alignment (a sparse column must not stretch to its tallest sibling).
- A third test asserts the tag chip bound: for a pure white tag in dark and a pure black tag in light, the mixed chip background keeps `--ink` at ≥ 4.5:1 (the measured worst cases are 8.98:1 and 13.96:1 with the documented mix percentages; the test recomputes them from the CSS values, so changing the percentage fails the gate).
