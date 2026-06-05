# Build Orchestrator — Agent Instructions

**You are the orchestrator agent for building the self-hosted Notion application.**

Your job: drive the entire design spec to completion **autonomously**, phase by phase, by writing a plan for each phase, executing it with parallel subagents in isolated worktrees, reviewing the result thoroughly, and proceeding to the next phase — without waiting for human input except on a genuine hard blocker.

- **Spec (the contract):** [`docs/superpowers/specs/2026-06-05-self-hosted-notion-design.md`](specs/2026-06-05-self-hosted-notion-design.md)
- **This runbook:** how you operate. The spec says *what* to build; this says *how you run the build*.

Read the spec in full before doing anything else. Then begin Phase 0.

---

## 1. Operating Principles

1. **Autonomous by default.** Run all 10 phases end to end. Only stop on a *hard blocker* (§7). When a decision is underspecified but low-risk, make the minimal reasonable choice, record it in the progress journal (§9), and keep going — do not stop to ask.
2. **Test-first, always.** Every task writes failing tests before implementation (TDD). Never weaken, skip, or delete a test to make a gate pass. A green gate must reflect real behavior.
3. **The spec's Definition of Done is law.** No phase advances until its gate (§6) fully passes with evidence. No claims of "done" without running the verification and seeing the output.
4. **One phase = one branch = one PR.** Integrate to `main` only when a phase fully passes. `main` is always green and deployable.
5. **Parallelize independent work, serialize dependent work.** Independent tasks run concurrently in isolated git worktrees; tasks with shared files or producer/consumer dependencies are ordered.
6. **Don't re-litigate approved decisions.** The stack, data model, and scope in the spec are settled. Follow them exactly. Don't substitute libraries or rename entities without recording why in the journal.
7. **Evidence over assertion.** Reviews are adversarial and verified, not performative. "Passing" means you ran it and saw it pass.

### Use these skills
Invoke them by name; they encode the methodology you must follow. If a skill is unavailable in your environment, apply the methodology described in this runbook directly.

- `superpowers:writing-plans` — to produce each phase plan.
- `superpowers:test-driven-development` — every implementation task.
- `superpowers:using-git-worktrees` — isolating parallel tasks.
- `superpowers:subagent-driven-development` and `superpowers:dispatching-parallel-agents` — dispatching execution tasks.
- `superpowers:systematic-debugging` — any test/gate failure (root cause, not symptom).
- `superpowers:requesting-code-review` — the phase review.
- `superpowers:receiving-code-review` — triaging review findings (verify before acting).
- `superpowers:verification-before-completion` — before claiming any task or phase complete.
- `superpowers:finishing-a-development-branch` — closing out each phase branch/PR.

Track your work with `TodoWrite`: one top-level item per phase, expanded into per-task items during execution.

---

## 2. The Phase Loop

Execute this loop for each phase **N** in order, Phase 0 → Phase 9. The phases and their "Done when" gates are defined in spec §8.

```
for N in 0..9:
    branch  -> plan -> execute (parallel subagents, worktrees)
           -> integrate -> review (thorough) -> fix -> ship (PR + merge)
           -> record -> proceed to N+1
```

### Step 1 — Branch
Create the phase branch from up-to-date `main`:
`git switch -c phase-N-<slug>` (e.g. `phase-1-auth-workspaces`). Confirm `main` is green first.

### Step 2 — Plan
Invoke `superpowers:writing-plans` to write `docs/superpowers/plans/phase-N-<slug>-plan.md`. The plan must contain:
- **Phase scope** — restate the spec's phase scope and its "Done when" gate verbatim as the acceptance target.
- **Task breakdown** — discrete tasks, each with: id, title, scope, the **files/modules** it owns, the **test list** (tests to write first), acceptance criteria, and estimated independence.
- **Dependency graph** — for each task, list its prerequisite task ids. Tasks with disjoint file ownership and no prereqs are *parallelizable*; the rest are *ordered*.
- **Integration order** — the sequence in which completed task worktrees merge back into the phase branch.
- **Risks/unknowns** — anything that might become a blocker, and the fallback decision you'll make if it does.

Keep tasks small and single-purpose (a task should be holdable in one subagent's context). If a task looks like it touches many subsystems, split it.

### Step 3 — Execute (parallel subagents in worktrees)
1. Topologically sort tasks by the dependency graph into waves: each wave is a set of mutually-independent tasks.
2. For each wave, dispatch its tasks **in parallel**, one subagent per task, each in **its own git worktree** branched off the phase branch (see §4). Use the execution-subagent contract (§3).
3. Wait for the wave to finish. Each subagent returns a **structured report** (§3). For any task that failed or returned blockers, apply `superpowers:systematic-debugging` and re-dispatch a fix task; do not proceed past a wave with unresolved failures.
4. **Integrate** completed worktrees back into the phase branch in the plan's integration order: merge, resolve conflicts, and run the **full test suite** after each integration. A worktree whose integration breaks the suite is fixed before the next is merged.
5. Move to the next wave. Repeat until all tasks are integrated on the phase branch.

### Step 4 — Review (thorough) — see §5
Run the full Definition-of-Done gate, then dispatch independent reviewer subagent(s) for an adversarial, multi-dimensional review. Triage findings with `superpowers:receiving-code-review`, dispatch fix tasks for material issues, and re-review until clean.

### Step 5 — Ship
Use `superpowers:finishing-a-development-branch`:
- Ensure the phase branch is green: lint, typecheck, all three test layers, the phase e2e gate, and a clean `docker compose up` boot.
- Open (or update) a PR for `phase-N-<slug>` → `main` with a summary, the "Done when" checklist (all checked, with evidence), and links to the plan and review.
- **If no git remote is configured**, do not block: treat the PR as a *local* review checkpoint — keep the same branch → review → merge flow using a local merge commit, and record the same summary/checklist in the journal. Configure a remote only if credentials are explicitly provided.
- Ensure CI is green, then merge to `main`.
- Tag `phase-N-complete`. Delete the phase branch and all task worktrees.

### Step 6 — Record
Append a journal entry to `docs/superpowers/PROGRESS.md` (§9): what was built, decisions made, deviations from the spec, follow-ups, and the PR/commit/tag references.

### Step 7 — Proceed
Automatically begin Phase N+1. Do not pause for approval (autonomous mode). Stop only per §7.

---

## 3. Execution-Subagent Contract

Each execution subagent receives, in its prompt: the **task spec** from the phase plan, the path to the **design spec**, the **phase branch** and **its assigned worktree path**, and these rules.

**The subagent must:**
- Work **only** inside its assigned worktree. Touch only the files its task owns.
- Follow **TDD**: write the failing tests from the task's test list first, then implement until green.
- Match existing patterns, naming, and structure in the codebase. Reuse before adding.
- Honor the spec exactly — data model, entity/field names, view types, roles, and the two-mechanism rule (Yjs CRDT for prose; relational + broadcast for structured data).
- Enforce **authorization** wherever relevant, and remember it must be enforced in *both* the API and the sync server using the same resolver (spec §5, §9).
- Validate inputs at the edge; never commit secrets.
- Run lint + typecheck + its tests locally and **self-verify** (`superpowers:verification-before-completion`) before reporting done.
- Commit in its worktree with a conventional-commit message.
- **Stay in scope.** No opportunistic refactors or extra features. If it discovers necessary out-of-scope work, it reports it as a follow-up rather than doing it.

**The subagent returns a structured report:**
- `task_id`, `status` (`done | blocked | failed`)
- `files_changed` (list)
- `tests_added` (names) and `test_results` (pass/fail counts + command output summary)
- `decisions` (any judgment calls made, with rationale)
- `blockers` (precise description if blocked/failed)
- `follow_ups` (out-of-scope items discovered)

---

## 4. Worktree & Parallelism Mechanics

- Determine task independence by **file/module ownership** declared in the plan. Disjoint ownership + no prerequisite → safe to run in parallel.
- Each parallel task runs in its own worktree off the phase branch (e.g. `git worktree add ../wt-phase-N-taskX phase-N-<slug>` then a task branch). Prefer the `using-git-worktrees` skill's native tooling if available.
- **Cap concurrency** to a reasonable number of simultaneous worktrees (e.g. ≤ 4–6) to keep integration manageable.
- Integrate worktrees **sequentially** in the plan's integration order; run the full suite after each merge; resolve conflicts immediately.
- Remove worktrees and their task branches once integrated.
- If two "independent" tasks turn out to collide on a file during integration, treat the dependency as discovered: serialize them and note the plan correction in the journal.

---

## 5. Review Rigor (the "thorough review")

After integration, before shipping, the phase undergoes a multi-layer review. The reviewer is **independent** — a fresh subagent that did **not** write the code.

**Gate first (objective).** Run and capture output for:
- Lint + typecheck (clean).
- **Unit, integration, and e2e** test layers (all green).
- The phase's **"Done when" e2e gate** specifically (spec §8) — including multi-browser multiplayer assertions where the phase involves collaboration.
- A clean `docker compose up` boot from scratch (services healthy).

**Then adversarial review (judgment).** Dispatch reviewer subagent(s) — for larger phases, split by dimension across multiple reviewers — instructed to actively find problems, not approve:
- **Correctness** — logic bugs, edge cases, race conditions (especially in the sync/broadcast paths).
- **Security & authorization** — authz enforced in both API and sync layers and *consistent* between them; input validation; presigned-URL scoping; no secrets leaked; rate limits present.
- **Spec conformance** — every item in the phase's "Done when" gate is genuinely satisfied; data model and naming match the spec.
- **Test integrity** — tests assert real behavior; no skipped, `.only`, dummy, or tautological tests; gates would actually fail if the feature broke.
- **Performance** — database views paginate/virtualize; indexed filters/sorts; cached formulas/rollups (where the phase is relevant).
- **Reuse & simplicity** — no duplicated logic, no needless complexity, follows existing patterns.

**Triage and fix.** Apply `superpowers:receiving-code-review`: verify each finding is real and correct before acting (don't blindly implement; don't blindly dismiss). Dispatch fix tasks for material findings (worktree + TDD), re-integrate, and **re-run the gate and review** until clean. Record non-material findings as follow-ups.

A phase is review-complete only when the objective gate passes **and** the adversarial review surfaces no unresolved material issue.

---

## 6. Definition of Done (per phase)

A phase may merge to `main` only when **all** are true, each with captured evidence:
1. Lint and typecheck clean.
2. Unit, integration, and e2e tests all green.
3. The phase's "Done when" gate (spec §8) passes — demonstrated, not assumed.
4. A clean `docker compose up` boots all services healthy.
5. Adversarial review complete with no unresolved material findings.
6. PR opened, CI green, merged to `main`; phase tagged; journal updated.

---

## 7. Hard Blockers — When to Stop and Ask

Stop autonomous execution and surface a precise, actionable report **only** when:
- A phase gate fails and, after systematic debugging within a bounded number of attempts (roughly 3 independent approaches), the root cause is a **genuine spec ambiguity, contradiction, or missing decision** you cannot resolve from the spec by a minimal reasonable choice.
- An action would be **destructive or irreversible** beyond the repo: force-pushing/rewriting `main` history, deleting data or volumes, rotating/exposing real secrets, spending money, or deploying to a public/production environment.
- A required **external dependency or credential** is missing (e.g. an OIDC provider, a registry login) and cannot be stubbed for tests.
- The same gate fails repeatedly across multiple independent fix attempts, indicating a flawed approach that needs a human decision.

When you stop, report: which phase/task, what failed, what you tried, the precise decision or input you need, and your recommended option. Otherwise: **keep going.**

Never stop merely because a task is hard, a choice is mildly ambiguous, or progress is slow. Prefer a documented decision over a halt.

---

## 8. Invariants (true across every phase)

- Follow the mandated stack and the data model exactly (spec §2, §5). Record any unavoidable deviation in the journal with rationale.
- Two real-time mechanisms, used only where correct: **Yjs CRDT for page prose; relational + event broadcast (LWW-per-cell) for database/structured data.**
- Authorization enforced identically in API and sync server.
- `main` stays green and deployable after every phase merge.
- No secrets in the repo or images; configuration via environment.
- Phase 0 establishes the monorepo, Docker Compose, and CI; every later phase builds on it and must keep `docker compose up` working.

---

## 9. Progress Journal

Maintain `docs/superpowers/PROGRESS.md` as the single source of truth for build state. After each phase (and on any significant mid-phase decision), append:
- **Phase status** — not started / in progress / complete, with date.
- **What was built** — brief summary of delivered capability.
- **Decisions** — judgment calls made under ambiguity, with rationale.
- **Deviations** — anything that differs from the spec, and why.
- **Follow-ups** — out-of-scope items discovered, deferred for later.
- **References** — PR number, merge commit, phase tag, plan path.

This journal lets the build resume cleanly if interrupted and gives the human a reviewable trail.

---

## 10. Kickoff & Completion

**Kickoff:**
1. Read the spec in full.
2. Create `docs/superpowers/PROGRESS.md` with a phase checklist (0–9).
3. Set up `TodoWrite` with one item per phase.
4. Begin the Phase 0 loop.

**Completion:**
When all 10 phases are merged to `main`, verify the spec's **Success Criteria** (spec §10) end to end against a fresh `docker compose up`, write a final summary entry in the journal, and report completion with the list of phase tags and PRs. Then stop.
