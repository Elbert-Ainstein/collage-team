// A fill_team_eval draft, put into the team evaluation builder's form.
//
// Pure: the builder's state in, the next state out, with what changed said in
// a few words for the card. The form is only ever filled — never saved — here;
// the builder's own Save is what writes, exactly as if she had typed it.
//
// Rows keep their ids by position. That is what the builder does when she
// retypes a category herself, and once students have submitted it is the only
// edit the database allows (0058): the same rows, new words.

import type { FormCategory, FormQuestion, TeamEvalFormContext, TeamEvalProposal } from "@/assistant/types";
import type { CategoryDraft, QuestionDraft } from "@/teameval/defaults";
import type { QuestionAudience } from "@/teameval/types";

/** The builder's form, unsaved edits and all — what the assistant reads and fills. */
export interface TeamEvalForm {
  title: string;
  instructions: string;
  /** As the datetime-local input holds it: "YYYY-MM-DDTHH:mm", or "". */
  due: string;
  categories: CategoryDraft[];
  questions: QuestionDraft[];
  peerComments: boolean;
  releaseComments: boolean;
  anonymize: boolean;
  /** As typed. */
  latePenalty: string;
}

/** What the database will refuse, so the fill never offers it. */
export interface FormLimits {
  /** Someone has submitted: no categories or questions added, removed or moved. */
  fixed: boolean;
  /** Students wrote under anonymity: it stays on. */
  anonLocked: boolean;
}

export interface FillResult {
  next: TeamEvalForm;
  /** What changed, a few words each, in the order the form reads. */
  changes: string[];
  /** What the draft asked for that the form's locks kept out. */
  skipped: string[];
  /** It touched the categories, questions or settings — the builder's second step. */
  showForm: boolean;
  /** The form's fields this fill actually changed — all that its Undo puts back. */
  fields: FormField[];
}

export type FormField = keyof TeamEvalForm;

const FIELDS: readonly FormField[] = [
  "title",
  "instructions",
  "due",
  "categories",
  "questions",
  "peerComments",
  "releaseComments",
  "anonymize",
  "latePenalty",
];

const pad = (n: number) => String(n).padStart(2, "0");

/** A Date as the datetime-local input writes one, in her own time zone. */
export function localStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The form as the model is shown it: the words, none of the row ids. */
export function formContext(form: TeamEvalForm, limits: FormLimits, now: Date): TeamEvalFormContext {
  return {
    kind: "teameval",
    title: form.title,
    instructions: form.instructions,
    due: form.due,
    now: localStamp(now),
    categories: form.categories.map((c) => ({ name: c.name, levels: [...c.levels] })),
    questions: form.questions.map((q) => ({ audience: q.audience, prompt: q.prompt })),
    peerComments: form.peerComments,
    releaseComments: form.releaseComments,
    anonymize: form.anonymize,
    latePenalty: form.latePenalty,
    fixed: limits.fixed,
    anonLocked: limits.anonLocked,
  };
}

function whenText(local: string): string {
  const [date, time] = local.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, m - 1, d, h, mi).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function categoryChanges(before: CategoryDraft[], after: CategoryDraft[]): string[] {
  const renamed = after.filter((c, i) => before[i] && before[i].name !== c.name).length;
  if (before.length !== after.length || renamed > 1) {
    return [`${plural(after.length, "category", "categories")}: ${after.map((c) => c.name).join(", ")}`];
  }
  const reworded = after.map((c, i) => c.levels.filter((l, s) => l !== (before[i].levels[s] ?? "")).length);
  const renames = after.flatMap((c, i) => (before[i].name !== c.name ? [`${before[i].name} → ${c.name}`] : []));
  const touched = reworded.filter((k) => k > 0).length;
  if (touched > 2) return [...renames, `Descriptions reworded in ${touched} categories`];
  const words = after.flatMap((c, i) => (reworded[i] ? [`${c.name}: ${plural(reworded[i], "description")} reworded`] : []));
  return [...words, ...renames];
}

const QUESTION_LABEL: Record<QuestionAudience, string> = { peer: "Teammate questions", self: "Self-reflection questions" };

function questionChanges(before: QuestionDraft[], after: QuestionDraft[]): string[] {
  return (["peer", "self"] as const).flatMap((audience) => {
    const was = before.filter((q) => q.audience === audience).map((q) => q.prompt);
    const now = after.filter((q) => q.audience === audience).map((q) => q.prompt);
    if (was.length !== now.length) return [`${QUESTION_LABEL[audience]} ${was.length} → ${now.length}`];
    return was.some((p, i) => p !== now[i]) ? [`${QUESTION_LABEL[audience]} reworded`] : [];
  });
}

/** New categories on the old rows, position by position. */
function placeCategories(before: CategoryDraft[], wanted: FormCategory[], newId: () => string): CategoryDraft[] {
  return wanted.map((c, i) => ({ id: before[i]?.id ?? newId(), name: c.name, levels: [...c.levels] }));
}

/** New questions on the old rows: the k-th teammate question takes the k-th teammate row. */
function placeQuestions(before: QuestionDraft[], wanted: FormQuestion[], newId: () => string): QuestionDraft[] {
  const rows = {
    peer: before.filter((q) => q.audience === "peer").map((q) => q.id),
    self: before.filter((q) => q.audience === "self").map((q) => q.id),
  };
  const used = { peer: 0, self: 0 };
  return wanted.map((q) => ({ id: rows[q.audience][used[q.audience]++] ?? newId(), audience: q.audience, prompt: q.prompt }));
}

const sameShape = (before: QuestionDraft[], wanted: FormQuestion[]) =>
  before.length === wanted.length && before.every((q, i) => q.audience === wanted[i].audience);

const fmtPct = (n: number) => String(Math.round(n * 100) / 100);

/** "10" and 10 are the same penalty; an empty or half-typed box is not. */
const penaltyChanged = (typed: string, wanted: number | null) =>
  wanted !== null && (!typed.trim() || Number(typed) !== wanted);

/**
 * The form with the draft put in. Nothing the draft left out is touched, and
 * nothing the locks forbid is changed — that part is named in `skipped`.
 */
export function fillForm(
  form: TeamEvalForm,
  draft: TeamEvalProposal,
  limits: FormLimits,
  newId: () => string = () => crypto.randomUUID(),
): FillResult {
  const skipped: string[] = [];
  let categories = form.categories;
  if (draft.categories) {
    if (limits.fixed && draft.categories.length !== form.categories.length) {
      skipped.push("Categories: students have submitted, so none can be added or removed");
    } else {
      categories = placeCategories(form.categories, draft.categories, newId);
    }
  }
  let questions = form.questions;
  if (draft.questions) {
    if (limits.fixed && !sameShape(form.questions, draft.questions)) {
      skipped.push("Questions: students have submitted, so none can be added, removed or moved");
    } else {
      questions = placeQuestions(form.questions, draft.questions, newId);
    }
  }
  let anonymize = draft.anonymize ?? form.anonymize;
  if (limits.anonLocked && draft.anonymize === false) {
    anonymize = form.anonymize;
    skipped.push("Anonymize stays on: students wrote under it");
  }

  const next: TeamEvalForm = {
    title: draft.title ?? form.title,
    instructions: draft.instructions ?? form.instructions,
    due: draft.due ?? form.due,
    categories,
    questions,
    peerComments: draft.peerComments ?? form.peerComments,
    releaseComments: draft.releaseComments ?? form.releaseComments,
    anonymize,
    latePenalty: draft.latePenalty === null ? form.latePenalty : fmtPct(draft.latePenalty),
  };

  const changes = [
    next.title !== form.title ? `Title “${next.title}”` : "",
    next.instructions !== form.instructions ? "Instructions" : "",
    next.due !== form.due ? `Due ${whenText(next.due)}` : "",
    ...categoryChanges(form.categories, next.categories),
    ...questionChanges(form.questions, next.questions),
    next.peerComments !== form.peerComments ? `Evaluate peer to peer ${next.peerComments ? "on" : "off"}` : "",
    next.releaseComments !== form.releaseComments ? `Release to students ${next.releaseComments ? "on" : "off"}` : "",
    next.anonymize !== form.anonymize ? `Anonymize ${next.anonymize ? "on" : "off"}` : "",
    penaltyChanged(form.latePenalty, draft.latePenalty) ? `Late penalty ${form.latePenalty.trim() || "—"}% → ${next.latePenalty}%` : "",
  ].filter(Boolean);

  const showForm =
    draft.categories !== null ||
    draft.questions !== null ||
    draft.peerComments !== null ||
    draft.releaseComments !== null ||
    draft.anonymize !== null ||
    draft.latePenalty !== null;

  const fields = FIELDS.filter((f) => JSON.stringify(next[f]) !== JSON.stringify(form[f]));
  return { next, changes, skipped, showForm, fields };
}

/**
 * Undo one fill: the fields it changed go back to what they were, and anything
 * she typed elsewhere since stays as she typed it.
 */
export function revertFill(current: TeamEvalForm, before: TeamEvalForm, fields: readonly FormField[]): TeamEvalForm {
  return FIELDS.reduce<TeamEvalForm>(
    (out, f) => (fields.includes(f) ? { ...out, [f]: before[f] } : out),
    { ...current },
  );
}
