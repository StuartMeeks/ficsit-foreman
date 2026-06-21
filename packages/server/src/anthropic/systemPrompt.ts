import fs from 'node:fs';

import type { Session } from '../types.js';

const PERSONALITY_PLACEHOLDER = '{{PERSONALITY}}';
const PIONEER_PLACEHOLDER = '{{PIONEER_PROFILE}}';
const SUMMARY_PLACEHOLDER = '{{SESSION_SUMMARY}}';

const DEFAULT_PERSONALITY =
  'A professional, focused factory foreman. Direct, practical, and encouraging without waffle.';
const DEFAULT_PIONEER_PROFILE =
  'No pioneer profile captured yet. Assume a returning player; calibrate as you learn more.';

/**
 * Loads the foreman system prompt template. SYSTEM_PROMPT.md wraps the actual
 * prompt in a fenced code block; this extracts that block's contents. If no
 * fence is present the whole file is used. The template still contains the
 * {{PERSONALITY}} and {{PIONEER_PROFILE}} placeholders — substitution happens
 * per-request via {@link buildSystemPrompt}.
 */
export function loadSystemPromptTemplate(filePath: string): string {
  const raw = fs.readFileSync(filePath, 'utf8');
  const fenced = /```[a-zA-Z]*\n([\s\S]*?)```/.exec(raw);
  const template = fenced?.[1] ?? raw;
  return template.trim();
}

/**
 * Produces the final system prompt for a session by substituting its stored
 * personality, pioneer profile, and (if present) running session summary. Empty
 * personality/profile fall back to neutral defaults so the foreman is never
 * handed an empty character; an empty summary omits its block entirely.
 */
export function buildSystemPrompt(
  template: string,
  session: Pick<Session, 'personality' | 'pioneerProfile' | 'summary'>,
): string {
  const personality = session.personality.trim() || DEFAULT_PERSONALITY;
  const pioneerProfile = session.pioneerProfile.trim() || DEFAULT_PIONEER_PROFILE;
  const summary = session.summary?.trim() ?? '';
  const summaryBlock =
    summary.length > 0
      ? `\n## Session So Far\n\nA condensed record of what has happened earlier in this session, beyond the recent messages you can see:\n\n${summary}\n`
      : '';
  return template
    .split(PERSONALITY_PLACEHOLDER)
    .join(personality)
    .split(PIONEER_PLACEHOLDER)
    .join(pioneerProfile)
    .split(SUMMARY_PLACEHOLDER)
    .join(summaryBlock);
}
