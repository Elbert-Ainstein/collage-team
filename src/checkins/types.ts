// DB row types (mirror supabase/migrations/0001_init.sql). Grown per slice.
export interface Course {
  id: string;
  name: string;
  code: string | null;
  term: string | null;
  created_at: string;
}

export interface Student {
  id: string;
  course_id: string;
  name: string;
  email: string | null;
  avatar_tint: string | null;
  position: number;
  created_at: string;
}
