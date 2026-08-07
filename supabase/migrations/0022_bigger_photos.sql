-- Photos up to 100 MB.
--
-- Run in Supabase → SQL Editor, after 0021. Safe to re-run.
--
-- Nothing is compressed on the way in — a photo of a whiteboard is evidence a
-- marker reads, and a re-encode that saves bytes softens the one faint line
-- somebody needed. So the ceiling has to be high enough for whatever a phone
-- actually writes: a recent handset in max quality, or a burst of HDR, clears
-- 25 MB without trying.
--
-- ONE THING THIS CANNOT DO ON ITS OWN. Supabase enforces a PROJECT-WIDE
-- per-file upload limit above every bucket, and a bucket's file_size_limit
-- cannot exceed it:
--
--   Free  50 MB   <- 100 MB here will be clamped to this
--   Pro   500 GB
--
-- So on the Free plan this statement runs cleanly and uploads over 50 MB still
-- fail, from the project limit rather than from the bucket. Raise it in
-- Dashboard → Storage → Settings → "Upload file size limit" once on Pro. The
-- client's own check (MAX_BYTES in src/checkins/resources.ts) matches the
-- number below, so a student is told before the bytes go up the wire rather
-- than after.

update storage.buckets
   set file_size_limit = 104857600  -- 100 MiB
 where id = 'resources';

-- Submissions stay at 50 MB. A PDF that large is a scan nobody chose to make
-- smaller, and it is already twice what a term of homework needs — raising it
-- would only make a slow room's upload fail later rather than sooner.
