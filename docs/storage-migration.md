# Moving storage off Supabase

Written August 2026, for the AP 50 pilot. Decision: move. This is the plan, the
cost, and the parts that are dangerous.

---

## The one constraint that decides the design

**A Vercel function's request body is capped at 4.5 MB.** Photos are now allowed
up to 100 MB and nothing is compressed on the way in, so a file can never be
proxied through a Next.js route handler — the route would 413 before the app
saw a byte.

So the shape is fixed, and it is the same shape every serious file upload uses:

```
browser ──1── POST /api/storage/sign-upload        (small JSON: what + where)
              route verifies the JWT, re-derives permission from Postgres,
              returns a presigned PUT URL scoped to one exact key
       ──2── PUT the bytes straight to the bucket   (never touches Vercel)
       ──3── POST the row that names the object     (Supabase, as today)
```

Reads are the mirror: `POST /api/storage/sign-download` with a path, the route
checks the same predicates, returns a short-lived GET URL.

This is not a preference. Any design where the file passes through the app
server is dead on arrival at 4.5 MB.

---

## What we are giving up

Today **Postgres enforces access**, and that is the whole security model.
`storage.objects` carries RLS policies that read the owning id out of the object
**path** and join back to the row:

| bucket | path | predicate |
|---|---|---|
| `recordings` | `{course}/{activity}/{result}/{uuid}.webm` | `can_read_result(recording_result_id(name))` |
| `submissions` | `{course}/{activity}/{result}/{uuid}.pdf` | `can_read_result(...)` |
| `resources` | `{course}/{activity}/{team}/{uuid}.jpg` | `can_read_team_resources(resource_team_id(name))` |
| `activity-files` | `{activity}/{name}` | `owns_course` via `activity_of_object(name)` |

A student **physically cannot** fetch another team's recording. Not because the
client declined to ask — because the database refused. A bug in the React code
cannot leak a file.

After the move, that guarantee is **code we wrote**. The route handler becomes
the only thing standing between one team's discussion and another's. That is
the real cost of this migration, and it is not measured in dollars.

### Therefore, the non-negotiables

1. **The route re-derives permission from the database on every call.** It never
   trusts anything the client sent about who they are or what they may see.
2. **Presigned URLs are scoped to one exact key**, never a prefix. A prefix
   grant is a whole team's folder handed out in one link.
3. **Expiry is minutes, not hours.** A signed R2 URL is a bearer token: anyone
   holding it has the file. Today's one-hour Supabase links are the same risk,
   but they are minted by a system whose scoping we did not write.
4. **The path stays the source of truth for ownership.** Keep the exact
   conventions above. They are what makes a permission check possible from a key
   alone, and they are already correct.
5. **The upload path is validated server-side.** The route decides the key; the
   client does not propose one. Otherwise a student writes into another team's
   prefix and the path convention — the thing every check depends on — becomes a
   lie.

---

## What it costs

Per term, 80 students, uncompressed (~11.5 GB):

| | storage | egress | monthly |
|---|---|---|---|
| **Supabase Pro** | 100 GB included | 250 GB included | **$25** (whole platform) |
| **Cloudflare R2** | $0.015/GB-mo, 10 GB free | **free** | **~$0.02** + Supabase Free |

R2 also charges operations: $4.50 per million Class A (writes), $0.36 per
million Class B (reads). At this scale that is rounding error — a term is maybe
20k writes.

**So the money says R2 and the risk says Pro.** $25/month buys a security
boundary somebody else maintains. Worth knowing that is what you are declining.

R2 is the right target when you do move: S3-compatible (so `@aws-sdk/client-s3`
works and you are never locked in), zero egress (students replay recordings
repeatedly), and no per-file ceiling that matters here.

---

## The work, in order

**1. The route handlers** — `app/api/storage/sign-upload/route.ts` and
`sign-download/route.ts`. Each: read the `Authorization` bearer, verify it with
a Supabase server client, resolve the caller to a `students` row or a course
owner/TF, then run the *same* predicate the RLS policy runs. Reuse the SQL by
calling the existing functions over RPC (`can_read_result`, etc.) rather than
reimplementing them in TypeScript — one definition, and the one already reviewed.

**2. Swap the seam.** `src/checkins/storage.ts` already isolates every call —
`put`, `remove`, `signedUrl`, `signedUrls`. There are **zero** direct
`storage.from()` calls anywhere else; that was the point of building it. This
step is one file.

**3. Backfill.** Copy existing objects Supabase → R2 with the same keys, verify
counts per bucket, then flip the seam. Keep the Supabase objects for a term as
the rollback.

**4. Delete the Supabase buckets** only after a full term with no incidents.

### Testing that actually proves it

Nothing here is provable by clicking around as one user. Before this ships:

- Sign in as student A, capture a signed URL for their own recording. Sign in as
  student B **on another team**, call `sign-download` with A's path. It must
  refuse. Do it for all four buckets.
- Call `sign-upload` proposing a key inside another team's prefix. It must
  refuse.
- Let a signed URL expire and confirm it stops working.
- Confirm a signed URL for a *deleted* row stops being mintable.

---

## Do not do this in the four weeks before the pilot

The pilot is 80 students in a month. Standing up a hand-written authorisation
layer over students' recorded voices and graded work, and discovering its edges
during week one of a live course, is a bad trade against $25.

**Sequence:** Supabase Pro for the pilot → a term of real usage → build and test
this properly → migrate between terms, when a mistake costs nobody their work.

---

## Still to decide

- Provider: R2 assumed above. Vercel Blob is simpler to wire and materially more
  expensive; S3 is fine but pays egress.
- Whether TFs who can only grade should be able to fetch team recordings. The
  current policies say no. Worth an explicit answer before it is re-encoded in
  TypeScript, because the route handler will make it look deliberate either way.
- Signed-URL lifetime. One hour today. Minutes is safer and costs a re-sign.
