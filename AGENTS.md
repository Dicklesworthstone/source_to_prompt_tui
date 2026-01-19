# Agent Notes (Codex/Claude/etc.)

This repo is a Bun + TypeScript + React Ink TUI (`s2p`) for selecting files and generating an LLM-ready combined prompt.

---

## RULE 1 – ABSOLUTE (DO NOT EVER VIOLATE THIS)

You may NOT delete any file or directory unless I explicitly give the exact command **in this session**.

- This includes files you just created (tests, tmp files, scripts, etc.).
- You do not get to decide that something is "safe" to remove.
- If you think something should be removed, stop and ask. You must receive clear written approval **before** any deletion command is even proposed.

Treat "never delete files without permission" as a hard invariant.

---

## IRREVERSIBLE GIT & FILESYSTEM ACTIONS

Absolutely forbidden unless I give the **exact command and explicit approval** in the same message:

- `git reset --hard`
- `git clean -fd`
- `rm -rf`
- Any command that can delete or overwrite code/data

Rules:

1. If you are not 100% sure what a command will delete, do not propose or run it. Ask first.
2. Prefer safe tools: `git status`, `git diff`, `git stash`, copying to backups, etc.
3. After approval, restate the command verbatim, list what it will affect, and wait for confirmation.
4. When a destructive command is run, record in your response:
   - The exact user text authorizing it
   - The command run
   - When you ran it

If that audit trail is missing, then you must act as if the operation never happened.

---

## Quick Commands

```bash
bun run dev        # Run the TUI from source
bun run typecheck  # TypeScript typecheck (no emit)
bun run build      # tsc -> dist/
bun run build:bin  # bun build --compile -> dist/s2p
bun run build:all  # Cross-platform builds (macOS, Linux, Windows)
```

---

## Bun / JS Toolchain

- Use **bun** for everything JS/TS.
- ❌ Never use `npm`, `yarn`, or `pnpm`.

- Lockfiles: only `bun.lock`. Do not introduce any other lockfile.
- Target **latest Bun** (1.3+). No need to support old versions.

---

## Architecture Constraints

### Single-File Architecture

The entire application lives in `src/index.tsx` (~2,500 lines). This is intentional:

1. **Simpler bundling**: Bun compiles everything into one binary without complex import resolution
2. **Easier debugging**: Stack traces point to one file
3. **Faster builds**: No cross-file dependency analysis
4. **Self-contained**: Easy to understand the full application flow

**Do not split this into multiple files** unless explicitly approved.

### General Constraints

- Prefer small, local refactors: add helper functions and keep state transitions predictable.
- Avoid adding heavyweight dependencies unless they materially improve core workflows.
- The bar for adding new files is very high—the single-file architecture is a feature.

---

## Code Editing Discipline

- Do **not** run scripts that bulk-modify code (codemods, invented one-off scripts, giant `sed`/regex refactors).
- Large mechanical changes: break into smaller, explicit edits and review diffs.
- Subtle/complex changes: edit by hand, file-by-file, with careful reasoning.

---

## Backwards Compatibility & File Sprawl

We optimize for a clean architecture now, not backwards compatibility.

- No "compat shims" or "v2" file clones.
- When changing behavior, migrate callers and remove old code **inside the same file**.
- New files are only for genuinely new domains that don't fit existing modules.

---

## UI/UX Principles (Terminal "Premium")

- Optimize for keyboard flow: consistent shortcuts, clear focus states, reversible actions.
- Avoid surprising side effects (e.g., auto-copy) unless clearly communicated.
- Make long text manageable (scrolling and multi-line editing).
- Show actionable feedback: what happened, what key to press next, and why something is blocked.
- React Ink handles terminal rendering—use its component model for declarative UI updates.

---

## Third-Party Libraries

When unsure of an API, look up current docs (late-2025) rather than guessing.

Key dependencies:
- **Ink**: React renderer for terminal interfaces
- **tiktoken**: Token counting (cl100k_base encoding)
- **Terser**: JavaScript minification
- **csso**: CSS minification
- **html-minifier-terser**: HTML minification

---

## MCP Agent Mail — Multi-Agent Coordination

Agent Mail is already available as an MCP server; do not treat it as a CLI you must shell out to. MCP Agent Mail *should* be available to you as an MCP server; if it's not, then flag to the user. They might need to start Agent Mail using the `am` alias or by running `cd "<directory_where_they_installed_agent_mail>/mcp_agent_mail" && bash scripts/run_server_with_token.sh` if the alias isn't available or isn't working.

What Agent Mail gives:

- Identities, inbox/outbox, searchable threads.
- Advisory file reservations (leases) to avoid agents clobbering each other.
- Persistent artifacts in git (human-auditable).

Core patterns:

1. **Same repo**
   - Register identity:
     - `ensure_project` then `register_agent` with the repo's absolute path as `project_key`.
   - Reserve files before editing:
     - `file_reservation_paths(project_key, agent_name, ["src/**"], ttl_seconds=3600, exclusive=true)`.
   - Communicate:
     - `send_message(..., thread_id="FEAT-123")`.
     - `fetch_inbox`, then `acknowledge_message`.
   - Fast reads:
     - `resource://inbox/{Agent}?project=<abs-path>&limit=20`.
     - `resource://thread/{id}?project=<abs-path>&include_bodies=true`.

2. **Multiple repos in one product**
   - Option A: Same `project_key` for all; use specific reservations (`frontend/**`, `backend/**`).
   - Option B: Different projects linked via:
     - `macro_contact_handshake` or `request_contact` / `respond_contact`.
     - Use a shared `thread_id` (e.g., ticket key) for cross-repo threads.

Macros vs granular:

- Prefer macros when speed is more important than fine-grained control:
  - `macro_start_session`, `macro_prepare_thread`, `macro_file_reservation_cycle`, `macro_contact_handshake`.
- Use granular tools when you need explicit behavior.

Common pitfalls:

- "from_agent not registered" → call `register_agent` with correct `project_key`.
- `FILE_RESERVATION_CONFLICT` → adjust patterns, wait for expiry, or use non-exclusive reservation.

---

## Issue Tracking with br (beads_rust)

All issue tracking goes through **br**. No other TODO systems.

**Note:** br is non-invasive and never executes git commands. You must manually run git add/commit/push after `br sync --flush-only`.

Key invariants:

- `.beads/` is authoritative state and **must always be committed** with code changes.
- Do not edit `.beads/*.jsonl` directly; only via `br`.

### Basics

Check ready work:

```bash
br ready --json
```

Create issues:

```bash
br create "Issue title" -t bug|feature|task -p 0-4 --json
br create "Issue title" -p 1 --deps discovered-from:br-123 --json
```

Update:

```bash
br update br-42 --status in_progress --json
br update br-42 --priority 1 --json
```

Complete:

```bash
br close br-42 --reason "Completed" --json
```

Types:

- `bug`, `feature`, `task`, `epic`, `chore`

Priorities:

- `0` critical (security, data loss, broken builds)
- `1` high
- `2` medium (default)
- `3` low
- `4` backlog

Agent workflow:

1. `br ready` to find unblocked work.
2. Claim: `br update <id> --status in_progress`.
3. Implement + test.
4. If you discover new work, create a new bead with `discovered-from:<parent-id>`.
5. Close when done.
6. Commit `.beads/` in the same commit as code changes.

Auto-sync:

- br exports to `.beads/issues.jsonl` after changes (debounced).
- br imports from JSONL when newer (e.g. after `git pull`).

Never:

- Use markdown TODO lists.
- Use other trackers.
- Duplicate tracking.

---

## Using bv as an AI Sidecar

bv is a graph-aware triage engine for Beads projects (.beads/beads.jsonl). Instead of parsing JSONL or hallucinating graph traversal, use robot flags for deterministic, dependency-aware outputs with precomputed metrics (PageRank, betweenness, critical path, cycles, HITS, eigenvector, k-core).

**Scope boundary:** bv handles *what to work on* (triage, priority, planning). For agent-to-agent coordination (messaging, work claiming, file reservations), use MCP Agent Mail.

**⚠️ CRITICAL: Use ONLY `--robot-*` flags. Bare `bv` launches an interactive TUI that blocks your session.**

### The Workflow: Start With Triage

**`bv --robot-triage` is your single entry point.** It returns everything you need in one call:
- `quick_ref`: at-a-glance counts + top 3 picks
- `recommendations`: ranked actionable items with scores, reasons, unblock info
- `quick_wins`: low-effort high-impact items
- `blockers_to_clear`: items that unblock the most downstream work
- `project_health`: status/type/priority distributions, graph metrics
- `commands`: copy-paste shell commands for next steps

```bash
bv --robot-triage        # THE MEGA-COMMAND: start here
bv --robot-next          # Minimal: just the single top pick + claim command
```

### Other bv Commands

**Planning:**
| Command | Returns |
|---------|---------|
| `--robot-plan` | Parallel execution tracks with `unblocks` lists |
| `--robot-priority` | Priority misalignment detection with confidence |

**Graph Analysis:**
| Command | Returns |
|---------|---------|
| `--robot-insights` | Full metrics: PageRank, betweenness, HITS, eigenvector, critical path, cycles, k-core, articulation points, slack |
| `--robot-label-health` | Per-label health: `health_level` (healthy\|warning\|critical), `velocity_score`, `staleness`, `blocked_count` |
| `--robot-label-flow` | Cross-label dependency: `flow_matrix`, `dependencies`, `bottleneck_labels` |

**History & Change Tracking:**
| Command | Returns |
|---------|---------|
| `--robot-history` | Bead-to-commit correlations |
| `--robot-diff --diff-since <ref>` | Changes since ref: new/closed/modified issues, cycles introduced/resolved |

### jq Quick Reference

```bash
bv --robot-triage | jq '.quick_ref'                        # At-a-glance summary
bv --robot-triage | jq '.recommendations[0]'               # Top recommendation
bv --robot-plan | jq '.plan.summary.highest_impact'        # Best unblock target
bv --robot-insights | jq '.status'                         # Check metric readiness
bv --robot-insights | jq '.Cycles'                         # Circular deps (must fix!)
```

Use bv instead of parsing beads.jsonl—it computes PageRank, critical paths, cycles, and parallel tracks deterministically.

---

## cass — Cross-Agent Search

`cass` indexes prior agent conversations (Claude Code, Codex, Cursor, Gemini, ChatGPT, etc.) so we can reuse solved problems.

Rules:

- Never run bare `cass` (TUI). Always use `--robot` or `--json`.

Examples:

```bash
cass health
cass search "authentication error" --robot --limit 5
cass view /path/to/session.jsonl -n 42 --json
cass expand /path/to/session.jsonl -n 42 -C 3 --json
cass capabilities --json
cass robot-docs guide
```

Tips:

- Use `--fields minimal` for lean output.
- Filter by agent with `--agent`.
- Use `--days N` to limit to recent history.

stdout is data-only, stderr is diagnostics; exit code 0 means success.

Treat cass as a way to avoid re-solving problems other agents already handled.

---

## Memory System: cass-memory

The Cass Memory System (cm) gives agents effective memory based on searching previous coding sessions and extracting useful lessons.

### Quick Start

```bash
# 1. Check status and see recommendations
cm onboard status

# 2. Get sessions to analyze (filtered by gaps in your playbook)
cm onboard sample --fill-gaps

# 3. Read a session with rich context
cm onboard read /path/to/session.jsonl --template

# 4. Add extracted rules
cm playbook add "Your rule content" --category "debugging"

# 5. Mark session as processed
cm onboard mark-done /path/to/session.jsonl
```

Before starting complex tasks, retrieve relevant context:

```bash
cm context "<task description>" --json
```

This returns:
- **relevantBullets**: Rules that may help with your task
- **antiPatterns**: Pitfalls to avoid
- **historySnippets**: Past sessions that solved similar problems
- **suggestedCassQueries**: Searches for deeper investigation

### Protocol

1. **START**: Run `cm context "<task>" --json` before non-trivial work
2. **WORK**: Reference rule IDs when following them (e.g., "Following b-8f3a2c...")
3. **FEEDBACK**: Leave inline comments when rules help/hurt
4. **END**: Just finish your work. Learning happens automatically.

---

## UBS Quick Reference

UBS stands for "Ultimate Bug Scanner": **The AI Coding Agent's Secret Weapon: Flagging Likely Bugs for Fixing Early On**

**Golden Rule:** `ubs <changed-files>` before every commit. Exit 0 = safe. Exit >0 = fix & re-run.

**Commands:**
```bash
ubs src/index.tsx                       # Specific file (< 1s) — USE THIS
ubs $(git diff --name-only --cached)    # Staged files — before commit
ubs --only=ts .                         # TypeScript filter (faster)
ubs --ci --fail-on-warning .            # CI mode — before PR
ubs .                                   # Whole project
```

**Output Format:**
```
⚠️  Category (N errors)
file.ts:42:5 – Issue description
💡 Suggested fix
Exit code: 1
```
Parse: `file:line:col` → location | 💡 → how to fix | Exit 0/1 → pass/fail

**Fix Workflow:**
1. Read finding → category + fix suggestion
2. Navigate `file:line:col` → view context
3. Verify real issue (not false positive)
4. Fix root cause (not symptom)
5. Re-run `ubs <file>` → exit 0
6. Commit

**Speed Critical:** Scope to changed files. `ubs src/index.tsx` (< 1s) vs `ubs .` (30s). Never full scan for small edits.

**Bug Severity:**
- **Critical** (always fix): Null safety, XSS/injection, async/await, memory leaks
- **Important** (production): Type narrowing, division-by-zero, resource leaks
- **Contextual** (judgment): TODO/FIXME, console logs

**Anti-Patterns:**
- ❌ Ignore findings → ✅ Investigate each
- ❌ Full scan per edit → ✅ Scope to file
- ❌ Fix symptom (`if (x) { x.y }`) → ✅ Root cause (`x?.y`)

---

## ast-grep vs ripgrep (quick guidance)

**Use `ast-grep` when structure matters.** It parses code and matches AST nodes, so results ignore comments/strings, understand syntax, and can **safely rewrite** code.

* Refactors/codemods: rename APIs, change import forms, rewrite call sites or variable kinds.
* Policy checks: enforce patterns across a repo (`scan` with rules + `test`).
* Editor/automation: LSP mode; `--json` output for tooling.

**Use `ripgrep` when text is enough.** It's the fastest way to grep literals/regex across files.

* Recon: find strings, TODOs, log lines, config values, or non-code assets.
* Pre-filter: narrow candidate files before a precise pass.

**Rule of thumb**

* Need correctness over speed, or you'll **apply changes** → start with `ast-grep`.
* Need raw speed or you're just **hunting text** → start with `rg`.
* Often combine: `rg` to shortlist files, then `ast-grep` to match/modify with precision.

**Snippets**

Find structured code (ignores comments/strings):

```bash
ast-grep run -l TypeScript -p 'import $X from "$P"'
```

Codemod (only real `var` declarations become `let`):

```bash
ast-grep run -l TypeScript -p 'var $A = $B' -r 'let $A = $B' -U
```

Quick textual hunt:

```bash
rg -n 'useState\(' -t tsx
```

Combine speed + precision:

```bash
rg -l -t ts 'useInput\(' | xargs ast-grep run -l TypeScript -p 'useInput($ARGS)' --json
```

**Mental model**

* Unit of match: `ast-grep` = node; `rg` = line.
* False positives: `ast-grep` low; `rg` depends on your regex.
* Rewrites: `ast-grep` first-class; `rg` requires ad-hoc sed/awk and risks collateral edits.

---

## Morph Warp Grep — AI-Powered Code Search

Use `mcp__morph-mcp__warp_grep` for "how does X work?" discovery across the codebase.

When to use:

- You don't know where something lives.
- You want data flow across multiple files (CLI → TUI → state → output).
- You want all touchpoints of a cross-cutting concern (e.g., file selection, token counting).

Example:

```
mcp__morph-mcp__warp_grep(
  repoPath: "/data/projects/source_to_prompt_tui",
  query: "How does the file selection and token counting work?"
)
```

Warp Grep:

- Expands a natural-language query to multiple search patterns.
- Runs targeted greps, reads code, follows imports, then returns concise snippets with line numbers.
- Reduces token usage by returning only relevant slices, not entire files.

When **not** to use Warp Grep:

- You already know the function/identifier name; use `rg`.
- You know the exact file; just open it.
- You only need a yes/no existence check.

Comparison:

| Scenario | Tool |
| ---------------------------------- | ---------- |
| "How does token counting work?" | warp_grep |
| "Where is `FileTree` component defined?" | `rg` |
| "Replace `var` with `let`" | `ast-grep` |

---

## Beads Workflow Integration

When starting a beads-tracked task:

1. **Pick ready work** (Beads)
   - `br ready --json` → choose one item (highest priority, no blockers)
2. **Reserve edit surface** (Mail)
   - `file_reservation_paths(project_key, agent_name, ["src/**"], ttl_seconds=3600, exclusive=true, reason="br-123")`
3. **Announce start** (Mail)
   - `send_message(..., thread_id="br-123", subject="[br-123] Start: <short title>", ack_required=true)`
4. **Work and update**
   - Reply in-thread with progress and attach artifacts/images; keep the discussion in one thread per issue id
5. **Complete and release**
   - `br close br-123 --reason "Completed"` (Beads is status authority)
   - `release_file_reservations(project_key, agent_name, paths=["src/**"])`
   - Final Mail reply: `[br-123] Completed` with summary and links

Mapping cheat-sheet:
- **Mail `thread_id`** ↔ `br-###`
- **Mail subject**: `[br-###] ...`
- **File reservation `reason`**: `br-###`
- **Commit messages (optional)**: include `br-###` for traceability

---

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   br sync --flush-only
   git add .beads/
   git commit -m "sync beads"
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

---

## Note for Codex/GPT-5.2

If you are Codex or GPT-5.2 (or any non-Claude agent): another agent (often Claude Code) may have made changes to the working tree since you last saw it. Before assuming your mental model of the code is correct:

1. Run `git status` to see uncommitted changes
2. Run `git log --oneline -5` to see recent commits
3. Re-read any files you plan to modify

This prevents you from overwriting another agent's work or making edits based on stale context
