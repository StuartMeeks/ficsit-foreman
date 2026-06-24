import { fromNodeHeaders } from 'better-auth/node';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { Auth, AuthUser } from '../auth.js';
import type { SessionService } from '../services/sessionService.js';

declare global {
  namespace Express {
    interface Request {
      /** The authenticated user, populated by {@link requireAuth}. */
      user?: AuthUser;
    }
  }
}

/**
 * Rejects unauthenticated requests. Resolves the Better Auth session from the
 * request's cookies and attaches the user to `req.user`; responds 401 when no
 * valid session is present. Mount on the protected `/api/*` routers (not on
 * `/api/auth/*`, which Better Auth owns, nor `/health`).
 */
export function requireAuth(auth: Auth): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    auth.api
      .getSession({ headers: fromNodeHeaders(req.headers) })
      .then((session) => {
        if (session?.user === undefined || session.user === null) {
          res.status(401).json({ error: 'Authentication required.' });
          return;
        }
        req.user = session.user;
        next();
      })
      .catch(next);
  };
}

/**
 * Guards a session-scoped route: the authenticated user must own the session
 * named by `:sessionId`. A missing session is 404; a session owned by someone
 * else (or not yet claimed) is 403. Must run after {@link requireAuth}.
 */
export function requireSessionOwnership(sessions: SessionService): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userId = req.user?.id;
    if (userId === undefined) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId : '';
    sessions
      .findOwnerId(sessionId)
      .then((ownership) => {
        if (ownership === undefined) {
          res.status(404).json({ error: 'Session not found.' });
          return;
        }
        if (ownership.userId !== userId) {
          res.status(403).json({ error: 'Forbidden.' });
          return;
        }
        next();
      })
      .catch(next);
  };
}
