// SPDX-License-Identifier: AGPL-3.0-only
import { createDb, type Db } from '../../src/db.js';

export const TEST_SCHEMA = 'klui_test_suite';

export function testDatabaseUrl(): string {
  const base = process.env.DATABASE_URL ?? 'postgresql://klui:klui@127.0.0.1:5432/klui_test';
  return `${base}${base.includes('?') ? '&' : '?'}schema=${TEST_SCHEMA}`;
}

export function testDb(): Db {
  return createDb(testDatabaseUrl());
}
