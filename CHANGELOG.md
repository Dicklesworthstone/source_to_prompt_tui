# Changelog

All notable changes to **s2p** (Source2Prompt TUI) are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) adapted for capability-oriented grouping.
Versioning: the project tags releases as `vMAJOR.MINOR.PATCH`. Only tags with corresponding GitHub Releases are considered releases; other tags are lightweight markers.

Repository: <https://github.com/Dicklesworthstone/source_to_prompt_tui>

---

## [Unreleased] (after v0.3.2)

Commits on `main` since the v0.3.2 tag (2025-12-07). No new GitHub Release has been cut for these changes yet.

### Binary Compilation -- mdn-data Crash Fix

The compiled binary crashed on launch with `Cannot find module 'mdn-data/css/at-rules.json'` because css-tree uses `createRequire()` to load JSON at runtime, which Bun's `$bunfs` virtual filesystem cannot embed. Three rounds of fixes addressed this:

- **Inline mdn-data JSON files into css-tree** ([`432452f`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/432452fa6d192c8c0d69832829af1075916f605e), 2026-02-23) -- The postinstall patch script now inlines at-rules.json, properties.json, and syntaxes.json directly into `css-tree/lib/data.js`, eliminating the dynamic `require()` calls. Uses line-by-line splicing instead of `String.prototype.replace()` to avoid `$` in CSS syntax strings being misinterpreted. Closes [#4](https://github.com/Dicklesworthstone/source_to_prompt_tui/issues/4).
- **Validate line structure before skipping** ([`b88dad4`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/b88dad49ad9b95fb4d5e85f3347f5642ccaf105a), 2026-02-23) -- Each subsequent line is now validated against the expected `require('mdn-data/...')` pattern before being skipped; mismatches produce a clear warning. Post-patch verification confirms all three inlined declarations exist and no residual `require()` calls remain.
- **Abort inlining on unexpected file layout** ([`7fe8e11`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/7fe8e115f465856d0c8d47680211145e4f751972), 2026-02-23) -- When line structure diverges from the expected css-tree layout, the original line is pushed unchanged and inlining is aborted entirely, preventing file corruption. Narrows the post-patch residual check from the overly broad `require(` to the specific `require('mdn-data`.

### Performance -- WASM Tiktoken

- **Switch to WASM tiktoken for 4000x faster tokenization** ([`e99c0e1`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/e99c0e1cef6b1d2d35a578cdfefd21bac9f6d8ef), 2026-01-03) -- Replaced js-tiktoken (pure JS) with the WASM-based tiktoken package. 10K chars: 8000ms down to 2ms. 100K+ chars: went from hanging indefinitely to completing in under 40ms. Completely resolves scanning hangs from [#3](https://github.com/Dicklesworthstone/source_to_prompt_tui/issues/3).
- **Byte estimation fallback for large files during scan** ([`ceee6ee`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/ceee6ee12b9be49096c55c7b446e5e8378c6a3d1), 2026-01-03) -- Files larger than 2KB use fast byte-based estimation (~4 bytes/token) during scanning. Accurate tiktoken counting still used for small files. Fixes [#3](https://github.com/Dicklesworthstone/source_to_prompt_tui/issues/3).

### Comment Stripping

- **Handle Python triple-quoted strings correctly** ([`76bc5f3`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/76bc5f310aea797a0d7dd61b49e0a522aa4c8ec9), 2026-01-03) -- The Python comment stripper was processing files line-by-line without tracking multi-line string state, causing `#` characters inside `"""` docstrings to be incorrectly removed. Rewritten as a character-by-character state machine that tracks triple-double, triple-single, regular quotes, and escape sequences.

### Licensing

- **Update license to MIT with OpenAI/Anthropic Rider** ([`3709e7e`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/3709e7efdf38ed338b4213517562737f0a89e83d), 2026-02-21) -- LICENSE file updated.
- **Update README license references** ([`d1ddca0`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/d1ddca0dcb5c7f64aa8ba8b70dfabeac5baea9b1), 2026-02-22) -- README now reflects the rider.
- **Add MIT License file** ([`2b81e70`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/2b81e70e64156041dbfaca32c322a9c7a60e9b18), 2026-01-21) -- Initial MIT license added.

### CI / Infrastructure

- **Pin GitHub Actions to SHA hashes and apply least-privilege permissions** ([`49e0b4a`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/49e0b4a69fbb1e11577dbf92102d12a0bd87dcdb), 2026-01-17) -- Supply-chain hardening: all actions pinned to full SHAs, job-level permissions, Bun dependency caching, concurrency control, separate build-test job for PR validation.
- **Update GitHub Actions to version tags** ([`99ab871`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/99ab87179d4ef9d542f6e7b3e3cba0fdfe751908), 2026-01-24) -- Switched from SHA pins to version tags for readability.
- **Update oven-sh/setup-bun to v2.1.2** ([`641f5c6`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/641f5c6b1c6775a02f6aec915c40129578657aa9), 2026-01-23).
- **Add ACFS notification workflows** ([`97858f8`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/97858f81a4efc4e89b645d9ecbb19f68a6576529), [`77b150a`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/77b150a0a21fb6375def6853362e614ba56a71a0), 2026-01-27) -- Notify ACFS lesson registry on installer changes.

### Dependencies

- **Update Node.js dependencies to latest stable versions** ([`4c98352`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/4c9835260bb1d42aa209cdb6aa8bba2de760eede), 2026-01-18) -- Routine maintenance update via library-updater workflow.

### Housekeeping

- Add GitHub social preview image ([`74cdf43`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/74cdf431a2c32598be751ba96b311e49343e00a4), 2026-02-21).
- Update AGENTS.md with multi-agent conventions ([`266c541`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/266c5417a1165bd0e77c6976f1a42cce57e0f30b), [`d7d4890`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/d7d4890c23b46236f46e042ea7859ec4f6abb953), [`ed8e9e5`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/ed8e9e5bd0fa3803a4d7fd5a064ad5f0e915b712), [`5fba9de`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/5fba9de152f6baccde70f3a8cdd253f4c5597a3f)).
- Gitignore updates for beads and bv state files ([`914f619`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/914f6193bd720e4d4ed2c909ae5fc60559e778c3), [`f9096ea`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/f9096ead4361d4e8c1bc5f3115e68d48f4f65b2b)).
- Beads metadata updates ([`003d3ed`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/003d3ed111bd7679530414bc09f138a3541b2659), [`85695df`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/85695dff8aa97383359279f5c037dde2aa3a0ca0), [`66bf7f6`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/66bf7f66277aff31b65fd3f63e186d4c6bce5098)).

---

## [v0.3.2] -- 2025-12-07 (Release: "Comprehensive Documentation & Enhanced Display")

**Tag:** [`af8e0a5`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/af8e0a540d3a56dd21d4c48f372affd28ad8ad35) | **GitHub Release:** [v0.3.2](https://github.com/Dicklesworthstone/source_to_prompt_tui/releases/tag/v0.3.2)

This release includes all work from the v0.3.2 tag plus the post-release hardening, Windows support, and performance work that landed on `main` before the next section's unreleased work began. Organized below by capability.

### Windows Platform Support

Full first-class Windows support was added across the binary, installer, and CI pipeline:

- **Windows x64 binary via cross-compilation** ([`75a7750`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/75a7750fd46f405b0744fb2db50cdd336dbba868), 2025-12-14) -- Added `build:win-x64` script using `--target=bun-windows-x64`. CI cross-compiles from Linux runners, eliminating the need for a Windows runner. PE32 format validation added. Release artifacts now include `s2p-windows-x64.exe`.
- **PowerShell installer** ([`9ab7bcc`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/9ab7bcca46c16cfa1b02b0d7a9a6998c595e64a1), 2025-12-14) -- New `install.ps1` for native Windows installation without Git Bash. Supports `-Version`, `-Dest`, `-FromSource`, `-Verify`, `-Quiet` flags. Forces TLS 1.2+, verifies SHA256 checksums, handles `Unblock-File`, auto-updates user PATH, falls back to from-source builds on non-x64.
- **Bash installer Windows detection** ([`9ab7bcc`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/9ab7bcca46c16cfa1b02b0d7a9a6998c595e64a1), 2025-12-14) -- `install.sh` now detects MINGW/MSYS/Cygwin, appends `.exe` suffix, and maps to the correct Windows asset.

### Core Architecture Hardening

A comprehensive refactor brought the core to production readiness:

- **Virtual scrolling** ([`a40f8e7`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/a40f8e7f776717eca511468a35260185e82e1d45), 2025-12-13) -- Explorer and Combined Output views now render only visible rows, reducing rendering cost from O(N) to O(visible).
- **Parallel file scanning** ([`a40f8e7`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/a40f8e7f776717eca511468a35260185e82e1d45)) -- `Promise.all` with a `withConcurrency` semaphore (limit: 64) to maximize throughput without hitting EMFILE limits.
- **Stacked gitignore strategy** ([`a40f8e7`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/a40f8e7f776717eca511468a35260185e82e1d45)) -- Rewrote `.gitignore` handling to correctly support recursive/nested patterns and prevent double-walking of ignored directories like `node_modules`.
- **Race condition fix** ([`a40f8e7`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/a40f8e7f776717eca511468a35260185e82e1d45)) -- Added a `scanId` mechanism to prevent stale scan results from clobbering current state.
- **Large file handling (5-25MB)** ([`a40f8e7`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/a40f8e7f776717eca511468a35260185e82e1d45)) -- Large text files are now correctly identified as selectable but lazy-loaded; content is only read during generation.
- **Character-by-character comment parser** ([`a40f8e7`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/a40f8e7f776717eca511468a35260185e82e1d45)) -- Replaced naive regex-based comment stripping with a state machine for safety.
- **Native clipboard via Bun.spawn** ([`a40f8e7`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/a40f8e7f776717eca511468a35260185e82e1d45)) -- Replaced `clipboardy` dependency with native calls to `pbcopy` (macOS), `wl-copy`/`xclip` (Linux), `clip.exe` (Windows).
- **Preset schema validation** ([`a40f8e7`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/a40f8e7f776717eca511468a35260185e82e1d45)) -- Robustified preset loading with validation and error reporting.
- **CLI argument support restored** ([`a40f8e7`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/a40f8e7f776717eca511468a35260185e82e1d45)) -- `s2p <path>` and `--help` flag now work correctly again.

### Cross-Platform Improvements

- **Tilde expansion** ([`2192a6e`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/2192a6e339b524e59e661938780286b8210b979c), 2025-12-14) -- `s2p ~/projects/myapp` now works naturally via `expandTilde()` utility.
- **WSL clipboard fallback** ([`2192a6e`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/2192a6e339b524e59e661938780286b8210b979c)) -- Added `clip.exe` to Linux clipboard candidates for WSL compatibility.
- **Async preset I/O** ([`2192a6e`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/2192a6e339b524e59e661938780286b8210b979c)) -- Converted `loadPresets()`/`savePresets()` from sync to async to reduce UI blocking.
- **Added .rst to text extensions** ([`2192a6e`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/2192a6e339b524e59e661938780286b8210b979c)).

### Installer Hardening

- **Remove eval from checksum verification** ([`13eb1e6`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/13eb1e6a71c202d5e3840e79ed2b7f1b900fbf76), 2025-12-13) -- Eliminated potential security risk by using standard shell commands for checksum logic.

### Documentation

- **Dramatically expanded README** ([`d40dc92`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/d40dc92dd5a68fed49b6ad1a76c7f402caf47a2d), 2025-12-07) -- Grew from ~230 lines to ~920 lines: added table of contents, "Why s2p Exists" framing, architecture deep-dive, scanning algorithm walkthrough, 6 real-world use cases, performance/scalability guidelines, security/privacy section, and comparison tables vs. repomix and code2prompt.
- **Windows documentation** ([`5738c74`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/5738c746b50416101268b4fa3e915703ca6a0fe0), 2025-12-14) -- Updated README and docs with Windows installation instructions and corrected CLI examples.

### Release Artifacts

Binaries: `s2p-macos-arm64`, `s2p-macos-x64`, `s2p-linux-x64`, `s2p-linux-arm64`, `s2p-windows-x64.exe` (new), plus individual `.sha256` files and combined `sha256.txt`.

---

## [v0.3.1] -- 2025-12-07 (Release: "Line Counts and Improved Project Tree")

**Tag:** [`34a6cb8`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/34a6cb8236369f2cb1aeb662a27bc0301b6f07e6) | **GitHub Release:** [v0.3.1](https://github.com/Dicklesworthstone/source_to_prompt_tui/releases/tag/v0.3.1)

A focused release bringing the TUI to feature parity with the original HTML-based Source2Prompt tool.

### Explorer Enhancements

- **Line counts in file explorer** ([`34a6cb8`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/34a6cb8236369f2cb1aeb662a27bc0301b6f07e6)) -- Files now display both size and line count: `index.tsx (85.2 KB | 2,534 lines)`.
- **Total lines in stats panel** ([`34a6cb8`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/34a6cb8236369f2cb1aeb662a27bc0301b6f07e6)) -- Stats bar now shows total line count alongside size and file count.

### Output Format

- **ASCII project tree with metrics** ([`34a6cb8`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/34a6cb8236369f2cb1aeb662a27bc0301b6f07e6)) -- Combined output now uses proper ASCII tree art with sizes and line counts, matching the HTML version's output format.
- **Renamed `<project_tree>` to `<project_structure>`** ([`34a6cb8`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/34a6cb8236369f2cb1aeb662a27bc0301b6f07e6)) -- Tag name clarified for better LLM comprehension.

### Release Artifacts

Binaries: `s2p-macos-arm64`, `s2p-macos-x64`, `s2p-linux-x64`, `s2p-linux-arm64`, plus `.sha256` checksums.

---

## [v0.3.0] -- 2025-12-07 (Release: "First Binary Release")

**Tag:** [`fb146d5`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/fb146d56324e742a9085d8f6dcb43932a464e566) | **GitHub Release:** [v0.3.0](https://github.com/Dicklesworthstone/source_to_prompt_tui/releases/tag/v0.3.0)

The first release with downloadable pre-built binaries. This tag encompasses all work from the initial commit through the binary fix, including the major UI overhaul in `c0fa053`.

### Binary Compilation

- **Fix standalone binary** ([`fb146d5`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/fb146d56324e742a9085d8f6dcb43932a464e566), 2025-12-06) -- Removed `ink-big-text` dependency (cfonts used runtime `require('../package.json')` which broke `bun compile`). Added `scripts/patch-modules.js` postinstall to patch csso and css-tree for `bun compile` compatibility. Replaced `BigText` components with styled `Text` elements.

### Installer

- **One-liner curl|bash installer** ([`923efb2`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/923efb29dd37d21577e5b0c9a5a9d7d66512a799), 2025-12-06) -- `install.sh` detects platform (macOS arm64/x64, Linux x64/arm64), downloads appropriate binary, verifies SHA256 checksum, installs to `~/.local/bin`.
- **Automatic PATH updates** ([`fb146d5`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/fb146d56324e742a9085d8f6dcb43932a464e566)) -- Installer auto-updates `~/.zshrc`, `~/.bashrc`, `~/.profile` when the install directory is not in PATH.

### TUI Features (initial application)

All of the following were introduced in the initial commits ([`710943d`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/710943d8e3663c490a718c95af98fed9d116a0cd), [`923efb2`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/923efb29dd37d21577e5b0c9a5a9d7d66512a799), [`c0fa053`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/c0fa0539f84184e2768391be8c1472fca7cd5119)):

#### Navigation and Selection
- Tree file explorer with vim-style navigation (j/k/h/l)
- Space/Enter to toggle file selection or expand/collapse directories
- Filter input (`/` or `f`) to narrow the file tree by path
- Root directory input (`d`) to change the scanned directory
- Quick file-type selects: `t` (all text), `1-9,0,r` for JS/React/TS/JSON/MD/Python/Go/Java/Ruby/PHP/Rust
- Select/deselect all matching filter (`a`/`A`/`u`)

#### Preview and Output
- Live syntax-highlighted preview pane as you navigate
- Real-time token estimation using tiktoken (`cl100k_base` encoding)
- Context window usage bar with warnings at 100K and 128K tokens
- Cost estimation based on token count
- Running statistics (size, lines, file count) updating in real-time
- Structured XML-like output with `<preamble>`, `<goal>`, `<project_structure>`, `<files>` sections
- `[meta]` block with generation timestamp, file count, byte/line/token stats

#### Code Processing
- Code minification: JS/TS via Terser, CSS via csso, HTML via html-minifier-terser, JSON compact
- Comment stripping for C-style (`//`, `/* */`), hash-style (`#`), HTML (`<!-- -->`), and CSS comments
- Intelligent text file detection covering 60+ extensions plus extensionless files (Makefile, Dockerfile, etc.)
- Git-aware scanning respecting recursive `.gitignore` files including negation and directory patterns

#### Presets
- Save/load file selections and options to `~/.source2prompt.json`
- Presets store relative paths for cross-project portability

#### UI Components (added in c0fa053)
- **ScrollableBox** -- Reusable scrollable content component with visual scrollbar showing thumb position and directional arrows
- **F1 help modal** -- Full-screen overlay displaying all keyboard shortcuts organized by section
- **Two-stage Escape to quit** -- First Esc shows confirmation, second Esc exits; prevents accidental quits
- **Scrollbars in explorer and combined output views**

#### Bug Fixes (in c0fa053)
- Fixed directory expand/collapse icons (were backwards: `[+]`/`[-]` swapped)
- Fixed cursor marker color from invisible "black" to visible "gray" on dark terminals
- Fixed bytes display to show transformed content size after minification, not original file size
- Fixed prompt preview condition to respect include flags
- Added 40+ missing text file extensions (.toml, .ini, .cfg, .sql, .graphql, .svelte, .vue, .astro, .swift, .kt, .scala, .clj, .ex, .hs, .lua, .r, .pl, .tf, and more)
- Added `TEXT_FILENAMES` set for extensionless text files (Makefile, Dockerfile, LICENSE, README, Gemfile, Procfile, Justfile, dotfiles like .gitignore, .editorconfig, etc.)

### CI Pipeline

- **GitHub Actions workflow** ([`923efb2`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/923efb29dd37d21577e5b0c9a5a9d7d66512a799), 2025-12-06) -- Lint and typecheck on every push; matrix builds (macOS arm64/x64, Linux x64/arm64) on `v*` tags; binary testing, SHA256 checksum generation, and automatic GitHub Release creation.

### Release Artifacts

Binaries: `s2p-macos-arm64`, `s2p-macos-x64`, `s2p-linux-x64`, `s2p-linux-arm64`, plus `.sha256` checksums.

---

## Pre-release History (2025-12-06)

### Initial Commit

- **Add initial project structure** ([`710943d`](https://github.com/Dicklesworthstone/source_to_prompt_tui/commit/710943d8e3663c490a718c95af98fed9d116a0cd), 2025-12-06) -- Established the Bun + TypeScript + React + Ink stack. Single-file architecture in `src/index.tsx` (~2,250 lines). Included `.gitignore`, `package.json`, `tsconfig.json`, `bun.lock`, and type declarations.

[Unreleased]: https://github.com/Dicklesworthstone/source_to_prompt_tui/compare/v0.3.2...HEAD
[v0.3.2]: https://github.com/Dicklesworthstone/source_to_prompt_tui/compare/v0.3.1...v0.3.2
[v0.3.1]: https://github.com/Dicklesworthstone/source_to_prompt_tui/compare/v0.3.0...v0.3.1
[v0.3.0]: https://github.com/Dicklesworthstone/source_to_prompt_tui/commits/v0.3.0
