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
      "Rarely does their share; others cover.",
      "Does some work, often late or unfinished.",
      "Does their share, on time.",
      "Does their share well; picks up extra.",
      "Goes well beyond their share; lifts the team's work.",
    ],
  },
  {
    name: "Communication",
    levels: [
      "Hard to reach; shares no ideas or updates.",
      "Replies sometimes; shares little unless asked.",
      "Keeps the team informed; replies promptly.",
      "Shares ideas clearly; listens to others.",
      "Keeps everyone aligned; draws quieter members in.",
    ],
  },
  {
    name: "Reliability",
    levels: [
      "Misses meetings and deadlines without warning.",
      "Sometimes misses meetings or deadlines.",
      "Usually prepared; meets deadlines.",
      "Always follows through.",
      "Helps the team plan ahead and stay on schedule.",
    ],
  },
  {
    name: "Quality of work",
    levels: [
      "Work often needs redoing.",
      "Work is sometimes careless or incomplete.",
      "Work meets requirements.",
      "Work is careful and accurate.",
      "Work is excellent; raises the team's standard.",
    ],
  },
  {
    name: "Respect",
    levels: [
      "Dismisses others' ideas; creates conflict.",
      "Sometimes talks over or ignores others.",
      "Respectful and cooperative.",
      "Encourages others; handles disagreement well.",
      "Builds trust; everyone feels valued.",
    ],
  },
];

const DEFAULT_QUESTIONS: Omit<QuestionDraft, "id">[] = [
  { audience: "peer", prompt: "One thing they do well" },
  { audience: "peer", prompt: "One thing to work on" },
  { audience: "self", prompt: "How did you contribute, and what would you change?" },
];

export const defaultCategories = (): CategoryDraft[] =>
  DEFAULT_CATEGORIES.map((c) => ({ ...c, levels: [...c.levels], id: crypto.randomUUID() }));

export const defaultQuestions = (): QuestionDraft[] => DEFAULT_QUESTIONS.map((q) => ({ ...q, id: crypto.randomUUID() }));

export const blankCategory = (): CategoryDraft => ({ id: crypto.randomUUID(), name: "", levels: ["", "", "", "", ""] });

export const blankQuestion = (audience: QuestionAudience): QuestionDraft => ({ id: crypto.randomUUID(), audience, prompt: "" });

/** The first thing wrong with these, in words, or null. */
export function problemWith(categories: CategoryDraft[], questions: QuestionDraft[]): string | null {
  if (categories.length === 0) return "Add a category";
  const unnamed = categories.findIndex((c) => !c.name.trim());
  if (unnamed >= 0) return `Category ${unnamed + 1} needs a name`;
  if (questions.some((q) => !q.prompt.trim())) return "Fill in or remove empty questions";
  return null;
}
