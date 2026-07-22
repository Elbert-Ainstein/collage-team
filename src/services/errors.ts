// The services layer plays the role the kickoff assigned to "the API layer":
// it OWNS every mutation and rejects §11 violations by throwing, the same way a
// server would answer 403/409. UI never mutates domain state directly.

export type RuleCode =
  | "IMMUTABLE_ORIGINAL" // 409: editing a locked original
  | "ALREADY_SUBMITTED" // 409: re-submitting a one-submission resource
  | "PREP_GATE" // 403: team-stage access before prep submitted
  | "PRIVATE_FINAL" // 403: reading a teammate's individual final
  | "PARTICIPATION_INCOMPLETE" // 409: team submit before all confirm
  | "PREP_VALIDATION" // 422: prep fails prepSettings requirements
  | "NOT_FOUND"; // 404

export class RuleViolation extends Error {
  code: RuleCode;
  status: number;
  constructor(code: RuleCode, message: string) {
    super(message);
    this.name = "RuleViolation";
    this.code = code;
    this.status = STATUS[code];
  }
}

const STATUS: Record<RuleCode, number> = {
  IMMUTABLE_ORIGINAL: 409,
  ALREADY_SUBMITTED: 409,
  PREP_GATE: 403,
  PRIVATE_FINAL: 403,
  PARTICIPATION_INCOMPLETE: 409,
  PREP_VALIDATION: 422,
  NOT_FOUND: 404,
};
