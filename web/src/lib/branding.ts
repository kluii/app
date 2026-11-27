// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Applies instance branding through the same CSS custom properties the default
 * theme uses (DESIGN.md §2.4, §13). Clearing an accent removes the inline
 * overrides so the stylesheet defaults take over cleanly.
 */
import type { Branding } from '../api/types';

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

  if (branding.favicon_url) {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = branding.favicon_url;
  }
}
