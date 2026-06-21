import fs from 'node:fs';

import type { Session } from '../types.js';

const PERSONALITY_PLACEHOLDER = '{{PERSONALITY}}';
const PIONEER_PLACEHOLDER = '{{PIONEER_PROFILE}}';

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
 * personality and pioneer profile. Empty values fall back to neutral defaults so
 * the foreman is never handed an empty character.
 */
export function buildSystemPrompt(
  template: string,
  session: Pick<Session, 'personality' | 'pioneerProfile'>,
): string {
  const personality = session.personality.trim() || DEFAULT_PERSONALITY;
  const pioneerProfile = session.pioneerProfile.trim() || DEFAULT_PIONEER_PROFILE;
  return template
    .split(PERSONALITY_PLACEHOLDER)
    .join(personality)
    .split(PIONEER_PLACEHOLDER)
    .join(pioneerProfile);
}
