# Deferred (v1.1 planning)

Consciously cut or postponed items. ◇ = spec-marked deferred; ⏭ = deferred by build order.

## ◇ Deferred screens (stubbed with real layout + "coming soon", behind TEAM_MODULE_* flags)
- Team formation wizard (§5, §6.4) — `TEAM_MODULE_TEAM_FORMATION`
- AI activity generation (§6.6) — `TEAM_MODULE_AI_GENERATION`
- Live dashboard controls beyond status (§6.8) — `TEAM_MODULE_LIVE_CONTROLS`
- Oral check-in state machine (§6.9) — `TEAM_MODULE_ORAL`
- Results & analytics (§6.11) — `TEAM_MODULE_RESULTS`
- Peer evaluation (§6.12) — `TEAM_MODULE_PEER_EVAL`

## ⏭ Deferred by milestone (built later)
- M2: Team discussion, collective + individual final workspaces, participation, privacy rule
- M3: Activity builder (5 tabs), roster wizard, team management, AI-suggested grading, gradebook, student grade view
- M4: Dashboard, library, empty/loading/error states, responsive polish, Playwright happy paths, seed-reset command, load check

## Nice-to-haves not in scope for the pilot
- Real Mathpix OCR + real Anthropic grading (adapters ready; swap behind interface)
- Real multi-client realtime for collective workspace (currently simulated presence)
- Drag-to-reorder questions in builder (spec shows a drag handle; may ship static in M3)
