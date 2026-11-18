// What a new team evaluation starts with. Five categories on a five-point
// scale, each point a behaviour rather than a number, and the two open
// questions most peer evaluations ask — all of it editable in the builder.

import type { QuestionAudience } from "./types";

export interface CategoryDraft {
  id: string;
  name: string;
  /** levels[0] describes a 1, levels[4] a 5. */
  levels: string[];
}

export interface QuestionDraft {
  id: string;
  audience: QuestionAudience;
  prompt: string;
}

const DEFAULT_CATEGORIES: Omit<CategoryDraft, "id">[] = [
  {
    name: "Contribution",
    levels: [
      "Rarely does their share; others have to cover for them.",
      "Does some of the work, but it's often late or unfinished.",
      "Does their share of the work, on time.",
      "Does their share well and picks up extra when the team needs it.",
      "Goes well beyond their share and makes the team's work better.",
    ],
  },
  {
    name: "Communication",
    levels: [
      "Hard to reach; doesn't share ideas or updates.",
      "Responds sometimes, but shares little unless asked.",
      "Keeps the team informed and replies in reasonable time.",
      "Shares ideas clearly and listens to everyone else's.",
      "Keeps everyone on the same page and draws quieter members in.",
    ],
  },
  {
    name: "Reliability",
    levels: [
      "Misses meetings and deadlines without warning.",
      "Sometimes misses meetings or deadlines.",
      "Usually shows up prepared and meets deadlines.",
      "Always follows through on what they said they'd do.",
      "Helps the whole team plan ahead and stay on schedule.",
    ],
  },
  {
    name: "Quality of work",
    levels: [
      "Their work often has to be redone.",
      "Their work is sometimes careless or incomplete.",
      "Their work meets what was asked.",
      "Their work is careful and accurate.",
      "Their work is excellent and raises the team's standard.",
    ],
  },
  {
    name: "Respect",
    levels: [
      "Dismisses others' ideas or creates conflict.",
      "Sometimes talks over or ignores others.",
      "Is respectful and cooperative.",
      "Encourages others and works through disagreements well.",
      "Builds trust; everyone feels their contribution matters.",
    ],
  },
];

const DEFAULT_QUESTIONS: Omit<QuestionDraft, "id">[] = [
  { audience: "peer", prompt: "What is one thing this teammate does well?" },
  { audience: "peer", prompt: "What is one thing this teammate could work on?" },
  { audience: "self", prompt: "Personal reflection: how did you contribute to your team, and what would you do differently next time?" },
];

export const defaultCategories = (): CategoryDraft[] =>
  DEFAULT_CATEGORIES.map((c) => ({ ...c, levels: [...c.levels], id: crypto.randomUUID() }));

export const defaultQuestions = (): QuestionDraft[] => DEFAULT_QUESTIONS.map((q) => ({ ...q, id: crypto.randomUUID() }));

export const blankCategory = (): CategoryDraft => ({ id: crypto.randomUUID(), name: "", levels: ["", "", "", "", ""] });

export const blankQuestion = (audience: QuestionAudience): QuestionDraft => ({ id: crypto.randomUUID(), audience, prompt: "" });

/** The first thing wrong with these, in words, or null. */
export function problemWith(categories: CategoryDraft[], questions: QuestionDraft[]): string | null {
  if (categories.length === 0) return "Add at least one category.";
  const unnamed = categories.findIndex((c) => !c.name.trim());
  if (unnamed >= 0) return `Category ${unnamed + 1} needs a name.`;
  const blank = questions.findIndex((q) => !q.prompt.trim());
  if (blank >= 0) return "A question is empty — write it or remove it.";
  return null;
}
