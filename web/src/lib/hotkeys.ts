// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The only file allowed to import `@tanstack/react-hotkeys` (D-49). The wrapper
 * keeps the beta dependency to one surface: a swap touches this file.
 */
import { useHotkeys, type RegisterableHotkeyChord } from '@tanstack/react-hotkeys';

export type Hotkey = {
  /** A single key such as `n`, or a modified key such as `ctrl+enter`. */
  key: string;
  handler: (event: KeyboardEvent) => void;
  /** Skip while an input, textarea or dialog has focus. */
  ignoreInputs?: boolean;
  enabled?: boolean;
};

export function useShortcuts(hotkeys: Hotkey[]): void {
  useHotkeys(
    hotkeys.map((hotkey) => ({
      // The wrapper takes a plain string; every call site writes a literal chord
      // such as `n` or `Mod+Enter`, and the manager rejects a malformed one.
      hotkey: hotkey.key as RegisterableHotkeyChord,
      callback: (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null;
        const typing =
          target instanceof HTMLElement &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable);
        if (hotkey.ignoreInputs !== false && typing) return;
        if (hotkey.enabled === false) return;
        hotkey.handler(event);
      },
    })),
  );
}
