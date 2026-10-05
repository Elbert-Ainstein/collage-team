// Shared rows for the assistant's tests.

import type { Student, TeamWithMembers } from "@/checkins/types";

export function student(id: string, name: string, email: string | null, position: number): Student {
  return {
    id,
    user_id: null,
    course_id: "c1",
    name,
    email,
    avatar_tint: null,
    position,
    created_at: "",
  };
}

export function team(id: string, name: string, position: number, members: Student[]): TeamWithMembers {
  return { id, team_set_id: "set1", name, position, created_at: "", members };
}

export const ada = student("st-ada", "Ada Lovelace", "ada@x.edu", 0);
export const alan = student("st-alan", "Alan Turing", "alan@x.edu", 1);
export const grace = student("st-grace", "Grace Hopper", null, 2);
export const kj = student("st-kj", "Katherine Johnson", "kj@x.edu", 3);

export const roster = [ada, alan, grace, kj];
export const team1 = team("tm-1", "Team 1", 0, [ada, alan]);
export const team2 = team("tm-2", "Team 2", 1, [grace]);
export const teams = [team1, team2];
