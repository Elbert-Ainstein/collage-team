# Putting Class Check-ins on the web

Right now the app only runs on your laptop (`npm run dev` → `localhost:5180`).
This is how it gets a real URL you can open from any machine.

---

## ⚠️ Read this first

**Confirm migrations `0003` and `0004` are applied before real student data goes in.**

The app is behind a sign-in wall, and access is enforced by row-level security
in the database — not by the app. Those rules arrive in
`supabase/migrations/0003_auth_owner_scoped.sql` and `0004_check_secondary_refs.sql`.
Until they are run, `0001` leaves a policy that says *anyone may read and write
everything*, and both `NEXT_PUBLIC_*` values are visible in the browser bundle —
so a public URL would expose every roster and grade regardless of the login screen.

Check it in 5 seconds: with the app signed out, run

```bash
curl "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/students?select=*" -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

`[]` means the rules are live. Rows coming back means they are not.

---

## The mental model

Three pieces, each doing one job:

| Piece | Job |
|---|---|
| **GitHub** | Stores the code. Already done. |
| **Vercel** | Watches GitHub, builds the app, serves it at a URL. |
| **Supabase** | Holds the data. Already running. |

Vercel is the natural host because Next.js is their framework — no configuration
files needed. (Netlify or Cloudflare Pages also work; the steps are similar.)

**How a deploy happens:** you push to `main` → GitHub notifies Vercel → Vercel
runs `npm install` and `npm run build` → if the build passes, the new version
goes live. If it fails, the old version stays up and you get an email. So a
broken build can't take the site down.

---

## Setup (about 10 minutes, once)

### 1. Create a Vercel account
Go to <https://vercel.com/signup> and **sign up with GitHub**. That way it can
see your repositories without extra setup.

### 2. Import the repository
- **Add New… → Project**
- Find `collage-team` and click **Import**
  (if it isn't listed, click *Adjust GitHub App Permissions* and grant access to
  the repo — it's private, so Vercel needs to be told it may see it)

Vercel will detect Next.js on its own. **Leave the build settings alone.**

### 3. Add the two environment variables — this is the step people miss

Before clicking Deploy, open **Environment Variables** and add:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://vlomakaktjoertzdqnbz.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the long `eyJhbGci…` anon key |

Both are in your local `.env.local`, and in Supabase under
**Project Settings → API**.

*Why they aren't in the repo:* `.env.local` is gitignored, so the code on GitHub
has no keys in it. Every hosting platform has this same box for exactly this
reason — config lives with the deployment, not in the source.

*Why it's safe that these ship to the browser:* the `NEXT_PUBLIC_` prefix means
Next.js embeds them in the JavaScript sent to users, and the anon key is
**designed** to be public. What stops a stranger using it is supposed to be the
database's row-level security — which is why the warning at the top of this file
matters so much. The anon key is not the lock; RLS is.

Never put the **`service_role`** key here. It bypasses all security and would
be handed to every visitor.

### 4. Deploy
Click **Deploy** and wait ~1 minute. You'll get a URL like
`collage-team.vercel.app`. Open it — the app should look exactly as it does
locally, reading the same Supabase data.

---

## After the first deploy

**Shipping a change** is just:

```bash
git push
```

Vercel rebuilds and updates the site in about a minute. No other steps.

**Preview deployments:** push a branch instead of `main` and Vercel builds it at
its own temporary URL, without touching the live site. Useful for trying
something risky.

```bash
git switch -c try-something
git push -u origin try-something     # → its own preview URL
```

**Rolling back:** Vercel → **Deployments** → find the last good one → **Promote
to Production**. Faster than fixing forward when something's broken in class.

**A custom domain** (e.g. `checkins.yourdomain.edu`): Vercel → **Settings →
Domains**, add it, and create the DNS record it shows you. Only worth doing once
students will see the URL.

---

## If something goes wrong

| Symptom | Cause |
|---|---|
| "Connect your database" on the live site | The env vars are missing or misspelled. Add them, then **redeploy** — env vars are read at build time, so an existing deployment won't pick them up. |
| Build fails on Vercel but works locally | Nearly always a type error. Run `npm run build` locally — it runs the same checks. |
| App loads but has no data | Check the Supabase URL is the right project, and that the tables exist (`supabase/SETUP.md`). |
| Changes don't appear | Check the deployment actually finished, and that you pushed to `main`. |

---

## Checklist

- [ ] Vercel account, signed up with GitHub
- [ ] Repo imported
- [ ] Both `NEXT_PUBLIC_SUPABASE_*` variables added
- [ ] First deploy succeeded and the URL opens
- [ ] Migrations `0002`, `0003` and `0004` run in Supabase
- [ ] Signed-out `curl` of the REST API returns `[]`
- [ ] Accounts created (a second one makes a placeholder-data sandbox)
