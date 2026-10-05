// Forming a whole new set of teams by rules, in code.
//
// The model's part ends at the rules — which columns to balance, who must not
// be together. Deciding who goes where is arithmetic over the whole class at
// once, which is exactly what a language model cannot be relied on to do in its
// head: tried on eighty students with five rules, it ran out of room before it
// finished. This does it in well under a second, the same way every time.
//
// HARD RULES are pairs that must not share a team: current teammates, and
// anyone who shares a value in an "avoid" column (earlier teams carried in the
// spreadsheet). They are weighted so heavily that a draft with one in it is
// only ever the best there is — and then the pair is named, never hidden.
//
// BALANCE RULES spread a category (each value as evenly as the class allows) or
// even out a number (every team's average near the class's). A student with no
// value in a column simply does not count for it.
//
// The search is simulated annealing over swaps between teams — swaps keep the
// sizes fixed — from a few seeded starts, then a greedy pass that takes every
// improving swap left. Seeded, so the draft on screen is reproducible and
// "try another arrangement" is just another seed.

export interface Person {
  id: string;
  /** Column → the raw cell from the instructor's file. */
  values: Record<string, string>;
}

export interface BalanceRule {
  column: string;
  kind: "category" | "number";
  /** For a category: only these values matter (e.g. Freshman). Empty or absent: all of them. */
  values?: string[];
}

export interface FormSpec {
  teamSize: number;
  /** Keep apart anyone on the same team right now. */
  avoidCurrent: boolean;
  /** Keep apart anyone sharing a non-blank value in any of these columns. */
  avoidColumns: string[];
  /** In priority order. */
  balance: BalanceRule[];
}

export interface FormedTeam {
  members: string[];
  /** Column → value (folded) → how many on this team. */
  categories: Record<string, Record<string, number>>;
  /** Column → this team's average, or null when nobody on it has a number. */
  numbers: Record<string, number | null>;
}

export interface Check {
  ok: boolean;
  text: string;
}

export interface FormResult {
  teams: FormedTeam[];
  /** Pairs on one team that a hard rule wanted apart. Empty whenever that was possible. */
  conflicts: { a: string; b: string }[];
  /** One line per rule, for the preview. */
  checks: Check[];
  /** Column → folded value → the spelling to show. */
  labels: Record<string, Record<string, string>>;
}

/** Teams as close to `size` as `n` divides, the larger ones first. */
export function teamSizes(n: number, size: number): number[] {
  if (n <= 0) return [];
  const k = Math.max(1, Math.round(n / Math.max(1, size)));
  const base = Math.floor(n / k);
  const extra = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

const fold = (v: string | undefined) => (v ?? "").trim().toLowerCase();

/** mulberry32: small, seeded, good enough to shuffle a class. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hard rule outweighs any amount of imbalance. */
const HARD = 1000;

interface Prepared {
  n: number;
  /** n×n: 1 where the pair must be apart. */
  apart: Uint8Array;
  cats: { weight: number; column: string; values: string[]; of: Int16Array; totals: number[] }[];
  nums: { weight: number; column: string; of: Float64Array; mean: number; variance: number }[];
}

function prepare(people: Person[], currentTeam: Map<string, string>, spec: FormSpec): Prepared {
  const n = people.length;
  const apart = new Uint8Array(n * n);
  const keys = people.map((p) => [
    ...(spec.avoidCurrent && currentTeam.get(p.id) ? [`current:${currentTeam.get(p.id)}`] : []),
    ...spec.avoidColumns.flatMap((c) => (fold(p.values[c]) ? [`${c}:${fold(p.values[c])}`] : [])),
  ]);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (keys[i].some((k) => keys[j].includes(k))) apart[i * n + j] = apart[j * n + i] = 1;
    }
  }

  const R = spec.balance.length;
  const weight = (r: number) => 1 + (0.15 * (R - 1 - r)) / Math.max(1, R - 1);
  const cats: Prepared["cats"] = [];
  const nums: Prepared["nums"] = [];
  spec.balance.forEach((rule, r) => {
    if (rule.kind === "category") {
      const present = [...new Set(people.map((p) => fold(p.values[rule.column])).filter(Boolean))];
      const wanted = rule.values?.length ? rule.values.map(fold).filter((v) => present.includes(v)) : present;
      const of = Int16Array.from(people, (p) => wanted.indexOf(fold(p.values[rule.column])));
      const totals = wanted.map((_, v) => of.filter((x) => x === v).length);
      cats.push({ weight: weight(r), column: rule.column, values: wanted, of, totals });
    } else {
      const of = Float64Array.from(people, (p) => {
        const raw = (p.values[rule.column] ?? "").trim();
        const x = raw === "" ? NaN : Number(raw);
        return Number.isFinite(x) ? x : NaN;
      });
      const xs = Array.from(of).filter((x) => !Number.isNaN(x));
      const mean = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
      const variance = xs.length ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length : 0;
      nums.push({ weight: weight(r), column: rule.column, of, mean, variance });
    }
  });
  return { n, apart, cats, nums };
}

function teamCost(p: Prepared, members: number[]): number {
  const { n, apart } = p;
  let cost = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) if (apart[members[i] * n + members[j]]) cost += HARD;
  }
  const s = members.length;
  for (const c of p.cats) {
    for (let v = 0; v < c.values.length; v++) {
      let count = 0;
      for (const m of members) if (c.of[m] === v) count++;
      const expected = (c.totals[v] * s) / n;
      cost += (c.weight * (count - expected) ** 2) / Math.max(expected, 0.5);
    }
  }
  for (const x of p.nums) {
    if (!x.variance) continue;
    let sum = 0;
    let have = 0;
    for (const m of members) {
      if (!Number.isNaN(x.of[m])) {
        sum += x.of[m];
        have++;
      }
    }
    if (have) cost += (x.weight * have * (sum / have - x.mean) ** 2) / x.variance;
  }
  return cost;
}

interface Arrangement {
  teams: number[][];
  cost: number;
}

/** Simulated annealing over swaps, then every improving swap that is left. */
function search(p: Prepared, sizes: number[], random: () => number): Arrangement {
  const order = Array.from({ length: p.n }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let at = 0;
  const teams = sizes.map((s) => order.slice(at, (at += s)));
  const teamOf = new Int32Array(p.n);
  teams.forEach((t, ti) => t.forEach((m) => (teamOf[m] = ti)));
  const costs = teams.map((t) => teamCost(p, t));
  let total = costs.reduce((a, b) => a + b, 0);
  let best: Arrangement = { teams: teams.map((t) => [...t]), cost: total };
  if (teams.length < 2) return best;

  const swapIn = (t: number[], from: number, to: number) => (t[t.indexOf(from)] = to);
  const iterations = Math.min(400_000, Math.max(30_000, p.n * 2_500));
  const T0 = 2;
  const T1 = 0.002;
  for (let it = 0; it < iterations; it++) {
    const a = Math.floor(random() * p.n);
    const b = Math.floor(random() * p.n);
    const A = teamOf[a];
    const B = teamOf[b];
    if (A === B) continue;
    swapIn(teams[A], a, b);
    swapIn(teams[B], b, a);
    const cA = teamCost(p, teams[A]);
    const cB = teamCost(p, teams[B]);
    const delta = cA + cB - costs[A] - costs[B];
    const T = T0 * (T1 / T0) ** (it / iterations);
    if (delta <= 0 || random() < Math.exp(-delta / T)) {
      teamOf[a] = B;
      teamOf[b] = A;
      costs[A] = cA;
      costs[B] = cB;
      total += delta;
      if (total < best.cost - 1e-9) best = { teams: teams.map((t) => [...t]), cost: total };
    } else {
      swapIn(teams[A], b, a);
      swapIn(teams[B], a, b);
    }
  }
  return polish(p, best);
}

/** Take every swap that still lowers the cost, until none does. */
function polish(p: Prepared, start: Arrangement): Arrangement {
  const teams = start.teams.map((t) => [...t]);
  const costs = teams.map((t) => teamCost(p, t));
  let improved = true;
  while (improved) {
    improved = false;
    for (let A = 0; A < teams.length; A++) {
      for (let B = A + 1; B < teams.length; B++) {
        for (let i = 0; i < teams[A].length; i++) {
          for (let j = 0; j < teams[B].length; j++) {
            const a = teams[A][i];
            const b = teams[B][j];
            teams[A][i] = b;
            teams[B][j] = a;
            const cA = teamCost(p, teams[A]);
            const cB = teamCost(p, teams[B]);
            if (cA + cB < costs[A] + costs[B] - 1e-9) {
              costs[A] = cA;
              costs[B] = cB;
              improved = true;
            } else {
              teams[A][i] = a;
              teams[B][j] = b;
            }
          }
        }
      }
    }
  }
  return { teams, cost: costs.reduce((x, y) => x + y, 0) };
}

const STARTS = 3;

export function formTeams(input: {
  people: Person[];
  currentTeam: Map<string, string>;
  spec: FormSpec;
  seed?: number;
}): FormResult {
  const { people, currentTeam, spec } = input;
  const p = prepare(people, currentTeam, spec);
  const sizes = teamSizes(people.length, spec.teamSize);
  let best: Arrangement | null = null;
  for (let s = 0; s < STARTS; s++) {
    const found = search(p, sizes, rng((input.seed ?? 1) * 7919 + s));
    if (!best || found.cost < best.cost) best = found;
  }
  return describe(people, p, spec, best?.teams ?? []);
}

function describe(people: Person[], p: Prepared, spec: FormSpec, arranged: number[][]): FormResult {
  // In the order of the input within each team, so a draft reads like the roster.
  const teamsIdx = arranged.map((t) => [...t].sort((a, b) => a - b));
  const conflicts: FormResult["conflicts"] = [];
  for (const t of teamsIdx) {
    for (let i = 0; i < t.length; i++) {
      for (let j = i + 1; j < t.length; j++) {
        if (p.apart[t[i] * p.n + t[j]]) conflicts.push({ a: people[t[i]].id, b: people[t[j]].id });
      }
    }
  }

  const labels: FormResult["labels"] = {};
  for (const rule of spec.balance) {
    labels[rule.column] = {};
    for (const person of people) {
      const raw = (person.values[rule.column] ?? "").trim();
      if (raw && !(fold(raw) in labels[rule.column])) labels[rule.column][fold(raw)] = raw;
    }
  }

  const teams: FormedTeam[] = teamsIdx.map((t) => ({
    members: t.map((i) => people[i].id),
    categories: Object.fromEntries(
      p.cats.map((c) => [c.column, Object.fromEntries(c.values.map((v, vi) => [v, t.filter((m) => c.of[m] === vi).length]))]),
    ),
    numbers: Object.fromEntries(
      p.nums.map((x) => {
        const have = t.filter((m) => !Number.isNaN(x.of[m]));
        return [x.column, have.length ? have.reduce((s, m) => s + x.of[m], 0) / have.length : null];
      }),
    ),
  }));

  return { teams, conflicts, checks: checks(p, spec, teams, conflicts, labels), labels };
}

function checks(
  p: Prepared,
  spec: FormSpec,
  teams: FormedTeam[],
  conflicts: FormResult["conflicts"],
  labels: FormResult["labels"],
): Check[] {
  const out: Check[] = [];
  if (spec.avoidCurrent || spec.avoidColumns.length) {
    const who = [
      spec.avoidCurrent ? "a current teammate" : "",
      spec.avoidColumns.length ? `anyone sharing their ${spec.avoidColumns.join(" or ")}` : "",
    ].filter(Boolean).join(" or ");
    out.push(
      conflicts.length
        ? { ok: false, text: `${conflicts.length} pairs could not be kept apart from ${who} — no arrangement avoids them all.` }
        : { ok: true, text: `Nobody is on a team with ${who}.` },
    );
  }
  for (const c of p.cats) {
    const parts = c.values.map((v, vi) => {
      const counts = teams.map((t) => t.categories[c.column][v]);
      const ideal = teams.map((t) => (c.totals[vi] * t.members.length) / p.n);
      const ok = counts.every((n, i) => n >= Math.floor(ideal[i]) && n <= Math.ceil(ideal[i]));
      return { ok, text: `${labels[c.column]?.[v] ?? v} ${Math.min(...counts)}–${Math.max(...counts)}` };
    });
    out.push({ ok: parts.every((x) => x.ok), text: `${c.column}: ${parts.map((x) => x.text).join(", ")} per team.` });
  }
  for (const x of p.nums) {
    const means = teams.map((t) => t.numbers[x.column]).filter((m): m is number => m !== null);
    if (!means.length) continue;
    const sd = Math.sqrt(x.variance);
    const worst = Math.max(...means.map((m) => Math.abs(m - x.mean)));
    out.push({
      ok: worst <= Math.max(0.4 * sd, 0.5),
      text: `${x.column}: team averages ${round(Math.min(...means))}–${round(Math.max(...means))} (class ${round(x.mean)}).`,
    });
  }
  return out;
}

const round = (x: number) => (Math.abs(x) >= 10 ? Math.round(x) : Math.round(x * 10) / 10);
