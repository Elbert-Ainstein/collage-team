// AI grading adapter — Anthropic-shaped interface with a deterministic mock.
// aiGrading.suggest(submission, rubric) -> AiGradeSuggestion. The mock returns
// the §9 suggestion (4,5,5,2,1 = 17/20) with per-criterion evidence + confidence.
// A real Anthropic call (behind a backend) can replace the mock; the UI only
// ever renders the validated suggestion object and never auto-releases it.

import type { AiGradeSuggestion, Confidence, RubricCriterion } from "@/types";

export interface Submission {
  activityId: string;
  target: string; // teamId or memberId
  text: string;
}

export interface AiGradingAdapter {
  suggest(submission: Submission, rubric: RubricCriterion[]): Promise<AiGradeSuggestion>;
}

// Canonical §9 demo suggestion, keyed by the seed rubric criterion ids.
const DEMO_BY_CRITERION: Record<string, { score: number; evidence: string; confidence: Confidence }> = {
  "r-choice": { score: 4, evidence: "“Suspension best carries the load across a 90 m gorge span.”", confidence: "High" },
  "r-reasoning": { score: 5, evidence: "“the deck tension routes through the main cables to the towers”", confidence: "High" },
  "r-calc": { score: 5, evidence: "“W = 2880 kN → H = 3600 kN → T_max ≈ 1180 kN per cable”", confidence: "Medium" },
  "r-units": { score: 2, evidence: "“assuming w = 32 kN/m uniformly distributed”", confidence: "High" },
  "r-tradeoff": { score: 1, evidence: "“cost vs. constructability” — tradeoff named but not analyzed", confidence: "Medium" },
};

function validate(s: AiGradeSuggestion, rubric: RubricCriterion[]) {
  for (const c of rubric) {
    const g = s.byCriterion[c.id];
    if (!g) throw new Error(`AI suggestion missing criterion ${c.id}`);
    if (typeof g.score !== "number" || g.score < 0 || g.score > c.points)
      throw new Error(`AI suggestion score out of range for ${c.id}`);
    if (!g.evidence) throw new Error(`AI suggestion missing evidence for ${c.id}`);
    if (g.confidence !== "High" && g.confidence !== "Medium")
      throw new Error(`AI suggestion bad confidence for ${c.id}`);
  }
}

export const mockAiGradingAdapter: AiGradingAdapter = {
  async suggest(submission, rubric) {
    const byCriterion: AiGradeSuggestion["byCriterion"] = {};
    let total = 0;
    for (const c of rubric) {
      const demo = DEMO_BY_CRITERION[c.id];
      const score = demo ? demo.score : Math.round(c.points * 0.75);
      byCriterion[c.id] = {
        score,
        max: c.points,
        evidence: demo ? demo.evidence : `Evidence for "${c.criterion}" drawn from the submission.`,
        confidence: demo ? demo.confidence : "Medium",
      };
      total += score;
    }
    const suggestion: AiGradeSuggestion = {
      activityId: submission.activityId,
      target: submission.target,
      byCriterion,
      total,
    };
    validate(suggestion, rubric);
    return suggestion;
  },
};

export const aiGradingAdapter: AiGradingAdapter = mockAiGradingAdapter;
