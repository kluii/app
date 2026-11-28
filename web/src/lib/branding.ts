// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Applies instance branding through the same CSS custom properties the default
 * theme uses (DESIGN.md §2.4, §13). Clearing an accent removes the inline
 * overrides so the stylesheet defaults take over cleanly.
 */
import type { Branding } from '../api/types';

/**
 * The href `index.html` ships, read before branding can overwrite it: clearing
 * a `favicon_url` restores this rather than leaving the branded one in place.
 * A module script runs after the head is parsed, so the first icon link is
 * already in the document here.
 */
const DEFAULT_ICON_HREF =
  document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.getAttribute('href') ??
  '/favicon.ico';

/**
 * The first `rel="icon"` link — the `.ico` one — and never the
 * `rel="apple-touch-icon"` beside it, which is the iOS home-screen tile and
 * keeps the app's own icon.
 */
function iconLink(): HTMLLinkElement {
  const existing = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (existing) return existing;
  const link = document.createElement('link');
  link.rel = 'icon';
  document.head.appendChild(link);
  return link;
}

export function applyBranding(branding: Branding): void {
  const root = document.documentElement;
  if (branding.accent_color && branding.accent_foreground) {
    root.style.setProperty('--brand-accent', branding.accent_color);
    root.style.setProperty('--brand-accent-foreground', branding.accent_foreground);
    root.style.setProperty('--primary', branding.accent_color);
    root.style.setProperty('--primary-hover', branding.accent_color);
    root.style.setProperty('--primary-foreground', branding.accent_foreground);
    root.style.setProperty('--focus', branding.accent_color);
  } else {
    root.style.removeProperty('--brand-accent');
    root.style.removeProperty('--brand-accent-foreground');
    root.style.removeProperty('--primary');
    root.style.removeProperty('--primary-hover');
    root.style.removeProperty('--primary-foreground');
    root.style.removeProperty('--focus');
  }

  document.title = branding.tab_title ?? branding.instance_name;

  iconLink().href = branding.favicon_url ?? DEFAULT_ICON_HREF;
}
