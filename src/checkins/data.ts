// Supabase data access for Class Check-ins. One module per concern would be
// overkill at this size; grouped here and grown per slice.
import { requireSupabase } from "@/lib/supabaseClient";
import type { Course, Student } from "./types";

const TINTS = [
  "#0382ed", "#8a3ffc", "#d1449c", "#e8710a", "#1f9d55",
  "#0f9bb0", "#6b47dc", "#c2410c", "#0d7a6f", "#b4237a",
];
export function tintFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// ---- courses ----
export async function listCourses(): Promise<Course[]> {
  const { data, error } = await requireSupabase()
    .from("courses")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Course[];
}

export async function createCourse(input: {
  name: string;
  code?: string;
  term?: string;
}): Promise<Course> {
  const { data, error } = await requireSupabase()
    .from("courses")
    .insert({ name: input.name, code: input.code || null, term: input.term || null })
    .select()
    .single();
  if (error) throw error;
  return data as Course;
}

export async function deleteCourse(id: string): Promise<void> {
  const { error } = await requireSupabase().from("courses").delete().eq("id", id);
  if (error) throw error;
}

// ---- students / roster ----
export async function listStudents(courseId: string): Promise<Student[]> {
  const { data, error } = await requireSupabase()
    .from("students")
    .select("*")
    .eq("course_id", courseId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Student[];
}

export async function addStudents(
  courseId: string,
  names: string[],
  startPos: number,
): Promise<Student[]> {
  const rows = names.map((name, i) => ({
    course_id: courseId,
    name,
    position: startPos + i,
    avatar_tint: tintFor(name),
  }));
  const { data, error } = await requireSupabase().from("students").insert(rows).select();
  if (error) throw error;
  return (data ?? []) as Student[];
}

export async function removeStudent(id: string): Promise<void> {
  const { error } = await requireSupabase().from("students").delete().eq("id", id);
  if (error) throw error;
}
