"use client";

// Before a team plays (0051): it picks who submits for it, then that person
// takes the roll. Every phone votes for itself and watches the same tally come
// back over realtime. Where the team is comes from the database, so a refresh
// lands on the same step, and a student marked absent sees only that.

import { useState } from "react";
import type { Student, TeamWithMembers } from "@/checkins/types";
import { confirmLeader, setAbsences, voteLeader } from "@/live/data";
import type { LiveModel } from "@/live/model";
import { Av, Ic } from "@/live/ui";
import { forStudent } from "./forStudent";
import { firstName, TeamPlay } from "./TeamVote";

interface SetupProps {
  m: LiveModel;
  team: TeamWithMembers;
  meId: string;
  onError: (message: string) => void;
  /** Something went in: read the session now rather than wait for realtime. */
  onChanged: () => Promise<void> | void;
}

const memberOf = (team: TeamWithMembers, id: string | null): Student | null =>
  team.members.find((s) => s.id === id) ?? null;

/** "You" for this phone's student, a first name for anyone else. */
const callName = (team: TeamWithMembers, meId: string, id: string | null): string => {
  if (id === meId) return "You";
  const who = memberOf(team, id);
  return who ? firstName(who.name) : "Your leader";
};

/** Team mode, after Start: leader, then the roll, then play — the step the database says. */
export function TeamSession(props: SetupProps) {
  const { m, team, meId, onError, onChanged } = props;
  // The leader reopened the roll from play: someone turned up late.
  const [reroll, setReroll] = useState(false);
  if (m.isAbsent(meId)) return <MarkedAbsent team={team} leaderId={m.leaderOf(team.id)} />;
  const stage = m.stage(team.id);
  if (stage === "leader") return <LeaderVote {...props} />;
  const leader = m.leaderOf(team.id);
  const leads = leader === meId;
  // A team of one has nobody to call.
  const alone = team.members.length < 2;
  if (!alone && (stage === "roll" || (reroll && leads))) {
    if (!leads) return <RollWait team={team} leaderId={leader} />;
    return (
      <RollCall
        {...props}
        again={stage === "play"}
        onDone={() => setReroll(false)}
      />
    );
  }
  return (
    <TeamPlay
      m={m}
      team={team}
      meId={meId}
      onError={onError}
      onTried={onChanged}
      onRoll={leads && !alone ? () => setReroll(true) : undefined}
    />
  );
}

// ------------------------------------------------------------ the leader

type LeaderState = { title: string; sub: string; confirm: boolean };

/** What the bar at the bottom says about the vote for leader. */
function leaderState(m: LiveModel, team: TeamWithMembers, meId: string, mine: string | null): LeaderState {
  const t = m.leaderTally(team.id);
  const sub = `${t.voted} of ${t.present} voted`;
  if (!mine) return { title: "Pick one", sub, confirm: false };
  if (t.split) return { title: "Votes are split — agree on one person", sub, confirm: false };
  if (!t.agreed) return { title: "Voting…", sub, confirm: false };
  const who = callName(team, meId, t.agreed);
  return t.canConfirm
    ? { title: `All on ${who === "You" ? "you" : who}`, sub, confirm: t.picks[meId] !== undefined }
    : { title: "Wait for one more vote", sub, confirm: false };
}

function LeaderVote({ m, team, meId, onError, onChanged }: SetupProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState<"vote" | "confirm" | null>(null);
  const tally = m.leaderTally(team.id);
  const away = new Set(m.absentIds(team.id));
  const here = team.members.filter((s) => !away.has(s.id));
  const mine = pending ?? tally.picks[meId] ?? null;
  const state = leaderState(m, team, meId, mine);
  const aid = m.state.activity_id;

  const vote = async (id: string) => {
    if (busy !== null || id === tally.picks[meId]) return;
    setPending(id);
    setBusy("vote");
    try {
      await voteLeader(aid, id);
      await onChanged();
    } catch (e) {
      onError(forStudent(e, "Your vote didn’t go through. Try again."));
    } finally {
      setPending(null);
      setBusy(null);
    }
  };
  const confirm = async () => {
    setBusy("confirm");
    try {
      await confirmLeader(aid);
      await onChanged();
    } catch (e) {
      onError(forStudent(e, "Couldn’t confirm. Try again."));
    } finally {
      setBusy(null);
    }
  };
  const agreedName = tally.agreed ? callName(team, meId, tally.agreed) : "";

  return (
    <>
      <div className="lq-sscroll">
        <span className="fv-eyebrow lq-sq">{team.name} · Leader</span>
        <h2 className="lq-setupq">Who submits for the team?</h2>
        <div className="lq-choices" role="radiogroup" aria-label="Team leader">
          {here.map((s) => {
            const voters = here.filter((v) => tally.picks[v.id] === s.id);
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={mine === s.id}
                className={`lq-choice team lq-leadpick${mine === s.id ? " on" : ""}${tally.agreed === s.id ? " agreed" : ""}`}
                onClick={() => void vote(s.id)}
              >
                <Av p={s} size={30} />
                <span className="lq-choicet">{s.id === meId ? "You" : s.name}</span>
                <span className="lq-voters">
                  {voters.map((v) => (
                    <span key={v.id} className="lq-voterpop">
                      <Av p={v} size={24} ring={v.id === meId} />
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <footer className={`lq-sfoot team${state.confirm ? " agreed" : ""}`}>
        <span className="lq-footmsg">
          <b>{state.title}</b>
          <span className="fv-sub">{state.sub}</span>
        </span>
        {state.confirm ? (
          <span className="lq-footbtns">
            <button type="button" className="fv-btn primary lq-teambtn" disabled={busy !== null} onClick={() => void confirm()}>
              {busy === "confirm" ? "Confirming…" : `Confirm ${agreedName === "You" ? "yourself" : agreedName}`}
            </button>
          </span>
        ) : null}
      </footer>
    </>
  );
}

// -------------------------------------------------------------- the roll

function RollCall({ m, team, meId, onError, onChanged, again, onDone }: SetupProps & { again: boolean; onDone: () => void }) {
  const mates = team.members.filter((s) => s.id !== meId);
  // Marked on the sheet by staff: fixed here, and set_live_absences leaves them be.
  const fixed = new Set(m.absentIds(team.id, "sheet"));
  const [away, setAway] = useState<ReadonlySet<string>>(() => new Set(m.absentIds(team.id, "roll").filter((id) => id !== meId)));
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) =>
    setAway((prev) => (prev.has(id) ? new Set([...prev].filter((x) => x !== id)) : new Set([...prev, id])));
  const out = (id: string) => fixed.has(id) || away.has(id);
  const here = team.members.filter((s) => !out(s.id)).length;

  const save = async () => {
    setBusy(true);
    try {
      await setAbsences(m.state.activity_id, [...away].filter((id) => !fixed.has(id)));
      await onChanged();
      onDone();
    } catch (e) {
      onError(forStudent(e, "Couldn’t save the roll. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="lq-sscroll">
        <span className="fv-eyebrow lq-sq">{team.name} · Roll</span>
        <h2 className="lq-setupq">Who’s here?</h2>
        <div className="lq-choices" role="group" aria-label="Who’s here">
          {mates.map((s) => {
            const gone = out(s.id);
            const byStaff = fixed.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                role="checkbox"
                aria-checked={!gone}
                disabled={byStaff}
                className={`lq-choice team lq-leadpick lq-roll${gone ? " away" : " on"}`}
                onClick={() => toggle(s.id)}
              >
                <Av p={s} size={30} dim={gone} />
                <span className="lq-choicet">{s.name}</span>
                <span className="lq-rollstate">{byStaff ? "Absent · instructor" : gone ? "Absent" : "Here"}</span>
              </button>
            );
          })}
        </div>
      </div>
      <footer className="lq-sfoot team">
        <span className="lq-footmsg">
          <b>
            {here} of {team.members.length} here
          </b>
        </span>
        <span className="lq-footbtns">
          {again ? (
            <button type="button" className="fv-btn outline lq-teambtn" disabled={busy} onClick={onDone}>
              Cancel
            </button>
          ) : null}
          <button type="button" className="fv-btn primary lq-teambtn" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : again ? "Save" : <>Continue <Ic name="arrowRight" size={15} /></>}
          </button>
        </span>
      </footer>
    </>
  );
}

function RollWait({ team, leaderId }: { team: TeamWithMembers; leaderId: string | null }) {
  const leader = memberOf(team, leaderId);
  return (
    <div className="lq-sscroll lq-center">
      <div className="lq-scard lq-intro lq-wait">
        {leader ? <Av p={leader} size={44} /> : null}
        <h2 className="lq-h2">{leader ? firstName(leader.name) : "Your leader"} submits for the team</h2>
        <p className="fv-sub">Taking the roll…</p>
      </div>
    </div>
  );
}

function MarkedAbsent({ team, leaderId }: { team: TeamWithMembers; leaderId: string | null }) {
  const leader = memberOf(team, leaderId);
  return (
    <div className="lq-sscroll lq-center">
      <div className="lq-scard lq-intro lq-wait">
        <h2 className="lq-h2">Marked absent for this session</h2>
        <p className="fv-sub">Here after all? Tell {leader ? firstName(leader.name) : "your team’s leader"}.</p>
      </div>
    </div>
  );
}
