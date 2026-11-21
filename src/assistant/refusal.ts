// A draft the model sent back that cannot be read, said in words for the
// instructor — the message ends up on her screen. Thrown by the tool parsers
// and caught once, in parseToolCall.

export class Refusal extends Error {}

export function refuse(why: string): never {
  throw new Refusal(why);
}
