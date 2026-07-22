import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import type {
  Activity,
  ApprovedGrade,
  CollectiveResponse,
  Course,
  IndividualFinalResponse,
  Member,
  OriginalResponse,
  Role,
  Team,
} from "@/types";
import {
  BRIDGE_ACTIVITY,
  CURRENT_STUDENT_ID,
  OTHER_ACTIVITIES,
  SEED_COURSE,
  SEED_MEMBERS,
  SEED_TEAMS,
  SEED_TEAM_3,
  seedTeammateOriginals,
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
  approvedGrades: ApprovedGrade[];

  // low-level mutators (services/ call these; UI should prefer services/)
  setRole: (role: Role) => void;
  setCurrentActivity: (id: string) => void;
  replaceState: (partial: Partial<AppState>) => void;
  _upsertOriginal: (r: OriginalResponse) => void;
  _upsertCollective: (r: CollectiveResponse) => void;
  _upsertIndividualFinal: (r: IndividualFinalResponse) => void;
  _upsertApprovedGrade: (g: ApprovedGrade) => void;
  _updateActivity: (id: string, patch: Partial<Activity>) => void;
  reset: () => void;
}

function initialData() {
  return {
    role: "student" as Role,
    currentStudentId: CURRENT_STUDENT_ID,
    currentActivityId: BRIDGE_ACTIVITY.id,
    course: SEED_COURSE,
    members: SEED_MEMBERS,
    teams: [SEED_TEAM_3, ...SEED_TEAMS.filter((t) => t.id !== SEED_TEAM_3.id)],
    activities: [BRIDGE_ACTIVITY, ...OTHER_ACTIVITIES],
    originals: seedTeammateOriginals(),
    collectives: [] as CollectiveResponse[],
    individualFinals: [] as IndividualFinalResponse[],
    approvedGrades: [] as ApprovedGrade[],
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
const isTest = import.meta.env?.MODE === "test";

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
  _upsertApprovedGrade: (g) =>
    set((s) => ({
      approvedGrades: upsert(s.approvedGrades, g, (x) => x.target === g.target && x.activityId === g.activityId),
    })),
  _updateActivity: (id, patch) =>
    set((s) => ({
      activities: s.activities.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })),

      reset: () => set({ ...initialData() }),
    }),
    {
      name: "collage-team-module",
      storage: createJSONStorage(() => (isTest || typeof window === "undefined" ? noopStorage : window.localStorage)),
      // Persist only session + mutable domain data (not the static seed catalogs).
      partialize: (s) => ({
        role: s.role,
        currentStudentId: s.currentStudentId,
        currentActivityId: s.currentActivityId,
        activities: s.activities,
        originals: s.originals,
        collectives: s.collectives,
        individualFinals: s.individualFinals,
        approvedGrades: s.approvedGrades,
      }),
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
