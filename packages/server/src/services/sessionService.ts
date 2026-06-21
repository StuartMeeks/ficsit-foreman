import { randomUUID } from 'node:crypto';

import type { PrismaClient, Session as SessionRow } from '@prisma/client';

import type { ChatMessage, Session } from '../types.js';

/** Optional initial values when creating a session. */
export interface CreateSessionInput {
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
