# Changelog

All notable changes to **s2p** (Source2Prompt TUI) are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) adapted for agent consumption.
Versioning: the project tags releases as `vMAJOR.MINOR.PATCH`. Only tags with corresponding GitHub Releases are considered releases; other tags are lightweight markers.

Repository: <https://github.com/Dicklesworthstone/source_to_prompt_tui>

---

## [Unreleased] (after v0.3.2)

Commits on `main` since the v0.3.2 release. No new tag or GitHub Release has been cut for these changes yet.

### Build / Binary Crash Fix (mdn-data inlining)

- **fix: inline mdn-data JSON files to fix compiled binary crash on launch** ([`432452f`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/432452fa6d192c8c0d69832829af1075916f605e)) -- The compiled binary crashed with `Cannot find module 'mdn-data/css/at-rules.json'` because css-tree uses `createRequire()` to load JSON at runtime, which Bun's `$bunfs` cannot embed. The postinstall patch script now inlines three JSON files (at-rules, properties, syntaxes) directly into `css-tree/lib/data.js`. Closes #4.
- **fix: validate line structure before skipping in mdn-data patch** ([`b88dad4`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/b88dad49ad9b95fb4d5e85f3347f5642ccaf105a)) -- Each subsequent line is now validated against the expected `require('mdn-data/...')` pattern before being skipped; mismatches produce a clear warning. Post-patch verification confirms all three inlined declarations exist and no residual `require()` calls remain.
- **fix: abort mdn-data JSON inlining when next lines don't match expected pattern** ([`7fe8e11`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/7fe8e115f465856d0c8d47680211145e4f751972)) -- When line structure diverges from the expected css-tree layout, the original line is now pushed unchanged and inlining is aborted entirely instead of corrupting the output. Narrows the post-patch require() check from the overly broad `require(` to `require('mdn-data`.

### License

- **chore: update license to MIT with OpenAI/Anthropic Rider** ([`3709e7e`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/3709e7efdf38ed338b4213517562737f0a89e83d)) -- Replace plain MIT with MIT + OpenAI/Anthropic Rider restricting use by OpenAI, Anthropic, and affiliates without express written permission.
- **docs: update README license references** ([`d1ddca0`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/d1ddca0dcb5c7f64aa8ba8b70dfabeac5baea9b1))

### CI / Infrastructure

- **ci: add ACFS notification workflows** ([`97858f8`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/97858f81a4efc4e89b645d9ecbb19f68a6576529), [`77b150a`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/77b150a0a21fb6375def6853362e614ba56a71a0)) -- Notify ACFS lesson registry on new releases and installer changes.
- **ci: update GitHub Actions to version tags** ([`99ab871`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/99ab87179d4ef9d542f6e7b3e3cba0fdfe751908)) -- Replace pinned commit SHAs with stable version tags (actions/checkout v4, oven-sh/setup-bun v2, etc.) after a SHA became unavailable.
- **ci: update oven-sh/setup-bun to v2.1.2** ([`641f5c6`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/641f5c6b1c6775a02f6aec915c40129578657aa9))

### Maintenance

- **chore: add GitHub social preview image** ([`74cdf43`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/74cdf431a2c32598be751ba96b311e49343e00a4))
- **chore(deps): update Node.js dependencies to latest stable versions** ([`4c98352`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/4c9835260bb1d42aa209cdb6aa8bba2de760eede))
- **Add MIT License** ([`2b81e70`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/2b81e70e64156041dbfaca32c322a9c7a60e9b18))
- Documentation and AGENTS.md updates ([`266c541`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/266c5417a1165bd0e77c6976f1a42cce57e0f30b), [`d7d4890`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/d7d4890c23b46236f46e042ea7859ec4f6abb953), [`ed8e9e5`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/ed8e9e5bd0fa3803a4d7fd5a064ad5f0e915b712), [`5fba9de`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/5fba9de152f6baccde70f3a8cdd253f4c5597a3f))
- Beads issue tracker metadata updates ([`003d3ed`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/003d3ed111bd7679530414bc09f138a3541b2659), [`85695df`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/85695dff8aa97383359279f5c037dde2aa3a0ca0), [`66bf7f6`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/66bf7f66277aff31b65fd3f63e186d4c6bce5098))
- Gitignore updates for ephemeral files ([`914f619`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/914f6193bd720e4d4ed2c909ae5fc60559e778c3), [`f9096ea`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/f9096ead4361d4e8c1bc5f3115e68d48f4f65b2b))

### Bug Fixes

- **fix: handle Python triple-quoted strings in comment stripping** ([`76bc5f3`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/76bc5f310aea797a0d7dd61b49e0a522aa4c8ec9)) -- Rewrote `stripHashCommentsPython` to process character-by-character, properly tracking triple-quote state so `#` inside docstrings is preserved.

### Performance

- **perf: switch to WASM tiktoken for 4000x faster tokenization** ([`e99c0e1`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/e99c0e1cef6b1d2d35a578cdfefd21bac9f6d8ef)) -- Replaced js-tiktoken (pure JS) with the WASM-based tiktoken package. 10K chars: 8000ms down to 2ms. 256K chars: would hang, now 37ms.
- **fix: use byte estimation for large files during scan** ([`ceee6ee`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/ceee6ee12b9be49096c55c7b446e5e8378c6a3d1)) -- Files larger than 2KB use fast byte-based estimation (~4 bytes/token) during scan to prevent hangs. Fixes #3.

### Platform: Windows Support

- **feat(core): enhance path handling, clipboard support, and async I/O** ([`2192a6e`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/2192a6e339b524e59e661938780286b8210b979c)) -- Tilde expansion for CLI args (`s2p ~/projects`), `clip.exe` for WSL clipboard, `.rst` extension support, async preset I/O.
- **feat(build): add Windows x64 binary compilation and CI release support** ([`75a7750`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/75a7750fd46f405b0744fb2db50cdd336dbba868)) -- Cross-compile Windows binary from Linux runners; release artifacts now include `s2p-windows-x64.exe`.
- **feat(install): add comprehensive Windows installation support** ([`9ab7bcc`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/9ab7bcca46c16cfa1b02b0d7a9a6998c595e64a1)) -- New `install.ps1` PowerShell installer; bash installer gains MINGW/MSYS/Cygwin detection, `.exe` suffix handling, and Windows PATH updates.
- **docs: update documentation for Windows support** ([`5738c74`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/5738c746b50416101268b4fa3e915703ca6a0fe0))

### Hardening

- **refactor(core): comprehensive hardening and performance optimization** ([`a40f8e7`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/a40f8e7f776717eca511468a35260185e82e1d45)) -- Virtual scrolling (O(visible) rendering), parallel scanning with bounded concurrency (limit 64), stacked `.gitignore` strategy, scan-id race condition fix, large-file lazy-loading (5-25MB), native clipboard via `Bun.spawn` replacing clipboardy, character-by-character comment parser state machine, schema-validated preset management, CLI arg support (`s2p <path>`, `--help`), expanded text extensions (C#, Dart, Gradle, Windows scripts).
- **fix(install): harden installation script** ([`13eb1e6`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/13eb1e6a71c202d5e3840e79ed2b7f1b900fbf76)) -- Removed `eval` from checksum verification; simplified to standard shell commands.
- **ci: improve GitHub Actions workflow with security and performance** ([`49e0b4a`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/49e0b4a69fbb1e11577dbf92102d12a0bd87dcdb)) -- Pinned actions to full SHAs, least-privilege permissions, Bun dependency caching, concurrency control, new build-test job for PR validation.

---

## [v0.3.2] -- 2025-12-07

**GitHub Release**: [v0.3.2 - Comprehensive Documentation & Enhanced Display](https://github.com/Dicklesworthstone/source_to_prompt_tui/releases/tag/v0.3.2)
**Tag**: [`af8e0a5`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/af8e0a540d3a56dd21d4c48f372affd28ad8ad35)
**Binaries**: macOS arm64/x64, Linux x64/arm64 (no Windows yet at this tag)

### Documentation

- README expanded from ~230 lines to ~920 lines ([`d40dc92`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/d40dc92dd5a68fed49b6ad1a76c7f402caf47a2d)):
  - Table of contents with anchor navigation
  - "Why s2p Exists" problem/solution framing
  - "Features in Depth": file detection, gitignore handling, token estimation, minification, comment stripping
  - "Architecture & Design": Bun/React/Ink stack rationale, design principles
  - "How the Scanning Algorithm Works": 4-phase breakdown with pseudocode
  - "Use Cases": 6 real-world examples (debugging, code review, refactoring, documentation, onboarding, feature implementation)
  - "Performance & Scalability": memory considerations, recommended limits table
  - "Security & Privacy": local-only processing, no telemetry
  - Comparison tables vs manual copy-paste, repomix, and code2prompt

### What v0.3.2 Consolidated

v0.3.2 was primarily a documentation and version-bump release. The functional changes shipped in v0.3.1 (line counts, improved project tree) are included. The release notes also credit bug fixes from the v0.3.0 cycle (removing ink-big-text, patching csso/css-tree for bun compile, installer PATH auto-configuration).

---

## [v0.3.1] -- 2025-12-07

**GitHub Release**: [v0.3.1 - Line counts and improved project tree](https://github.com/Dicklesworthstone/source_to_prompt_tui/releases/tag/v0.3.1)
**Tag**: [`34a6cb8`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/34a6cb8236369f2cb1aeb662a27bc0301b6f07e6)
**Binaries**: macOS arm64/x64, Linux x64/arm64

### Added

- **Line counts in file explorer**: files now display `(4.5 KB | 234 lines)` instead of size alone ([`34a6cb8`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/34a6cb8236369f2cb1aeb662a27bc0301b6f07e6))
- **ASCII project tree in combined output**: proper tree drawing with file sizes and line counts, matching the original HTML version
- **Total lines in stats panel**: stats display now shows total line count alongside size and file count
- Renamed `<project_tree>` XML tag to `<project_structure>` for clarity

This release brought the TUI to feature parity with the original HTML-based Source2Prompt tool.

---

## [v0.3.0] -- 2025-12-07

**GitHub Release**: [v0.3.0 - First binary release](https://github.com/Dicklesworthstone/source_to_prompt_tui/releases/tag/v0.3.0)
**Tag**: [`fb146d5`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/fb146d56324e742a9085d8f6dcb43932a464e566)
**Binaries**: macOS arm64/x64, Linux x64/arm64

First official binary release of Source2Prompt TUI. This is the first version installable via the one-liner `curl | bash` installer with pre-built platform binaries.

### Core Features (shipped in this release)

- **Interactive TUI** built with Bun + React + Ink for selecting source files and combining them into LLM-ready prompts
- **Tree file explorer** with vim-style navigation (j/k/h/l), expand/collapse directories, file filtering
- **Live syntax preview** of selected files with syntax highlighting
- **Token estimation** using tiktoken (cl100k_base encoding) with real-time context window usage bar
- **Structured XML-like output** (`<preamble>`, `<goal>`, `<project_structure>`, `<files>`) optimized for LLM parsing
- **Code minification**: JS/TS via Terser, CSS via csso, HTML via html-minifier-terser, JSON native
- **Comment stripping**: C-style (`//`, `/* */`), hash-style (`#`), HTML (`<!-- -->`), CSS (`/* */`)
- **Preset system**: save/load file selections and configuration to `~/.source2prompt.json`
- **Recursive .gitignore support**: nested gitignores, negation patterns, directory patterns, glob patterns
- **Quick file-type selects**: `t` for all text, `1-9,0,r` for JS/React/TS/JSON/MD/Python/Go/Java/Ruby/PHP/Rust
- **Clipboard integration** via native system commands (pbcopy, xclip, wl-copy)
- **Cross-platform binaries** (macOS arm64/x64, Linux x64/arm64) compiled via `bun build --compile`
- **One-liner installer** (`install.sh`) with SHA256 checksum verification and automatic PATH configuration

### UI Components (pre-release commits included in v0.3.0)

- **ScrollableBox component**: reusable scrollable content with visual scrollbar, arrows, proportional thumb ([`c0fa053`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/c0fa0539f84184e2768391be8c1472fca7cd5119))
- **F1 Help Modal**: full-screen overlay showing all keyboard shortcuts organized by section
- **Two-stage Escape to quit**: first press shows confirmation, second press exits; any other key cancels
- **Scrollbars** in Explorer pane and Combined Output view

### Bug Fixes (pre-release, included in v0.3.0)

- Fixed directory expand/collapse icons: `[-]` for expanded, `[+]` for collapsed (was backwards) ([`c0fa053`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/c0fa0539f84184e2768391be8c1472fca7cd5119))
- Fixed cursor marker color from "black" (invisible on dark terminals) to "gray"
- Fixed bytes display in output to show transformed content size, not original file size
- Fixed prompt preview condition to respect include flags
- Added 40+ missing text file extensions (.toml, .ini, .cfg, .conf, .sql, .graphql, .svelte, .vue, .astro, .swift, .kt, .scala, .clj, .ex, .hs, .lua, .r, .pl, .tf, etc.)
- Added `TEXT_FILENAMES` set for extensionless files (Makefile, Dockerfile, LICENSE, Gemfile, Procfile, etc.) and dotfiles (.gitignore, .editorconfig, etc.)
- Fixed standalone binary compilation by removing `ink-big-text` dependency (cfonts used runtime `require('../package.json')`) ([`fb146d5`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/fb146d56324e742a9085d8f6dcb43932a464e566))
- Added `scripts/patch-modules.js` postinstall to patch csso and css-tree for bun compile compatibility
- Installer now auto-updates shell configs (`~/.zshrc`, `~/.bashrc`, `~/.profile`) when install dir is not in PATH

---

## Pre-release History

### Initial Commit -- 2025-12-06

[`710943d`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/710943d8e3663c490a718c95af98fed9d116a0cd) -- Add initial project structure for TUI application using Bun and TypeScript. Single-file architecture in `src/index.tsx` replicating the features of the "Your Source to Prompt" web utility as a terminal application.

### Installer & CI -- 2025-12-06

[`923efb2`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/923efb29dd37d21577e5b0c9a5a9d7d66512a799) -- Add `install.sh`, initial README, CI workflow (`.github/workflows/ci.yml`), and cross-platform build scripts in `package.json`.

---

<!-- Link references for release diffs -->
[Unreleased]: https://github.com/Dicklesworthstone/source_to_prompt_tui/compare/v0.3.2...HEAD
[v0.3.2]: https://github.com/Dicklesworthstone/source_to_prompt_tui/compare/v0.3.1...v0.3.2
[v0.3.1]: https://github.com/Dicklesworthstone/source_to_prompt_tui/compare/v0.3.0...v0.3.1
[v0.3.0]: https://github.com/Dicklesworthstone/source_to_prompt_tui/commits/v0.3.0
