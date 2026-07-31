# Supabase setup — Class Check-ins (v1, no auth)

This is the one part I can't do for you: creating the project. It takes ~5 minutes.
Once it's done and you've pasted two values into `.env.local`, I wire up everything else.

## 1. Create a project
1. Go to <https://supabase.com> → sign in → **New project** (the free tier is plenty).
2. Name it (e.g. `class-checkins`), set a database password (save it somewhere), pick a region near you, **Create**.
3. Wait ~1–2 min for it to provision.

## 2. Run the schema
1. In the project, open **SQL Editor** → **New query**.
2. Paste the entire contents of [`migrations/0001_init.sql`](migrations/0001_init.sql) and click **Run**.
3. Repeat for each later migration **in order** — they are not optional:
   - [`0002_unique_session_code.sql`](migrations/0002_unique_session_code.sql) — stops duplicate sessions
   - [`0003_auth_owner_scoped.sql`](migrations/0003_auth_owner_scoped.sql) — **replaces the open policy with per-account access**
   - [`0004_check_secondary_refs.sql`](migrations/0004_check_secondary_refs.sql) — closes a cross-account write gap
4. You should see "Success". (Check **Table Editor** — you'll see `courses`, `students`, `activities`, `teams`, `check_ins`, `check_in_results`, etc. All empty. That's correct — the AP50A placeholder is gone; real data comes from you.)

## 3. Grab the two keys I need
In the project: **Project Settings → API**. Copy:
- **Project URL** (looks like `https://xxxx.supabase.co`)
- **anon public** key (the one labelled `anon` / `public` — this one is *designed* to live in frontend code; safe to share with me)

> Do **not** send me the `service_role` key — that one is a secret. I never need it.

## 4. Put them in `.env.local`
Copy `.env.local.example` to `.env.local` in the repo root and fill in:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...   (the anon public key)
```

## 5. Tell me it's done
Paste the **Project URL** and **anon key** here (or just say "done" if you've filled in `.env.local` locally). Then I'll:
- build the data layer (typed reads/writes for courses, roster, teams, activities, check-ins, results),
- port the Class Check-ins UI to the real app wired to your DB,
- add a "New class" flow so you create your real course + roster instead of the placeholder.

---

### Security note
`0001_init.sql` creates a deliberately **open** policy so the prototype works before accounts exist. `0003` and `0004` replace it with per-account rules: a signed-in user reaches only their own sessions, and the anon key that ships in the browser reaches nothing at all.

**Run 0003 and 0004.** With only 0001 applied, anyone holding your project URL and anon key — both visible in the browser bundle — can read and modify every roster and grade.
