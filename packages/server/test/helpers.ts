import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface TestDb {
  prisma: PrismaClient;
  cleanup: () => Promise<void>;
}

/**
 * Spins up an isolated SQLite database in a temp directory, applies the schema
 * with `prisma db push`, and returns a client pointed at it. Each test file gets
 * its own database file so suites do not interfere with one another.
 */
export async function createTestDb(): Promise<TestDb> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-srv-test-'));
  const url = `file:${path.join(dir, 'test.db')}`;
  execSync('npx prisma db push', {
    cwd: packageRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  const adapter = new PrismaBetterSqlite3({ url });
  const prisma = new PrismaClient({ adapter });
  return {
    prisma,
    cleanup: async (): Promise<void> => {
      await prisma.$disconnect();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Inserts a Better Auth user row directly, returning its id. Service-level tests
 * need a real owner to satisfy the `Session.userId` foreign key without going
 * through the HTTP auth flow.
 */
export async function createTestUser(
  prisma: PrismaClient,
  email = `user-${randomUUID()}@test.local`,
): Promise<string> {
  const user = await prisma.user.create({
    data: { id: randomUUID(), name: 'Test User', email, emailVerified: true },
  });
  return user.id;
}
