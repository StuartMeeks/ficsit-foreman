/**
 * Shared starting points for the two things the pioneer configures about a
 * playthrough: the foreman's personality and their own play-style profile.
 *
 * These were first written for onboarding; they are the single source of truth
 * reused by the new-foreman flow (Settings + new-playthrough) and the pioneer
 * profile editor, so "the five presets" and "the same questions" stay identical
 * everywhere they appear.
 */

/** A selectable foreman persona. Choosing one seeds the editable personality
 * text (and a starting name); the pioneer can then rewrite it freely. The
 * presets are starting points (the archetypes sketched in SPEC.md §4, plus a
 * synthetic-AI option), not a fixed menu. */
export interface ForemanPreset {
  key: string;
  name: string;
  tagline: string;
  seed: string;
}

export const FOREMAN_PRESETS: ForemanPreset[] = [
  {
    key: 'synthetic',
    name: 'Synthetic Intelligence',
    tagline: 'Deadpan corporate AI',
    seed:
      'A synthetic FICSIT intelligence: composed, impeccably polite and relentlessly ' +
      'on-message. Speaks in calm, measured, faintly clinical terms, framing every task ' +
      'around efficiency, compliance and continued productivity. Favours dry understatement ' +
      'and the occasional cheerfully ominous note about workplace safety and the ' +
      'expendability of labour — endlessly helpful, never quite warm.',
  },
  {
    key: 'gruff',
    name: 'Gruff Supervisor',
    tagline: 'Old-school, blunt, fair',
    seed:
      'A gruff, old-school shift supervisor. Blunt and economical with words, ' +
      'respects competence and has no patience for wasted time or excuses — but ' +
      'fair, and quietly proud when the work is done right.',
  },
  {
    key: 'optimist',
    name: 'Corporate Optimist',
    tagline: 'Cheerful, encouraging, on-brand',
    seed:
      'A relentlessly cheerful FICSIT corporate optimist. Upbeat, encouraging and ' +
      'full of company spirit — celebrates every milestone and frames every ' +
      'setback as an opportunity for greater efficiency.',
  },
  {
    key: 'efficiency',
    name: 'Efficiency Obsessive',
    tagline: 'Dry, precise, deadpan',
    seed:
      'A dry, deadpan efficiency obsessive. Precise, understated and allergic to ' +
      'waste. Speaks in clipped, exact terms and takes a quiet satisfaction in a ' +
      'perfectly ratioed production line.',
  },
  {
    key: 'sergeant',
    name: 'Drill Sergeant',
    tagline: 'Loud, demanding, intense',
    seed:
      'A hard-driving drill sergeant. Loud, demanding and intense — barks orders, ' +
      'pushes for results and expects the line to keep moving. Tough, but genuinely ' +
      'invested in turning the pioneer into a well-oiled machine.',
  },
];

/** One pioneer-profile question. Each option contributes a self-contained
 * sentence (`fragment`) to the composed, editable profile string. */
export interface PioneerOption {
  key: string;
  label: string;
  fragment: string;
}

export interface PioneerQuestion {
  id: string;
  label: string;
  prompt: string;
  options: PioneerOption[];
}

export const PIONEER_QUESTIONS: PioneerQuestion[] = [
  {
    id: 'experience',
    label: 'Experience',
    prompt: 'How familiar are you with Satisfactory?',
    options: [
      {
        key: 'first',
        label: 'First playthrough',
        fragment: 'First playthrough — explain what things are and do not assume prior knowledge.',
      },
      {
        key: 'returning',
        label: 'Returning player',
        fragment: 'Returning player — assume familiarity and skip the basics.',
      },
      {
        key: 'veteran',
        label: 'Veteran',
        fragment: 'Veteran — knows the game well; just help me think, no hand-holding.',
      },
    ],
  },
  {
    id: 'style',
    label: 'Playthrough style',
    prompt: 'How do you like to play?',
    options: [
      {
        key: 'goal',
        label: 'Goal-oriented',
        fragment: 'Goal-oriented — give a clear task and let me get on with it.',
      },
      {
        key: 'explore',
        label: 'Exploratory',
        fragment: 'Exploratory — likes to wander and discover things.',
      },
      {
        key: 'mixed',
        label: 'Mixed',
        fragment: 'Mixed — wants direction when needed and freedom when not.',
      },
    ],
  },
  {
    id: 'involvement',
    label: 'Involvement',
    prompt: 'How much do you want the foreman involved?',
    options: [
      {
        key: 'handson',
        label: 'Hands-on',
        fragment: 'Hands-on — check in often, with plenty of guidance.',
      },
      {
        key: 'light',
        label: 'Light touch',
        fragment: 'Light touch — issue the order and trust me to execute.',
      },
      {
        key: 'ondemand',
        label: 'On demand',
        fragment: 'On demand — I will ask for the foreman when I need them.',
      },
    ],
  },
];

/** Builds the editable pioneer-profile string from the selected options, in
 * question order. Unanswered questions are simply omitted. */
export function composeProfile(answers: Record<string, string>): string {
  return PIONEER_QUESTIONS.map((q) => {
    const chosen = q.options.find((o) => o.key === answers[q.id]);
    return chosen?.fragment;
  })
    .filter((fragment): fragment is string => fragment !== undefined)
    .join(' ');
}
