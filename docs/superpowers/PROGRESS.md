# Build Progress Journal — Self-Hosted Notion

Single source of truth for build state. One entry per phase (and per significant mid-phase decision). See the runbook: [`build-orchestrator-instructions.md`](build-orchestrator-instructions.md) and the spec: [`specs/2026-06-05-self-hosted-notion-design.md`](specs/2026-06-05-self-hosted-notion-design.md).

## Phase Checklist

- [ ] **Phase 0 — Foundation** — monorepo, Docker Compose, CI, `/health` + `/ready`
- [ ] **Phase 1 — Auth & workspaces**
- [ ] **Phase 2 — Page tree & single-user editor**
- [ ] **Phase 3 — Real-time collaboration**
- [ ] **Phase 4 — Full block editor**
- [ ] **Phase 5 — Databases (collections)**
- [ ] **Phase 6 — Comments, sharing & permissions**
- [ ] **Phase 7 — Search, files & version history**
- [ ] **Phase 8 — Publishing, import/export & synced blocks**
- [ ] **Phase 9 — Polish & self-host hardening**

## Environment (verified 2026-06-05)

- OS: Windows 11 Pro, PowerShell + Bash available.
- Node v25.2.0, npm 11.6.2, pnpm 11.5.2.
- Docker 29.0.1, Docker Compose v2.40.3, daemon running.
- git 2.51.2; remote `origin` → `github-xyz:maxjb-xyz/inclination`.

---

## Phase 0 — Foundation

**Status:** in progress (started 2026-06-05)

_Entry will be completed when the phase ships._
