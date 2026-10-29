// Why the answer is the answer, as the instructor wrote it (0051). The
// database only hands it over once the team is done with the question, or the
// session is closed — never before class — and the screens ask too.

export function Explanation({ body }: { body: string | null }) {
  const text = body?.trim();
  if (!text) return null;
  return (
    <section className="lq-swhy" aria-label="Explanation">
      <span className="fv-eyebrow">Why</span>
      <p>{text}</p>
    </section>
  );
}
