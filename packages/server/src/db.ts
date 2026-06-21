import { PrismaClient } from '@prisma/client';

/**
 * Single shared Prisma client for the process. Prisma manages its own connection
 * pool, so one instance is reused across all requests.
 */
export const prisma = new PrismaClient();

/** Closes the database connection. Call on graceful shutdown. */
export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
