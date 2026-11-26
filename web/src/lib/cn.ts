// SPDX-License-Identifier: AGPL-3.0-only
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Class merge: a conditional class wins over the component's default. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
