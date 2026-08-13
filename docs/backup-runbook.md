# Backing up a term

## What is and is not already backed up

The project is on Supabase Pro, which takes **a daily backup of the Postgres database with
seven days of retention**. Grades, marks, rubrics, roster, teams and every written answer are
in that backup.

**The uploaded files are not.** Supabase's own documentation is explicit:

> Database backups do not include objects you store via the Storage API, as the database only
> includes metadata about these objects.

So the recordings, the handed-in PDFs and the team photos — around 22 GB a year, and the only
copy of a student's voice or their handwriting — have **no backup at all** unless somebody
takes one. That is what this document is for.

Point-in-Time Recovery does not change this. It is about $100/month for a seven-day window, it
*replaces* daily backups rather than extending them, and it still only covers Postgres.

## The three things worth keeping

| | What it is | Where it comes from | Size |
|---|---|---|---|
| **Grades** | The gradebook, one row per student | **Export grades** in the app | kilobytes |
| **Manifest** | One row per uploaded file: who, which activity, size, date, storage path | **Export manifest** in the app | kilobytes |
| **The files** | The actual recordings, PDFs and photos | `rclone`, below | ~22 GB/year |

The first two are buttons. The third is this runbook, because 22 GB cannot come down through a
browser and Vercel caps a request body at 4.5 MB, so nothing in the app can proxy it.

The manifest is what ties the other two together: it carries each file's **storage path**, which
is how you find a particular student's submission inside a bucket dump months later.

## Pulling the files with rclone

Do this **at the end of each term**, and **always before clearing a course's artifacts**.

### 1. Get S3 credentials

Supabase Storage speaks S3. In the dashboard, go to the project's **S3 configuration** page
(Storage settings) and **generate a pair of credentials** — an Access Key ID and a Secret Access
Key. Copy the **endpoint** and the **region** shown on that same page.

The endpoint looks like:

```
https://<project-ref>.storage.supabase.co/storage/v1/s3
```

> **These keys bypass RLS and grant full access to every bucket.** They are the most powerful
> credential this project has — more powerful than any account login, because no policy applies
> to them. Keep them in a password manager, never in the repo, never in a chat message, and
> delete the key pair from the dashboard when the backup is done. Generating a fresh pair next
> term costs nothing.

### 2. Configure rclone

```bash
rclone config create collage s3 \
  provider=Other \
  env_auth=false \
  access_key_id=YOUR_ACCESS_KEY_ID \
  secret_access_key=YOUR_SECRET_ACCESS_KEY \
  region=YOUR_REGION \
  endpoint=https://YOUR_PROJECT_REF.storage.supabase.co/storage/v1/s3
```

### 3. Check it can see the buckets before trusting it with anything

```bash
rclone lsd collage:
```

You should get four: `recordings`, `submissions`, `resources`, `activity-files`. If you get an
error or an empty list, stop — do not go on to clear anything.

### 4. Pull

```bash
rclone sync collage: ~/collage-backup/2026-fall --progress --transfers 8
```

`sync` makes the destination match the source, so re-running it later only fetches what changed.
Point it at an external drive or institutional storage, not a laptop that travels.

### 5. Verify before you delete anything

```bash
rclone size collage:
du -sh ~/collage-backup/2026-fall
```

Those two numbers should agree. **If they do not, the backup is not complete and nothing should
be cleared.**

Spot-check one real file — open a PDF, play a recording — because a byte count that matches
proves the transfer ran, not that the files are readable.

## Keeping the database beyond seven days

The daily backups roll off after a week. Once a term, take a dump you keep:

```bash
pg_dump "$SUPABASE_DB_URL" --clean --if-exists -f collage-2026-fall.sql
```

The connection string is on the project's database settings page. This is a small file and it is
worth keeping next to the rclone pull.

## When to run all this

- **End of each term** — all three, together.
- **Before clearing a course's artifacts** — all three, and verify step 5. The clear is
  irreversible: once the objects are gone, the storage policies that would have authorised
  removing them no longer match anything, and neither Supabase's backups nor anyone's admin
  access can bring them back.
- **Before any migration that touches storage policies or buckets.**

## What the app will not let you skip

The **Clear uploaded media** control will not become pressable until the manifest has been
downloaded. That is deliberate. The manifest is small, it is the record of what was destroyed,
and it is the difference between "we deleted the Fall 2026 artifacts" and being able to say
exactly what that was.

It cannot check whether you ran the rclone pull. That part is on you.
