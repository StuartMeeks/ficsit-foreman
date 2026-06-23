import { useState } from 'react';

/** A selectable foreman persona. Choosing one seeds the editable personality
 * text; the pioneer can then rewrite it freely. The four presets are the
 * examples named in SPEC.md §4 — they are starting points, not a fixed menu. */
interface ForemanPreset {
  key: string;
  name: string;
  tagline: string;
  seed: string;
}

const FOREMAN_PRESETS: ForemanPreset[] = [
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
interface PioneerOption {
  key: string;
  label: string;
  fragment: string;
}

interface PioneerQuestion {
  id: string;
  label: string;
  prompt: string;
  options: PioneerOption[];
}

const PIONEER_QUESTIONS: PioneerQuestion[] = [
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
    label: 'Session style',
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
function composeProfile(answers: Record<string, string>): string {
  return PIONEER_QUESTIONS.map((q) => {
    const chosen = q.options.find((o) => o.key === answers[q.id]);
    return chosen?.fragment;
  })
    .filter((fragment): fragment is string => fragment !== undefined)
    .join(' ');
}

type Step = 'welcome' | 'personality' | 'pioneer' | 'review';

const STEP_ORDER: Step[] = ['welcome', 'personality', 'pioneer', 'review'];

interface OnboardingProps {
  onComplete: (input: { personality: string; pioneerProfile: string }) => Promise<void>;
}

/**
 * First-run onboarding (GUI v1). Walks the pioneer through choosing the
 * foreman's personality and describing themselves, then hands both freeform
 * strings to the session. Personality and profile are both editable later
 * via Settings — this is only the first pass.
 */
export function Onboarding({ onComplete }: OnboardingProps): React.JSX.Element {
  const [step, setStep] = useState<Step>('welcome');
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const [personality, setPersonality] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [pioneerProfile, setPioneerProfile] = useState('');
  const [profileEdited, setProfileEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepIndex = STEP_ORDER.indexOf(step);

  const choosePreset = (preset: ForemanPreset): void => {
    setPresetKey(preset.key);
    setPersonality(preset.seed);
  };

  const answerQuestion = (questionId: string, optionKey: string): void => {
    setAnswers((prev) => ({ ...prev, [questionId]: optionKey }));
  };

  // Moving from the pioneer step to review composes the profile, unless the
  // pioneer has already hand-edited it (don't clobber their wording).
  const goToReview = (): void => {
    if (!profileEdited) {
      setPioneerProfile(composeProfile(answers));
    }
    setStep('review');
  };

  const back = (): void => {
    const previous = STEP_ORDER[stepIndex - 1];
    if (previous !== undefined) {
      setStep(previous);
    }
  };

  const allAnswered = PIONEER_QUESTIONS.every((q) => answers[q.id] !== undefined);
  const canStart = personality.trim().length > 0 && pioneerProfile.trim().length > 0;

  const start = async (): Promise<void> => {
    if (!canStart) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onComplete({
        personality: personality.trim(),
        pioneerProfile: pioneerProfile.trim(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start your session.');
      setSubmitting(false);
    }
  };

  return (
    <div className="onboarding">
      <div className="onboarding-shell">
        <div className="onboarding-top">
          <div className="wordmark">
            <span className="glyph" aria-hidden="true" />
            FOREMAN
          </div>
          {step !== 'welcome' ? (
            <span className="label onboarding-progress">
              Step {stepIndex} / {STEP_ORDER.length - 1}
            </span>
          ) : null}
        </div>

        {step === 'welcome' ? (
          <section className="onboarding-step">
            <h1 className="onboarding-title">Reporting for duty.</h1>
            <p className="onboarding-lede">
              Your foreman keeps the maths off your plate and the work moving — issuing achievable
              orders built from your game&apos;s real data, tracking what you finish, and adapting
              when the floor changes.
            </p>
            <p className="onboarding-lede">
              Two quick questions before the first shift: who your foreman is, and who you are.
            </p>
            <div className="onboarding-actions">
              <button type="button" className="send" onClick={() => setStep('personality')}>
                Begin
              </button>
            </div>
          </section>
        ) : null}

        {step === 'personality' ? (
          <section className="onboarding-step">
            <span className="label">Foreman personality</span>
            <h2 className="onboarding-heading">Who is your foreman?</h2>
            <p className="onboarding-lede">
              Pick a starting character, then make it your own. This voice colours every message —
              there is no wrong answer, and you can change it any time.
            </p>

            <div className="preset-grid">
              {FOREMAN_PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset.key}
                  className={`preset-card${presetKey === preset.key ? ' selected' : ''}`}
                  onClick={() => choosePreset(preset)}
                  aria-pressed={presetKey === preset.key}
                >
                  <span className="preset-name">{preset.name}</span>
                  <span className="preset-tagline">{preset.tagline}</span>
                </button>
              ))}
            </div>

            <div className="field">
              <label htmlFor="ob-personality">Personality (edit freely)</label>
              <textarea
                id="ob-personality"
                value={personality}
                onChange={(e) => {
                  setPersonality(e.target.value);
                  setPresetKey(null);
                }}
                placeholder="e.g. Gruff, no-nonsense shift boss who respects competence and hates wasted time."
              />
            </div>

            <div className="onboarding-actions">
              <button type="button" className="icon-button" onClick={back}>
                Back
              </button>
              <button
                type="button"
                className="send"
                onClick={() => setStep('pioneer')}
                disabled={personality.trim().length === 0}
              >
                Next
              </button>
            </div>
          </section>
        ) : null}

        {step === 'pioneer' ? (
          <section className="onboarding-step">
            <span className="label">Pioneer profile</span>
            <h2 className="onboarding-heading">And who are you?</h2>
            <p className="onboarding-lede">
              This sets the register — how the foreman applies its character to you. The voice stays
              the same; the pitch adapts.
            </p>

            {PIONEER_QUESTIONS.map((q) => (
              <div className="question" key={q.id}>
                <span className="label question-prompt">{q.prompt}</span>
                <div className="segmented" role="group" aria-label={q.prompt}>
                  {q.options.map((option) => (
                    <button
                      type="button"
                      key={option.key}
                      className={`segment${answers[q.id] === option.key ? ' selected' : ''}`}
                      onClick={() => answerQuestion(q.id, option.key)}
                      aria-pressed={answers[q.id] === option.key}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <div className="onboarding-actions">
              <button type="button" className="icon-button" onClick={back}>
                Back
              </button>
              <button type="button" className="send" onClick={goToReview} disabled={!allAnswered}>
                Next
              </button>
            </div>
          </section>
        ) : null}

        {step === 'review' ? (
          <section className="onboarding-step">
            <span className="label">Review</span>
            <h2 className="onboarding-heading">Confirm the brief.</h2>
            <p className="onboarding-lede">
              Tidy either of these in your own words before you start. Both stay editable in
              Settings.
            </p>

            <div className="field">
              <label htmlFor="ob-review-personality">Foreman personality</label>
              <textarea
                id="ob-review-personality"
                value={personality}
                onChange={(e) => setPersonality(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="ob-review-profile">Pioneer profile</label>
              <textarea
                id="ob-review-profile"
                value={pioneerProfile}
                onChange={(e) => {
                  setPioneerProfile(e.target.value);
                  setProfileEdited(true);
                }}
              />
            </div>

            {error !== null ? <p className="err">{error}</p> : null}

            <div className="onboarding-actions">
              <button type="button" className="icon-button" onClick={back}>
                Back
              </button>
              <button
                type="button"
                className="send"
                onClick={() => void start()}
                disabled={!canStart || submitting}
              >
                {submitting ? 'Starting' : 'Start shift'}
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
