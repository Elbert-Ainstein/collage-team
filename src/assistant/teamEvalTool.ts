// fill_team_eval: filling in the team evaluation builder she has open — from
// a document (a rubric pasted in, or a linked Google Doc), or one setting at a
// time ("make the late penalty 20%").
//
// Like every tool here it is a draft. The browser puts it into the builder's
// form, where she sees it and can undo it, and nothing reaches the database
// until she presses the builder's own Save — the same press that would save
// her typing it in herself.
//
// Every field but the summary is optional and means "leave it": a one-setting
// change sends one setting, so it cannot quietly reword a rubric by copying it
// back badly. Categories and questions, when sent, are each the whole list.
//
// Levels come as {score, text} rather than a bare list of five: documents list
// 5 first, the form stores 1 first, and an explicit score is the one form of
// the answer that cannot come back upside down.

import { refuse } from "./refusal";
import type { ToolSpec } from "./tools";
import type { FormCategory, FormQuestion, TeamEvalProposal } from "./types";

/** What the builder keeps (TeamEvalBuilder, and 0058 for names and prompts). */
export const NAME_MAX = 120;
export const PROMPT_MAX = 1000;
export const LEVEL_MAX = 2000;
export const TITLE_MAX = 200;
export const INSTRUCTIONS_MAX = 20_000;
const MAX_SUMMARY = 600;
const MAX_CATEGORIES = 20;
const MAX_QUESTIONS = 30;
const MAX_NOTES = 20;
const MAX_NOTE = 300;
export const SCORES = [1, 2, 3, 4, 5] as const;

const DUE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export const FILL_TEAM_EVAL: ToolSpec = {
  name: "fill_team_eval",
  description:
    "Fill in or change the team evaluation form the instructor has open: its rating categories (each a " +
    "1–5 scale with a description for every point), its open-ended questions, its settings, title, " +
    "instructions and due date. Use it to set up the whole evaluation from a document — a rubric she " +
    "pasted or a Google Doc she linked — and for single changes like 'make the late penalty 20%' or " +
    "'turn off anonymity'. Send ONLY what changes; leave every other field out. categories and questions " +
    "each replace the whole list when sent. The form is filled at once and she presses Save to keep it.",
  schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "One or two plain sentences saying what this fills in or changes, e.g. \"Sets the late penalty " +
          "to 20%.\" or \"Fills in the five revised AP50 teamwork dimensions and five feedback questions.\"",
      },
      title: { type: "string", description: "The evaluation's title. Only when she asks, or the form has none." },
      instructions: {
        type: "string",
        description:
          "What students read before they start, as plain text: paragraphs, and lines starting \"- \" for " +
          "bullets. From a document: its instructions for students, as written.",
      },
      due: {
        type: "string",
        description: "The due date and time in her local time, as YYYY-MM-DDTHH:mm, worked out from the form's Now.",
      },
      categories: {
        type: "array",
        description:
          "The WHOLE list of rating categories, in order. To change one, send them all with the others " +
          "copied exactly as the form has them.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "The category's name, e.g. \"Interacting with Teammates\"." },
            levels: {
              type: "array",
              description: "What each score means — one entry per score from 1 to 5 the source describes.",
              items: {
                type: "object",
                properties: {
                  score: { type: "integer", description: "1, 2, 3, 4 or 5." },
                  text: { type: "string", description: "What that score means, word for word from the source." },
                },
                required: ["score", "text"],
              },
            },
          },
          required: ["name", "levels"],
        },
      },
      questions: {
        type: "array",
        description:
          "The WHOLE list of open-ended questions, in order. To change one, send them all with the others " +
          "copied exactly as the form has them.",
        items: {
          type: "object",
          properties: {
            audience: {
              type: "string",
              enum: ["peer", "self"],
              description: "peer: asked about each teammate. self: asked of the student about themselves.",
            },
            prompt: { type: "string", description: "The question, with its one-line guidance if it has one." },
          },
          required: ["audience", "prompt"],
        },
      },
      peer_comments: { type: "boolean", description: "\"Evaluate peer to peer\": ask the peer questions about each teammate." },
      release_comments: {
        type: "boolean",
        description: "\"Release to students\": show students what teammates wrote about them once results are out.",
      },
      anonymize: { type: "boolean", description: "Show those comments without who wrote them." },
      late_penalty: {
        type: "number",
        description: "Percent of the grade taken off a student whose own evaluation is late, 0 to 100.",
      },
      not_applied: {
        type: "array",
        description:
          "Anything she asked for, or the document sets out, that this form has no place for — one short " +
          "phrase each. Never drop something silently.",
        items: { type: "string" },
      },
    },
    required: ["summary"],
  },
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** A trimmed string, or null when it is absent, blank or not a string. */
function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

const count = (n: number) => n.toLocaleString("en-US");

function capped(v: unknown, what: string, max: number): string | null {
  const t = text(v);
  if (t !== null && t.length > max) refuse(`${what} is longer than ${count(max)} characters`);
  return t;
}

/** Absent or null is "leave it"; anything else must be a true list. */
function optList(v: unknown, what: string, max: number): unknown[] | null {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) refuse(`${what} is not a list`);
  if (v.length > max) refuse(`${what} has more than ${max} entries`);
  return v;
}

function optBool(v: unknown, what: string): boolean | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "boolean") refuse(`${what} is not on or off`);
  return v;
}

/** A real local date and time, or a refusal — "2026-02-31" is not one. */
function dueOf(v: unknown): string | null {
  const t = text(v);
  if (t === null) return null;
  const m = DUE_RE.exec(t);
  if (!m) refuse(`the due date "${t.slice(0, 40)}" is not a date and time`);
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const at = new Date(y, mo - 1, d, h, mi);
  if (at.getFullYear() !== y || at.getMonth() !== mo - 1 || at.getDate() !== d || h > 23 || mi > 59) {
    refuse(`the due date "${t}" is not a real date`);
  }
  return t;
}

function penaltyOf(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) refuse("the late penalty must be 0–100%");
  return Math.round(v * 100) / 100;
}

function levelsOf(v: unknown, what: string): string[] {
  const list = optList(v, `${what}'s levels`, SCORES.length) ?? [];
  const out = SCORES.map(() => "");
  const seen = new Set<number>();
  list.forEach((l) => {
    if (!isObj(l)) refuse(`a level of ${what} is not an object`);
    const score = l.score;
    if (typeof score !== "number" || !SCORES.includes(score as (typeof SCORES)[number])) {
      refuse(`${what} has a level with no score from 1 to 5`);
    }
    if (seen.has(score)) refuse(`${what} describes a ${score} twice`);
    seen.add(score);
    out[score - 1] = capped(l.text, `${what}'s ${score}`, LEVEL_MAX) ?? "";
  });
  return out;
}

function categoriesOf(v: unknown): FormCategory[] | null {
  const list = optList(v, "categories", MAX_CATEGORIES);
  if (list === null) return null;
  if (!list.length) refuse("an evaluation needs at least one category");
  return list.map((c, i) => {
    if (!isObj(c)) refuse(`category ${i + 1} is not an object`);
    const name = capped(c.name, `category ${i + 1}'s name`, NAME_MAX);
    if (!name) refuse(`category ${i + 1} has no name`);
    // One line: the builder's name box does not take a new line either.
    const oneLine = name.replace(/\s*\n\s*/g, " ");
    return { name: oneLine, levels: levelsOf(c.levels, oneLine) };
  });
}

function questionsOf(v: unknown): FormQuestion[] | null {
  const list = optList(v, "questions", MAX_QUESTIONS);
  if (list === null) return null;
  return list.map((q, i) => {
    if (!isObj(q)) refuse(`question ${i + 1} is not an object`);
    if (q.audience !== "peer" && q.audience !== "self") refuse(`question ${i + 1} has no audience`);
    const prompt = capped(q.prompt, `question ${i + 1}`, PROMPT_MAX);
    if (!prompt) refuse(`question ${i + 1} is empty`);
    return { audience: q.audience, prompt };
  });
}

function notesOf(v: unknown): string[] {
  const list = optList(v, "not_applied", 200) ?? [];
  return list
    .flatMap((x) => (text(x) ? [(text(x) as string).slice(0, MAX_NOTE)] : []))
    .slice(0, MAX_NOTES);
}

/**
 * The model's fill as something the browser can put into the form — or a
 * refusal, worded for the instructor, thrown as a Refusal.
 */
export function parseFillTeamEval(input: Obj): TeamEvalProposal {
  const summary = text(input.summary);
  if (!summary) refuse("the draft has no summary");
  const proposal: TeamEvalProposal = {
    kind: "teameval",
    summary: summary.slice(0, MAX_SUMMARY),
    title: capped(input.title, "the title", TITLE_MAX),
    instructions: capped(input.instructions, "the instructions", INSTRUCTIONS_MAX),
    due: dueOf(input.due),
    categories: categoriesOf(input.categories),
    questions: questionsOf(input.questions),
    peerComments: optBool(input.peer_comments, "\"Evaluate peer to peer\""),
    releaseComments: optBool(input.release_comments, "\"Release to students\""),
    anonymize: optBool(input.anonymize, "\"Anonymize\""),
    latePenalty: penaltyOf(input.late_penalty),
    notApplied: notesOf(input.not_applied),
  };
  const { kind: _k, summary: _s, notApplied, ...fields } = proposal;
  if (Object.values(fields).every((f) => f === null) && !notApplied.length) refuse("the draft changes nothing");
  return proposal;
}
