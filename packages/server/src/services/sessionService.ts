import { randomUUID } from 'node:crypto';

import type { PrismaClient, Session as SessionRow } from '@prisma/client';

import type { ChatMessage, Session } from '../types.js';

/** Initial values when creating a session. Owned by the authenticated user. */
export interface CreateSessionInput {
  /** Owning user (Better Auth user id). */
  userId: string;
  /** Client-held session id. Generated if omitted. */
  id?: string;
  personality?: string;
  pioneerProfile?: string;
}

/** Patchable session fields. Takes effect on the next chat message. */
export interface UpdateSessionInput {
  personality?: string;
  pioneerProfile?: string;
}

/** Outcome of claiming a pre-accounts anonymous session for a user. */
export type ClaimResult =
  | { ok: true; session: Session }
  | { ok: false; reason: 'notFound' | 'owned' };

/**
 * Session lifecycle and message history. A session is the unit of identity in
 * Phase 2 (no user accounts) — its id is a client-held UUID. Personality and
 * pioneer profile are opaque freeform strings injected into the system prompt.
 */
export class SessionService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async create(input: CreateSessionInput): Promise<Session> {
    const row = await this.prisma.session.create({
      data: {
        id: input.id ?? randomUUID(),
        userId: input.userId,
        personality: input.personality ?? '',
        pioneerProfile: input.pioneerProfile ?? '',
      },
    });
    return rowToSession(row);
  }

  public async get(id: string): Promise<Session | undefined> {
    const row = await this.prisma.session.findUnique({ where: { id } });
    return row === null ? undefined : rowToSession(row);
  }

  /** All sessions owned by a user, most recently updated first. */
  public async listForUser(userId: string): Promise<Session[]> {
    const rows = await this.prisma.session.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(rowToSession);
  }

  /**
   * Ownership of a session without exposing it. Returns the owning user id
   * (null for an unclaimed pre-accounts session), or undefined if no such
   * session exists. Used by the ownership middleware.
   */
  public async findOwnerId(id: string): Promise<{ userId: string | null } | undefined> {
    const row = await this.prisma.session.findUnique({
      where: { id },
      select: { userId: true },
    });
    return row === null ? undefined : { userId: row.userId };
  }

  /**
   * Claims a pre-accounts anonymous session (userId still null) for a user, so
   * the browser's existing local session survives first sign-in. Idempotent if
   * the caller already owns it; refuses a session owned by someone else.
   */
  public async claim(id: string, userId: string): Promise<ClaimResult> {
    const row = await this.prisma.session.findUnique({ where: { id } });
    if (row === null) {
      return { ok: false, reason: 'notFound' };
    }
    if (row.userId !== null && row.userId !== userId) {
      return { ok: false, reason: 'owned' };
    }
    if (row.userId === userId) {
      return { ok: true, session: rowToSession(row) };
    }
    const updated = await this.prisma.session.update({ where: { id }, data: { userId } });
    return { ok: true, session: rowToSession(updated) };
  }

  public async update(id: string, patch: UpdateSessionInput): Promise<Session | undefined> {
    const existing = await this.prisma.session.findUnique({ where: { id } });
    if (existing === null) {
      return undefined;
    }
    const row = await this.prisma.session.update({
      where: { id },
      data: {
        personality: patch.personality ?? existing.personality,
        pioneerProfile: patch.pioneerProfile ?? existing.pioneerProfile,
      },
    });
    return rowToSession(row);
  }

  /** Appends a conversational turn to the session's history. */
  public async appendMessage(
    sessionId: string,
    role: ChatMessage['role'],
    content: string,
  ): Promise<void> {
    await this.prisma.message.create({ data: { sessionId, role, content } });
  }

  /**
   * The most recent `window` messages for a session, in chronological order.
   * History is windowed here so the chat request never carries the full log.
   */
  public async recentMessages(sessionId: string, window: number): Promise<ChatMessage[]> {
    const rows = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: window,
    });
    return rows
      .reverse()
      .map((row) => ({ role: row.role as ChatMessage['role'], content: row.content }));
  }

  /** Total number of stored messages for a session. */
  public async countMessages(sessionId: string): Promise<number> {
    return this.prisma.message.count({ where: { sessionId } });
  }

  /**
   * Messages that fall OUTSIDE the current window — everything except the most
   * recent `window`, in chronological order. This is the context the windowed
   * history can no longer see, and so the material the summary must preserve.
   */
  public async messagesBeforeWindow(sessionId: string, window: number): Promise<ChatMessage[]> {
    const total = await this.countMessages(sessionId);
    const olderCount = Math.max(0, total - window);
    if (olderCount === 0) {
      return [];
    }
    const rows = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: olderCount,
    });
    return rows.map((row) => ({ role: row.role as ChatMessage['role'], content: row.content }));
  }

  /** Stores (replaces) the session's running summary. */
  public async updateSummary(sessionId: string, summary: string): Promise<void> {
    await this.prisma.session.update({ where: { id: sessionId }, data: { summary } });
  }
}

function rowToSession(row: SessionRow): Session {
  const session: Session = {
    id: row.id,
    personality: row.personality,
    pioneerProfile: row.pioneerProfile,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  if (row.summary !== null && row.summary.length > 0) {
    session.summary = row.summary;
  }
  return session;
}
