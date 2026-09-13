// The combo rubric a Combo starts life with.
//
// AP 50 runs the same combo every week: two challenge problems, each marked for
// the work done at home and for the mark-up written on it afterwards, then the
// two tutorial screens. The wording does not change from week to week either —
// it is the course's rubric, not the assignment's — so typing it out again
// every Tuesday is twenty-eight rungs of transcription for a document that is
// identical to last week's.
//
// The Amplify and Challenge completions that take the week from 20 to 30 are
// NOT questions here. They are the week's other activities, marked Complete on
// their own pages and worth 5 each, and comboTotal adds them onto this 20.
//
// This is a STARTING POINT and nothing more. Everything it writes is ordinary
// rubric_items and activity_questions: rename a question, re-point it, edit a
// rung, delete the lot. Nothing downstream knows a rubric came from here, and
// seeding is refused outright on any activity that already has a question or a
// criterion — see seedRubricTemplate — so it can only ever fill a blank page.
//
// Rungs are written the way Kelly writes them, as what they AWARD. The
// deduction each one stores is worked out from its question's own worth, by the
// same model.ts conversion the builder uses: "+1" on the 3-point At Home Effort
// question is a deduction of 2, and the identical "+1" on the 2-point Mark-up
// question is a deduction of 1.

/** One rung of a ladder: what it awards, and what it says. */
export interface TemplateRung {
  award: number;
  description: string;
}

export interface TemplateQuestion {
  label: string;
  /** What this question is out of. Needs migration 0034 to be storable. */
  points: number;
  /** Written high-to-low or low-to-high as the rubric reads; order is kept. */
  rungs: TemplateRung[];
}

export interface RubricTemplate {
  /** What the activity is set to, and what the questions must add up to. */
  pointsTotal: number;
  questions: TemplateQuestion[];
}

// Verbatim from the course's Gradescope rubric. Two rungs award +1 on purpose:
// they are two different ways of falling short that she scores the same, and a
// mark stores the ROW it was picked from rather than its value, so the pair
// stays distinguishable on a transcript.
const AT_HOME_EFFORT: TemplateRung[] = [
  {
    award: 0,
    description:
      "Work is mostly incomplete, unclear, or copied. Steps are missing or not labeled.",
  },
  {
    award: 1,
    description:
      "Work is mostly complete, but major steps or explanations are missing or unclear.",
  },
  {
    award: 2,
    description: "All major steps and explanations are included, work is clear and complete",
  },
  {
    award: 3,
    description:
      "All steps and explanations are well done, and the student goes beyond by showing extra " +
      "effort or evaluating their solution in more than one way or in a particularly " +
      "interesting way",
  },
];

const MARK_UP: TemplateRung[] = [
  { award: 0, description: "Missing markup" },
  {
    award: 1,
    description: "Work is mostly missing, lacks reflection, or does not address mistakes",
  },
  {
    award: 1,
    description:
      "Some effort to reflect or learn is shown (answers at least one prompt), but not all " +
      "required elements are included",
  },
  {
    award: 2,
    description:
      "All relevant reflection prompts are thoughtfully answered (what you did well, what you " +
      "learned, and, if needed, what mistakes were made)",
  },
];

// Verbatim from the course's Gradescope rubric, and the same ladder on both
// screens: the two questions are marked against one set of words.
const TUTORIAL_SCREEN: TemplateRung[] = [
  {
    award: 0,
    description: "answer is missing or so sketchy that it is impossible to evaluate",
  },
  { award: 1, description: "answer is incorrect and does not demonstrate effort or thoughtfulness" },
  {
    award: 2,
    description: "answer is incorrect but, it does demonstrate some effort or thoughtfulness",
  },
  {
    award: 3,
    description:
      "while the answer is correct, it does not include a thoughtful argument and therefore " +
      "does not demonstrate effort.",
  },
  {
    award: 4,
    description:
      "answer is correct and, it demonstrates an argument but the thought process is not very " +
      "thorough",
  },
  {
    award: 5,
    description:
      "answer is correct and demonstrates a deep thought process and thorough engagement with " +
      "the question.",
  },
];

/** The 20-point combo: 3 + 2 + 3 + 2 + 5 + 5. The week's two completions make it 30. */
export const COMBO_TEMPLATE: RubricTemplate = {
  pointsTotal: 20,
  questions: [
    { label: "Challenge Problem 1: At Home Effort", points: 3, rungs: AT_HOME_EFFORT },
    { label: "Challenge Problem 1: Mark-up", points: 2, rungs: MARK_UP },
    { label: "Challenge Problem 2: At Home Effort", points: 3, rungs: AT_HOME_EFFORT },
    { label: "Challenge Problem 2: Mark-up", points: 2, rungs: MARK_UP },
    { label: "Tutorial Screen 1", points: 5, rungs: TUTORIAL_SCREEN },
    { label: "Tutorial Screen 2", points: 5, rungs: TUTORIAL_SCREEN },
  ],
};

/** What the template's questions add up to. Equal to pointsTotal, and tested. */
export function templateDeclared(t: RubricTemplate): number {
  return t.questions.reduce((n, q) => n + q.points, 0);
}
