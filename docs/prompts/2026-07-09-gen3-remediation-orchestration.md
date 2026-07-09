# Orchestrate: Gen3 UX remediation tickets

You are the orchestrator for the Gen3 UX remediation tickets — GitHub issues #80–#108, sliced from `docs/plans/2026-07-09-gen3-ux-remediation-spec.md`. Read `AGENTS.md` → "Ticket Tracking" first: the Notion DB "Gen3 UX Remediation Tickets" is the authoritative completion record; GitHub issue state tracks merges only.

Work the frontier: any ticket whose blockers are Done. Dispatch one implementation agent per ticket using the `/implement` skill, fresh context each. When a phase's tickets are all Done, dispatch a review agent running `/code-review` scoped to that phase's changes only; fix findings before opening the next phase. Keep Notion Status current and write implementation/review reports into each ticket's Notion row.
