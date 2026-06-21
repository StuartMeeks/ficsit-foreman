import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildSystemPrompt, loadSystemPromptTemplate } from '../src/anthropic/systemPrompt.js';

function tempPrompt(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-prompt-'));
  const file = path.join(dir, 'SYSTEM_PROMPT.md');
  fs.writeFileSync(file, contents);
  return file;
}

describe('loadSystemPromptTemplate', () => {
  it('extracts the fenced code block, dropping surrounding markdown', () => {
    const file = tempPrompt('# Heading\n\nintro\n\n```\nYou are the Foreman {{PERSONALITY}}.\n```\n\nNotes after.');
    const template = loadSystemPromptTemplate(file);
    expect(template).toBe('You are the Foreman {{PERSONALITY}}.');
  });

  it('falls back to the whole file when there is no fence', () => {
    const file = tempPrompt('Plain prompt with {{PIONEER_PROFILE}}.');
    expect(loadSystemPromptTemplate(file)).toBe('Plain prompt with {{PIONEER_PROFILE}}.');
  });
});

describe('buildSystemPrompt', () => {
  const template =
    'Personality: <p>{{PERSONALITY}}</p> Pioneer: <q>{{PIONEER_PROFILE}}</q>{{SESSION_SUMMARY}}## Authority';

  it('substitutes both placeholders from session state', () => {
    const result = buildSystemPrompt(template, { personality: 'Gruff', pioneerProfile: 'Veteran' });
    expect(result).toContain('Personality: <p>Gruff</p> Pioneer: <q>Veteran</q>');
    expect(result).not.toContain('{{');
  });

  it('falls back to neutral defaults for empty values', () => {
    const result = buildSystemPrompt(template, { personality: '   ', pioneerProfile: '' });
    expect(result).not.toContain('{{PERSONALITY}}');
    expect(result).not.toContain('{{PIONEER_PROFILE}}');
    expect(result).toContain('professional, focused factory foreman');
    expect(result).toContain('returning player');
  });

  it('omits the summary block entirely when there is no summary', () => {
    const result = buildSystemPrompt(template, { personality: 'Gruff', pioneerProfile: 'Veteran' });
    expect(result).not.toContain('{{SESSION_SUMMARY}}');
    expect(result).not.toContain('Session So Far');
  });

  it('injects the summary block between pioneer profile and authority', () => {
    const result = buildSystemPrompt(template, {
      personality: 'Gruff',
      pioneerProfile: 'Veteran',
      summary: 'Built an iron line; pioneer enjoyed exploring, disliked belts.',
    });
    expect(result).toContain('Session So Far');
    expect(result).toContain('disliked belts');
    // Summary sits after the pioneer block and before the authority section.
    expect(result.indexOf('Veteran')).toBeLessThan(result.indexOf('Session So Far'));
    expect(result.indexOf('Session So Far')).toBeLessThan(result.indexOf('## Authority'));
  });

  it('treats a whitespace-only summary as empty', () => {
    const result = buildSystemPrompt(template, {
      personality: 'Gruff',
      pioneerProfile: 'Veteran',
      summary: '   ',
    });
    expect(result).not.toContain('Session So Far');
  });
});
