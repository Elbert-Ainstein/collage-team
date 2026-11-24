// What a new project starts with: four categories a project fair is usually
// judged on, each point a description rather than a number. All editable.

export interface CategoryDraft {
  id: string;
  name: string;
  /** levels[0] describes a 1, levels[4] a 5. */
  levels: string[];
}

const DEFAULT_CATEGORIES: Omit<CategoryDraft, "id">[] = [
  {
    name: "Robustness",
    levels: [
      "Doesn't work, or breaks during the demo.",
      "Works only with help; fragile.",
      "Works, with a failure or two.",
      "Works reliably; minor wobbles.",
      "Works every time, however it's handled.",
    ],
  },
  {
    name: "Design",
    levels: [
      "No design choices of their own.",
      "Few choices, mostly the obvious ones.",
      "Sensible design with some original choices.",
      "Thoughtful design; can say why for each choice.",
      "Inventive; solves the problem in a way that surprises.",
    ],
  },
  {
    name: "Physics",
    levels: [
      "Can't explain how it works.",
      "Names the ideas but can't tie them to the build.",
      "Explains the main physics correctly.",
      "Explains it clearly, with numbers or estimates.",
      "Predicted how it would behave and tested the prediction.",
    ],
  },
  {
    name: "Presentation",
    levels: [
      "Hard to follow; no clear story.",
      "Some parts clear; key steps missing.",
      "Clear: what they built and why.",
      "Clear and well paced; every member takes part.",
      "Compelling; answers questions before they're asked.",
    ],
  },
];

const newId = (): string => crypto.randomUUID();

export const defaultCategories = (): CategoryDraft[] =>
  DEFAULT_CATEGORIES.map((c) => ({ ...c, levels: [...c.levels], id: newId() }));

export const blankCategory = (): CategoryDraft => ({ id: newId(), name: "", levels: ["", "", "", "", ""] });

/** The first thing stopping these from being saved, in words, or null. */
export function problemWith(title: string, graders: number, categories: CategoryDraft[]): string | null {
  if (!title.trim()) return "Give the project a title";
  if (!Number.isInteger(graders) || graders < 1 || graders > 8) return "Graders per team: 1 to 8";
  if (categories.length === 0) return "Add a category";
  const unnamed = categories.findIndex((c) => !c.name.trim());
  if (unnamed >= 0) return `Category ${unnamed + 1} needs a name`;
  return null;
}
