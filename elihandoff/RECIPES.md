# Orchestration recipes (proven across 30+ agent integrations)

## Transplanting a branch/clone into main

Preferred (3-way, preserves intent on conflicts):
```
git -C <their workspace> diff <base-sha> <their-head> > patch.diff
cd Desktop/selfboot && git apply -p1 --3way patch.diff
```
- Conflicts land as `UU` files with markers; resolve ADDITIVELY (both sides
  usually belong — imports union, registries get both entries, package.json
  scripts merge; watch trailing commas in JSON).
- The 3-way may silently eat a closing brace when both sides appended at
  the same spot — `npm run typecheck` immediately after resolving.
- A clone's branch can also be fetched directly:
  `git -C Desktop/selfboot fetch C:/Users/Owner/Desktop/bq-<name> <branch>:<branch>`
  then cherry-pick/merge (clones share history with main, unlike the old
  wrong-repo worktrees).
- CONTENT FILES (content/packs, content/seed, content/campaign): if a
  sha-mismatch appears after transplant, DO NOT hand-fix bytes — rerun the
  deterministic generator (seed:import:*, seed:campaign,
  seed:quests:drafts, seed:variants) and let it rewrite the pack.
- Gitignored state travels by copy: .cache/checkouts/<repo>@<sha> dirs and
  .seed-journal/*.jsonl.

## Fingerprint-aware integration order

1. Land ALL code changes that touch fingerprinted files (factory, harness,
   validators, runners) across every branch FIRST.
2. THEN one restamp pass: full `seed:validate` per code-pack source +
   `seed:check -- --restamp` (or the `restamp:all` script once the OPS
   branch lands). Sweeping between code landings wastes a full sweep.
3. Content-only branches (packs/drafts) can land before or after — their
   stamps only depend on their own bytes + the seed fingerprint.

## Sweep mechanics

- Journaled + resumable: `.seed-journal/<source>.jsonl`, entries keyed by
  exerciseHash(unit, content, fingerprint) — survives interrupts; delete it
  only for a deliberately fresh run.
- Foreground, chunked: `npm run seed:validate -- --source <s> --course <c>`
  per chunk; JS courses 4–6 per call, TS courses ONE per call (tsc 8–25s ×
  ~15 exercises), C# sources whole (csbootcamp ~30–70s, jstrain-cs ~2–3
  min). The final full `--source <s>` run (journal-backed, + 2% audit)
  writes the stamp. `--course` runs DELETE the stamp by design.
- A timing-flaked good exercise can be falsely quarantined under load —
  re-run its course on a quiet machine (`--retry-failed`), then the full
  run. The two-strikes rule (jstrain) mitigates but doesn't cover all.

## Gate verification duty (the orchestrator's own hands)

Never report green you did not see. Per integration: typecheck + the
touched workspaces' suites + smoke:api; per milestone: the full battery in
STATE.md plus demo:promotion / demo:campaign / demo:m4 as relevant. The
known load-flake (js adapter infinite-loop test) passes solo — one solo
re-run is the accepted proof. Content batches additionally get a ≥10%
human spot-check of items against their cited source spans (validators
prove citations RESOLVE, not that they SUPPORT the claim).

## Review discipline

Every wave's diff gets a fresh-context review before the orchestrator
gates and commits (this caught real exploits every single time: REPLACE
trigger bypass, answer-oracle run, retest solve-ahead, locked-act leak).
Deep honesty audits after any wave touching engines/evidence/promotion.

## Agent workspace patterns (what actually works on this machine)

- Parallel build agents: plain local clones
  (`git clone --local Desktop/selfboot Desktop/bq-<name>`) — simplest.
  Harness worktrees come from the WRONG repo (home dir); the repair recipe
  (`git fetch <selfboot> main:refs/selfboot/main` + `checkout -b`) works
  but clones avoid the whole class, including the home-repo lock races and
  corrupt-metadata refusals seen at 5+ concurrent creations.
- MAIN workspace: exactly ONE agent at a time (npm/install/DB collisions).
- Content agents never edit factory/fingerprinted code or
  exclusions.json; improvement agents never author content — keeps
  restamps predictable and reviews scoped.
- Every agent brief ends with: foreground-only, taskkill /T /F for child
  trees, "never report green you did not see", and a mandatory report
  format (trace table + verbatim gate tails + transplant list).
- Stop orders work: "commit only consistent validator-green work, prefix
  WIP:, report state" — all 8 Phase-A agents stopped clean this way.

## Commit format

`git commit -F <msgfile>`; conventional type (feat/fix/docs/chore); body
lists what + the orchestrator-verified gates; trailers =
`Co-Authored-By: <drafting model> <noreply@anthropic.com>` lines (this
campaign: Claude Fable 5; add your own session's model per its rules).
