// Faculty-shell demo content. Lessons & Summatives are presentational sample data
// (matching the redesign screenshots); the Activities subtab is wired to our real
// team-activity store — that's the Team Learning Module's integration point.

export interface ContentRow {
  id: string;
  title: string;
  status: "Published" | "Draft" | "Closed" | "Scheduled";
  due: string | null;
}

export const FACULTY_COURSE = {
  title: "Physical Science 101 · Unit 2 — Matter & Energy",
  lessons: 6,
  summatives: 5,
  avgCompletion: 72,
  students: 28,
  instructor: "Devanshu",
  instructorEmail: "devanshu@collage-ai.com",
};

export const LESSONS: ContentRow[] = [
  { id: "l-states", title: "Classifying Samples for States of Matter", status: "Published", due: null },
  { id: "l-particle", title: "Particle Motion & Kinetic Energy", status: "Published", due: null },
  { id: "l-phase", title: "Phase Transitions & Heating Curves", status: "Published", due: "Jul 21" },
  { id: "l-density", title: "Density & Measurement Lab", status: "Draft", due: "Jul 28" },
  { id: "l-gas", title: "Gas Laws: Pressure, Volume & Temperature", status: "Draft", due: null },
  { id: "l-mixtures", title: "Mixtures & Solutions", status: "Closed", due: "Jun 30" },
];

export const SUMMATIVES: ContentRow[] = [
  { id: "s-unit2", title: "Unit 2 Test — Matter & Energy", status: "Scheduled", due: "Aug 4" },
  { id: "s-phase", title: "Phase Change Quiz", status: "Published", due: "Jul 22" },
  { id: "s-density", title: "Density Problem Set", status: "Draft", due: "Jul 29" },
  { id: "s-gas", title: "Gas Laws Check", status: "Draft", due: null },
  { id: "s-mid", title: "Midpoint Concept Check", status: "Closed", due: "Jun 28" },
];
