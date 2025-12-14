# Agent Notes (Codex/Claude/etc.)

This repo is a Bun + TypeScript + React Ink TUI (`s2p`) for selecting files and generating an LLM-ready combined prompt.

## Quick commands

```bash
bun run dev        # Run the TUI from source
bun run typecheck  # TypeScript typecheck (no emit)
bun run build      # tsc -> dist/
bun run build:bin  # bun build --compile -> dist/s2p
```

## Architecture constraints

- The app intentionally lives in a single file: `src/index.tsx` (helps `bun build --compile`).
- Prefer small, local refactors: add helper functions and keep state transitions predictable.
- Avoid adding heavyweight dependencies unless they materially improve core workflows.

## Beads workflow (issues + dependencies)

This repo uses Beads for task tracking.

- View next work:
  - `bv --robot-plan`
  - `bv --robot-priority`
  - `bv --robot-insights`
- Update issue status as you work:
  - `bd update <id> --status in_progress`
  - `bd update <id> --status done`
- Leave short progress notes:
  - `bd comment <id> --text "…"`

## UI/UX principles (terminal “premium”)

- Optimize for keyboard flow: consistent shortcuts, clear focus states, reversible actions.
- Avoid surprising side effects (e.g., auto-copy) unless clearly communicated.
- Make long text manageable (scrolling and multi-line editing).
- Show actionable feedback: what happened, what key to press next, and why something is blocked.

