import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import type {
  Activity,
  AiGradeSuggestion,
  ApprovedGrade,
  AudioDiscussion,
  CollectiveResponse,
  Course,
  IndividualFinalResponse,
  Member,
  OriginalResponse,
  ProgressReport,
  Role,
  Team,
  TeamResource,
} from "@/types";
import {
  BRIDGE_ACTIVITY,
  CURRENT_STUDENT_ID,
  OTHER_ACTIVITIES,
  SEED_COURSE,
  SEED_MEMBERS,
  SEED_TEAMS,
  SEED_TEAM_3,
  seedAllOriginals,
  seedAudioDiscussions,
  seedProgressReports,
  seedTeam3Collective,
  seedTeamResources,
} from "@/seed";

export interface AppState {
  // session
  role: Role;
  currentStudentId: string; // "you" in student role
  currentActivityId: string;

  // domain data
  course: Course;
  members: Member[];
  teams: Team[];
  activities: Activity[];
  originals: OriginalResponse[];
  collectives: CollectiveResponse[];
  individualFinals: IndividualFinalResponse[];
  aiSuggestions: AiGradeSuggestion[];
  approvedGrades: ApprovedGrade[];
  // Team Tab (team-centric activities)
  teamResources: TeamResource[];
  audioDiscussions: AudioDiscussion[];
  progressReports: ProgressReport[];

  // low-level mutators (services/ call these; UI should prefer services/)
  setRole: (role: Role) => void;
  setCurrentActivity: (id: string) => void;
  replaceState: (partial: Partial<AppState>) => void;
  _upsertOriginal: (r: OriginalResponse) => void;
  _upsertCollective: (r: CollectiveResponse) => void;
  _upsertIndividualFinal: (r: IndividualFinalResponse) => void;
  _upsertAiSuggestion: (s: AiGradeSuggestion) => void;
  _upsertApprovedGrade: (g: ApprovedGrade) => void;
  _updateActivity: (id: string, patch: Partial<Activity>) => void;
  _addActivity: (a: Activity) => void;
  _setRoster: (members: Member[], teams: Team[]) => void;
  _upsertTeam: (t: Team) => void;
  _addTeamResource: (r: TeamResource) => void;
  _addAudioDiscussion: (d: AudioDiscussion) => void;
  _upsertProgressReport: (p: ProgressReport) => void;
  reset: (fresh?: boolean) => void;
}

// Default boot = "grading day" populated state: Maya's prep is submitted and
// Team 3's collective is submitted (ungraded), so the instructor loop is
// demoable out of the box. `?reset=fresh` gives the pre-prep student state.
function initialData(fresh = false) {
  return {
    role: "student" as Role,
    currentStudentId: CURRENT_STUDENT_ID,
    currentActivityId: BRIDGE_ACTIVITY.id,
    course: SEED_COURSE,
    members: SEED_MEMBERS,
    teams: [SEED_TEAM_3, ...SEED_TEAMS.filter((t) => t.id !== SEED_TEAM_3.id)],
    activities: [BRIDGE_ACTIVITY, ...OTHER_ACTIVITIES],
    originals: seedAllOriginals(fresh),
    collectives: fresh ? [] : [seedTeam3Collective()],
    individualFinals: [] as IndividualFinalResponse[],
    aiSuggestions: [] as AiGradeSuggestion[],
    approvedGrades: [] as ApprovedGrade[],
    teamResources: fresh ? [] : seedTeamResources(),
    audioDiscussions: fresh ? [] : seedAudioDiscussions(),
    progressReports: fresh ? [] : seedProgressReports(),
  };
}

// Persist to the browser so a page refresh keeps locked originals & submissions
// (the no-backend stand-in for server-side durability). Disabled under tests so
// each spec starts from a clean seed via reset() in beforeEach.
const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
const isTest = process.env.NODE_ENV === "test";

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      ...initialData(),

  setRole: (role) => set({ role }),
  setCurrentActivity: (id) => set({ currentActivityId: id }),
  replaceState: (partial) => set(partial),

  _upsertOriginal: (r) =>
    set((s) => ({
      originals: upsert(s.originals, r, (x) => x.memberId === r.memberId && x.activityId === r.activityId),
    })),
  _upsertCollective: (r) =>
    set((s) => ({
      collectives: upsert(s.collectives, r, (x) => x.teamId === r.teamId && x.activityId === r.activityId),
    })),
  _upsertIndividualFinal: (r) =>
    set((s) => ({
      individualFinals: upsert(s.individualFinals, r, (x) => x.memberId === r.memberId && x.activityId === r.activityId),
    })),
  _upsertAiSuggestion: (sg) =>
    set((s) => ({
      aiSuggestions: upsert(s.aiSuggestions, sg, (x) => x.target === sg.target && x.activityId === sg.activityId),
    })),
  _upsertApprovedGrade: (g) =>
    set((s) => ({
      approvedGrades: upsert(s.approvedGrades, g, (x) => x.target === g.target && x.activityId === g.activityId),
    })),
  _updateActivity: (id, patch) =>
    set((s) => ({
      activities: s.activities.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })),
  _addActivity: (a) => set((s) => ({ activities: [a, ...s.activities] })),
  _setRoster: (members, teams) => set(() => ({ members, teams })),
  _upsertTeam: (t) => set((s) => ({ teams: upsert(s.teams, t, (x) => x.id === t.id) })),
  _addTeamResource: (r) => set((s) => ({ teamResources: [...(s.teamResources ?? []), r] })),
  _addAudioDiscussion: (d) => set((s) => ({ audioDiscussions: [...(s.audioDiscussions ?? []), d] })),
  _upsertProgressReport: (p) =>
    set((s) => ({
      progressReports: upsert(s.progressReports ?? [], p, (x) => x.teamId === p.teamId && x.activityId === p.activityId),
    })),

      reset: (fresh = false) => set({ ...initialData(fresh) }),
    }),
    {
      name: "collage-team-module",
      // Skip auto-hydration: the server and the client's FIRST render both use the
      // seed (so they match — no hydration mismatch); Boot rehydrates from
      // localStorage after mount. Standard Next.js + zustand/persist pattern.
      skipHydration: true,
      storage: createJSONStorage(() => (isTest || typeof window === "undefined" ? noopStorage : window.localStorage)),
      // Persist session + all mutable domain data (not the static seed catalogs).
      partialize: (s) => ({
        role: s.role,
        currentStudentId: s.currentStudentId,
        currentActivityId: s.currentActivityId,
        members: s.members,
        teams: s.teams,
        activities: s.activities,
        originals: s.originals,
        collectives: s.collectives,
        individualFinals: s.individualFinals,
        aiSuggestions: s.aiSuggestions,
        approvedGrades: s.approvedGrades,
        teamResources: s.teamResources,
        audioDiscussions: s.audioDiscussions,
        progressReports: s.progressReports,
      }),
      // Schema-drift guard: merge persisted state over a fresh seed and force the
      // newer slices to arrays, so a browser with older localStorage never
      // rehydrates a `undefined` collection (which would crash .filter/.map).
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<AppState>) };
        merged.teamResources = merged.teamResources ?? [];
        merged.audioDiscussions = merged.audioDiscussions ?? [];
        merged.progressReports = merged.progressReports ?? [];
        merged.aiSuggestions = merged.aiSuggestions ?? [];
        merged.approvedGrades = merged.approvedGrades ?? [];
        merged.collectives = merged.collectives ?? [];
        merged.individualFinals = merged.individualFinals ?? [];
        return merged;
      },
    },
  ),
);

function upsert<T>(list: T[], item: T, match: (x: T) => boolean): T[] {
  const idx = list.findIndex(match);
  if (idx === -1) return [...list, item];
  const next = list.slice();
  next[idx] = item;
  return next;
}

// Convenience selectors used across the app.
export function teamOfMember(state: AppState, memberId: string): Team | undefined {
  return state.teams.find((t) => t.memberIds.includes(memberId));
}

export function memberById(state: AppState, id: string): Member | undefined {
  return state.members.find((m) => m.id === id);
}

export function activityById(state: AppState, id: string): Activity | undefined {
  return state.activities.find((a) => a.id === id);
}
