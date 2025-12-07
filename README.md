# s2p — Source2Prompt TUI

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-blue)
![Runtime](https://img.shields.io/badge/runtime-Bun%201.3+-purple)
![Status](https://img.shields.io/badge/status-alpha-orange)
![License](https://img.shields.io/badge/license-MIT-green)

A world-class terminal UI for combining source code files into LLM-ready prompts. Features a tree explorer with file sizes and line counts, live syntax preview, token estimation, presets, and structured XML-like output — all in a single compiled binary.

<div align="center">

```bash
curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/source_to_prompt_tui/main/install.sh | bash
```

</div>

---

## Table of Contents

- [Highlights](#highlights)
- [Why s2p Exists](#why-s2p-exists)
- [Quickstart](#quickstart)
- [Usage](#usage)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Features in Depth](#features-in-depth)
- [Output Format](#output-format)
- [Architecture & Design](#architecture--design)
- [How the Scanning Algorithm Works](#how-the-scanning-algorithm-works)
- [Use Cases](#use-cases)
- [Performance & Scalability](#performance--scalability)
- [Security & Privacy](#security--privacy)
- [Options](#options)
- [Presets](#presets)
- [Local Development](#local-development)
- [CI & Releases](#ci--releases)
- [Troubleshooting](#troubleshooting)
- [Comparison](#comparison)
- [Contributing](#contributing)
- [License](#license)

---

## Highlights

- **Zero-setup binaries**: Installer downloads pre-built binaries for your platform; falls back to Bun source build automatically.
- **Tree file explorer**: Navigate your project with vim-style keys (j/k/h/l), expand/collapse directories, filter by path. Each file shows its size and line count.
- **Quick file-type selects**: Press `t` for all text files, or `1-9,0,r` for JS/React/TS/JSON/MD/Python/Go/Java/Ruby/PHP/Rust.
- **Live syntax preview**: See file contents with syntax highlighting as you navigate.
- **Token & cost estimation**: Real-time token count using tiktoken, with context window usage bar and cost estimate.
- **Running statistics**: See total size, total lines, and file count update in real-time as you select files.
- **Presets**: Save/load file selections and options to `~/.source2prompt.json`.
- **Structured output**: XML-like tags (`<preamble>`, `<goal>`, `<project_structure>`, `<files>`) for optimal LLM parsing.
- **Rich project tree**: Output includes ASCII tree with file sizes and line counts for context.
- **Minification & comment stripping**: JS/TS via Terser, CSS via csso, HTML via html-minifier-terser.
- **Git-aware scanning**: Respects `.gitignore` files recursively throughout your project, including nested gitignores.

---

## Why s2p Exists

Modern AI-assisted development often requires sharing code context with large language models. But getting that context into the right format is surprisingly painful:

### The Problem

1. **Manual copying loses structure**: When you copy-paste files into a chat, you lose the project hierarchy. The AI doesn't know how files relate to each other.

2. **Token limits are real**: GPT-4 has ~128K tokens, Claude has ~200K. You need to know if your selection fits before wasting a prompt.

3. **Context matters**: Just dumping code isn't enough. The AI needs to understand your file structure, your goals, and what you're trying to accomplish.

4. **Repetitive workflows are tedious**: If you're iterating on a feature across multiple sessions, re-selecting the same files is mind-numbing.

5. **Binary files cause confusion**: Including images or compiled assets in your prompt just adds noise.

### The Solution

s2p solves all of these problems:

- **Preserves project hierarchy** with a visual tree view showing exactly which files are included and how they relate
- **Shows real-time token counts** so you know exactly what fits in your context window
- **Uses structured XML-like output** that LLMs parse reliably and consistently
- **Supports presets** for saving and loading file selections across sessions
- **Automatically filters** binary files and respects your `.gitignore`
- **Provides keyboard-driven navigation** that's faster than any GUI

---

## Quickstart

```bash
# Install via one-liner (recommended)
curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/source_to_prompt_tui/main/install.sh | bash

# Or install with specific options
curl -fsSL ... | bash -s -- --dest /usr/local/bin --verify

# Or with Bun directly (if you have Bun installed)
bun install -g source2prompt-tui

# Run in any project directory
cd your-project
s2p
```

The installer automatically:
- Detects your platform (macOS arm64/x64, Linux x64/arm64)
- Downloads the appropriate pre-built binary
- Verifies the SHA256 checksum
- Installs to `~/.local/bin` (or your specified directory)
- Updates your shell config if needed to add the install directory to PATH

---

## Usage

Launch `s2p` in your project directory. The TUI displays four main areas:

| Area | Purpose |
|------|---------|
| **Explorer** | Tree view of files with sizes and line counts; select with Space/Enter |
| **Config** | Preamble/goal text, presets, options (minify, strip comments) |
| **Preview** | Syntax-highlighted preview of current file |
| **Stats & Sample** | Token count, context usage, cost estimate, and live prompt preview |

### The Explorer Pane

The explorer shows your project as an expandable tree. Each file displays:

```
📄 index.tsx (85.2 KB | 2,534 lines)
```

- **Size**: Helps you gauge file complexity at a glance
- **Line count**: Useful for estimating how much content you're including

Directories can be expanded/collapsed, and checking a directory selects all text files within it.

### The Stats Panel

The stats panel shows real-time information about your selection:

- **Tokens**: Estimated token count using tiktoken (cl100k_base encoding)
- **Cost**: Estimated API cost based on token count
- **Context bar**: Visual indicator of how much of a 128K context window you're using
- **Size/Lines/Files**: Total bytes, total lines, and file count for your selection

### Generating Output

Press `Ctrl+G` to generate the combined prompt and open the Combined Output view. From there:

- Press `y` to copy to clipboard
- Press `w` to save to a file
- Press `Esc` or `q` to return to the main view

---

## Keyboard Shortcuts

### Global
| Key | Action |
|-----|--------|
| `F1` | Show help modal |
| `Tab` | Switch between panes |
| `Ctrl+G` | Generate combined prompt |
| `Esc` | Exit (press twice to confirm) |
| `Ctrl+C` | Force quit |

### Explorer Pane
| Key | Action |
|-----|--------|
| `j` / `k` | Move cursor down/up |
| `h` / `l` | Collapse/expand directory |
| `Space` / `Enter` | Toggle file selection (or expand/collapse directory) |
| `/` or `f` | Focus filter input |
| `d` | Focus root directory input |
| `t` | Toggle all text files |
| `1` | Select all JavaScript files |
| `2` | Select all React files (JSX/TSX) |
| `3` | Select all TypeScript files |
| `4` | Select all JSON files |
| `5` | Select all Markdown files |
| `6` | Select all Python files |
| `7` | Select all Go files |
| `8` | Select all Java files |
| `9` | Select all Ruby files |
| `0` | Select all PHP files |
| `r` | Select all Rust files |
| `u` | Clear selection for filtered files |

### Config Pane
| Key | Action |
|-----|--------|
| `←` / `→` | Switch tabs (Inputs/Presets/Options) |
| `p` | Edit preamble (Inputs tab) |
| `g` | Edit goal (Inputs tab) |
| `i` | Toggle include preamble (Options tab) |
| `o` | Toggle include goal (Options tab) |
| `x` | Toggle remove comments (Options tab) |
| `m` | Toggle minify (Options tab) |
| `j` / `k` | Navigate presets (Presets tab) |
| `l` | Load preset |
| `d` | Delete preset |
| `s` | Save new preset |

### Combined Output View
| Key | Action |
|-----|--------|
| `j` / `k` | Scroll down/up |
| `PgDn` / `PgUp` | Scroll by page |
| `y` | Copy to clipboard |
| `w` | Save to file |
| `Esc` / `q` | Return to main view |

---

## Features in Depth

### Intelligent File Detection

s2p recognizes over 60 file extensions as text files, including:

- **Web**: `.js`, `.jsx`, `.ts`, `.tsx`, `.html`, `.css`, `.scss`, `.vue`, `.svelte`, `.astro`
- **Backend**: `.py`, `.rb`, `.go`, `.java`, `.php`, `.rs`, `.c`, `.cpp`, `.h`
- **Config**: `.json`, `.yaml`, `.yml`, `.toml`, `.ini`, `.env`
- **Docs**: `.md`, `.mdx`, `.txt`, `.rst`
- **DevOps**: `.dockerfile`, `.tf`, `.sh`, `.bash`

It also recognizes extensionless files like `Makefile`, `Dockerfile`, `Gemfile`, `Procfile`, and dotfiles like `.gitignore`, `.prettierrc`, etc.

### Recursive .gitignore Support

Unlike simple ignore implementations, s2p properly handles:

- **Nested gitignores**: A `.gitignore` in a subdirectory applies only to that subtree
- **Negation patterns**: `!important.log` to un-ignore specific files
- **Directory patterns**: `build/` vs `build` (trailing slash matters)
- **Glob patterns**: `*.log`, `**/*.tmp`, `test?.js`

Default ignores are always applied:
- `node_modules/`, `.git/`, `.next/`, `dist/`, `build/`, `out/`
- `.vscode/`, `.idea/`, `.turbo/`, `.vercel/`

### Token Estimation

s2p uses tiktoken with the `cl100k_base` encoding (same as GPT-4 and GPT-3.5-turbo) for accurate token counting. The estimation includes:

- All selected file contents
- The preamble and goal text (if enabled)
- The project tree structure
- XML tags and metadata

The context window bar shows usage against a 128K token limit, with warnings at:
- **100K+ tokens**: "Large prompt; ensure you're using a 128k+ context model"
- **128K+ tokens**: "Warning: Estimated tokens exceed context window; model may truncate"

### Code Minification

When minification is enabled, s2p applies format-specific optimizations:

| Format | Minifier | Optimizations |
|--------|----------|---------------|
| JS/TS/JSX/TSX | Terser | Dead code elimination, name mangling, whitespace removal |
| CSS | csso | Structural optimization, shorthand merging, whitespace removal |
| HTML | html-minifier-terser | Whitespace collapse, comment removal, inline CSS/JS minification |
| JSON | Native | Whitespace removal (compact output) |

Minification can significantly reduce token count for large files, sometimes by 30-50%.

### Comment Stripping

The comment removal feature supports multiple comment styles:

- **C-style**: `//` line comments and `/* */` block comments (JS, TS, Java, Go, C, C++, Rust, PHP)
- **Hash-style**: `#` comments (Python, Ruby, shell scripts)
- **HTML-style**: `<!-- -->` comments
- **CSS-style**: `/* */` comments

Comment stripping happens before minification, so you can use both together for maximum compression.

---

## Output Format

Generated prompts use a structured format optimized for LLM parsing:

```xml
===== SOURCE2PROMPT v2 =====

[meta]
project_root: /Users/you/projects/myapp
generated_at: 2024-01-15T10:30:00.000Z
files_selected: 5
body_bytes: 12345
body_lines: 456
body_tokens_est: 3200
options: include_preamble=true, include_goal=true, remove_comments=false, minify=false
[/meta]

<preamble>
You are an expert TypeScript developer. The following is the complete source code
for a React application. Please analyze it carefully before responding.
</preamble>

<goal>
I need help fixing a bug where the user authentication token expires but the app
doesn't redirect to the login page. The issue seems to be in the auth middleware.
</goal>

<project_structure>
myapp/
├── src/
│   ├── components/
│   │   ├── Button.tsx (Size: 2.34kb; Lines: 89)
│   │   └── Modal.tsx (Size: 4.12kb; Lines: 156)
│   ├── hooks/
│   │   └── useAuth.ts (Size: 1.87kb; Lines: 72)
│   └── index.tsx (Size: 0.95kb; Lines: 34)
└── package.json (Size: 1.21kb; Lines: 43)
</project_structure>

<files>
<file path="src/index.tsx" lang="tsx" lines="34" bytes="972" tokens="245">
import React from 'react';
import { createRoot } from 'react-dom/client';
// ... file contents
</file>

<file path="src/hooks/useAuth.ts" lang="ts" lines="72" bytes="1915" tokens="489">
import { useState, useEffect } from 'react';
// ... file contents
</file>
</files>
```

### Why This Format?

1. **Metadata header**: The `[meta]` block gives the LLM crucial context about the prompt itself — when it was generated, how many files, total size. This helps the model understand the scope of what it's analyzing.

2. **Structured sections**: XML-like tags (`<preamble>`, `<goal>`, `<files>`) create clear boundaries that LLMs parse reliably. Unlike markdown headers or comments, these tags are unambiguous.

3. **Project structure with stats**: The ASCII tree with file sizes and line counts gives the LLM a "map" of the codebase. It can see at a glance which files are large (likely important) and how the project is organized.

4. **File metadata attributes**: Each `<file>` tag includes `path`, `lang`, `lines`, `bytes`, and `tokens`. This lets the LLM:
   - Understand file relationships from paths
   - Apply language-specific knowledge from `lang`
   - Gauge file complexity from size metrics

5. **Consistent structure**: Every prompt follows the same format, so you can give the LLM meta-instructions about how to parse it ("look at the project_structure first to understand the layout").

---

## Architecture & Design

### Technology Stack

s2p is built with:

- **Bun**: JavaScript/TypeScript runtime with built-in bundler and single-binary compilation
- **React**: Component model for declarative UI
- **Ink**: React renderer for terminal interfaces
- **TypeScript**: Type safety throughout

This stack was chosen for several reasons:

1. **Single-binary distribution**: Bun can compile the entire application into a standalone executable with no runtime dependencies. Users don't need Node.js, npm, or anything else installed.

2. **Fast startup**: Bun's ahead-of-time compilation means the binary starts in milliseconds, not seconds.

3. **React's component model**: Building a TUI with React means the code is declarative and maintainable. State changes automatically re-render the UI.

4. **Ink's terminal abstraction**: Ink handles all the complexity of terminal escape codes, cursor positioning, and input handling.

### Design Principles

1. **Keyboard-first**: Every action is accessible via keyboard. Mouse support is secondary (handled by the terminal emulator, not the app).

2. **Real-time feedback**: Statistics, previews, and the prompt sample update immediately as you make selections. No "refresh" buttons.

3. **Fail gracefully**: If a file can't be read, minification fails, or clipboard access is denied, the app continues working with appropriate fallbacks.

4. **Respect the user's project**: s2p never modifies any files. It only reads and generates output.

5. **Offline-first**: After installation, s2p makes no network requests. All processing happens locally.

---

## How the Scanning Algorithm Works

When you launch s2p, it performs a depth-first scan of your project directory:

### Phase 1: Gitignore Collection

```
1. Check for .gitignore in root directory
2. Parse patterns into an ignore filter
3. Add default ignores (node_modules, .git, etc.)
```

### Phase 2: Directory Traversal

```
For each entry in directory:
  1. Check if path matches any ignore pattern → skip if true
  2. If directory:
     a. Check for nested .gitignore → merge with parent patterns
     b. Recurse into directory
  3. If file:
     a. Get file stats (size)
     b. Determine if text file by extension/name
     c. If text and < 5MB: read contents, count lines
     d. Categorize by file type (JS, Python, etc.)
     e. Add to file tree
```

### Phase 3: Tree Construction

The scan builds a hierarchical tree structure:

```typescript
interface FileNode {
  path: string;        // Absolute path
  relPath: string;     // Relative to project root
  name: string;        // Filename only
  isDirectory: boolean;
  sizeBytes: number;
  numLines: number;    // 0 for directories or binary files
  isText: boolean;
  category: FileCategory;  // 'javascript' | 'python' | etc.
  content: string;     // Cached content for small text files
  children?: FileNode[];
}
```

### Phase 4: Statistics Calculation

When selections change, a debounced function recalculates:

```typescript
const stats = {
  fileCount: selectedFiles.length,
  totalBytes: sum(file.sizeBytes),
  totalLines: sum(file.numLines),
  totalTokens: sum(countTokens(file.content))
};
```

Token counting uses tiktoken's `cl100k_base` encoding, the same encoding used by GPT-4. For files without cached content (>5MB), tokens are estimated as `bytes / 4`.

---

## Use Cases

### 1. Bug Reports and Debugging

When you encounter a bug, you often need to share relevant code with an AI assistant:

```
Goal: "The login form submits twice when clicking the button. Here's the relevant code."

Selected files:
- src/components/LoginForm.tsx
- src/hooks/useAuth.ts
- src/api/auth.ts
```

The structured output helps the AI understand the full context, not just isolated snippets.

### 2. Code Review Preparation

Before submitting a PR, get AI feedback on your changes:

```
Preamble: "You are a senior code reviewer. Review the following code for bugs,
          security issues, and style problems."

Goal: "Review these files I'm about to submit in a PR for the new user dashboard."

Selected files:
- src/pages/Dashboard.tsx
- src/components/UserStats.tsx
- src/api/analytics.ts
```

### 3. Feature Implementation

When building a new feature, share the existing patterns:

```
Preamble: "This is an existing React/TypeScript codebase. Follow the established patterns."

Goal: "Help me implement a notification system similar to how the existing alert
      system works."

Selected files:
- src/components/Alert.tsx (existing pattern)
- src/hooks/useAlerts.ts (existing hook)
- src/types/notifications.ts (new file to create)
```

### 4. Documentation Generation

Generate documentation from your codebase:

```
Goal: "Generate API documentation for these endpoint handlers. Include request/response
      types, error cases, and example usage."

Selected files:
- src/api/users.ts
- src/api/products.ts
- src/api/orders.ts
```

### 5. Learning and Onboarding

Help new team members understand a codebase:

```
Goal: "Explain how the authentication flow works in this application. Walk through
      the code step by step."

Selected files:
- src/middleware/auth.ts
- src/hooks/useAuth.ts
- src/pages/Login.tsx
- src/api/auth.ts
```

### 6. Refactoring Assistance

Get help with large-scale refactoring:

```
Preamble: "We're migrating from Redux to Zustand for state management."

Goal: "Convert this Redux slice to a Zustand store, maintaining the same API."

Selected files:
- src/store/userSlice.ts (to refactor)
- src/store/cartSlice.ts (already converted, as example)
```

---

## Performance & Scalability

### Large Project Handling

s2p is designed to handle large projects efficiently:

- **Lazy content loading**: File contents are only read for files <5MB. Larger files show size but content is loaded on-demand.
- **Debounced statistics**: Token counting and stats updates are debounced (200ms) to prevent UI lag during rapid selection changes.
- **Efficient tree rendering**: Only visible nodes are rendered. Scrolling is virtualized.

### Memory Considerations

For very large projects (10,000+ files), memory usage scales with:
- File metadata: ~500 bytes per file
- Cached content: Only for selected files <5MB
- Rendered UI: Constant (virtualized)

A project with 10,000 files uses approximately 5MB of memory for metadata.

### Recommended Limits

| Metric | Recommended | Maximum |
|--------|-------------|---------|
| Files in project | <50,000 | 100,000+ (slower) |
| Selected files | <100 | 500+ (larger output) |
| Individual file size | <1MB | 5MB (hard limit) |
| Total output size | <500KB | 2MB+ (may exceed context) |

---

## Security & Privacy

### Local Processing

**s2p processes everything locally.** After installation, it makes zero network requests. Your code never leaves your machine.

- File scanning: Local filesystem only
- Token counting: Local tiktoken library
- Clipboard: Local system clipboard
- Presets: Stored in `~/.source2prompt.json`

### No Telemetry

s2p collects no analytics, usage data, or telemetry of any kind. There are no crash reports, no usage metrics, no "anonymous" data collection.

### Installation Security

The installer verifies downloaded binaries using SHA256 checksums:

```bash
# Checksums are generated in CI and uploaded alongside binaries
sha256sum s2p-macos-arm64 > s2p-macos-arm64.sha256

# Installer verifies before installing
echo "${expected}  ${file}" | sha256sum -c -
```

You can also verify manually:
```bash
curl -fsSL https://github.com/.../s2p-macos-arm64.sha256
sha256sum ~/.local/bin/s2p
```

### Permissions

s2p requires only:
- **Read access**: To your project directory
- **Write access**: To `~/.source2prompt.json` (presets) and clipboard
- **No network access**: After installation

---

## Options

| Option | Default | Description |
|--------|---------|-------------|
| Include Preamble | ON | Add `<preamble>` section with context instructions |
| Include Goal | OFF | Add `<goal>` section with task objective |
| Remove Comments | OFF | Strip comments from code (C-style and hash-style) |
| Minify | OFF | Minify JS/TS/CSS/HTML/JSON for smaller output |

### When to Use Each Option

**Include Preamble**: Almost always. Use it to set context ("You are a TypeScript expert") or provide instructions ("Focus on security issues").

**Include Goal**: When you have a specific task. Skip it if you're just sharing code for general discussion.

**Remove Comments**: When comments are verbose or outdated, or when you need to reduce token count. Skip it if comments contain important context.

**Minify**: When you're hitting token limits and need to squeeze more code in. Skip it if readability matters for the task (e.g., code review).

---

## Presets

Presets save your current configuration including:
- Selected files (by relative path)
- Preamble and goal text
- Include flags (preamble, goal)
- Processing options (minify, remove comments)
- Root directory

### Preset Storage

Presets are stored in `~/.source2prompt.json`:

```json
{
  "presets": [
    {
      "name": "Frontend Debug",
      "rootDir": "/Users/you/projects/myapp",
      "includePreamble": true,
      "includeGoal": true,
      "preamble": "You are a React/TypeScript expert...",
      "goal": "",
      "minify": false,
      "removeComments": false,
      "selectedRelPaths": [
        "src/components/Button.tsx",
        "src/hooks/useAuth.ts"
      ],
      "createdAt": "2024-01-15T10:30:00.000Z"
    }
  ]
}
```

### Cross-Project Presets

Presets store relative paths, so a preset created in `/projects/app-a` can be loaded in `/projects/app-b` if the file structure matches. Missing files are reported but don't prevent loading.

---

## Local Development

```bash
# Clone and install
git clone https://github.com/Dicklesworthstone/source_to_prompt_tui.git
cd source_to_prompt_tui
bun install

# Run the postinstall script (patches dependencies for bun compile)
bun scripts/patch-modules.js

# Development
bun run dev          # Run TUI directly

# Type checking
bun run typecheck    # TypeScript type check

# Build
bun run build        # TypeScript compile
bun run build:bin    # Single-file binary for current platform

# Cross-platform builds
bun run build:mac-arm64
bun run build:mac-x64
bun run build:linux-x64
bun run build:linux-arm64
bun run build:all    # All platforms
```

### Project Structure

```
source_to_prompt_tui/
├── src/
│   └── index.tsx          # Main application (all-in-one)
├── scripts/
│   └── patch-modules.js   # Postinstall script for bun compile fixes
├── install.sh             # One-liner installer
├── package.json
├── tsconfig.json
└── .github/
    └── workflows/
        └── ci.yml         # CI/CD pipeline
```

### Why Single-File Architecture?

The entire application is in `src/index.tsx` (~2,500 lines). This is intentional:

1. **Simpler bundling**: Bun compiles everything into one binary without complex import resolution
2. **Easier debugging**: Stack traces point to one file
3. **Faster builds**: No cross-file dependency analysis
4. **Self-contained**: Easy to understand the full application flow

---

## CI & Releases

### Workflow

1. **On every push**: Lint → Typecheck
2. **On tagged push (`v*`)**:
   - Matrix builds (macOS arm64/x64, Linux x64/arm64)
   - Test binaries
   - Upload artifacts
   - Generate SHA256 checksums
   - Create GitHub release

### Release Artifacts

Each release includes:
- `s2p-macos-arm64` — macOS Apple Silicon
- `s2p-macos-x64` — macOS Intel
- `s2p-linux-x64` — Linux x86_64
- `s2p-linux-arm64` — Linux ARM64
- `*.sha256` — Individual checksums
- `sha256.txt` — Combined checksums

### Creating a Release

```bash
# Bump version in package.json
# Commit changes
git add -A && git commit -m "Bump to v0.4.0"

# Tag and push
git tag v0.4.0
git push origin main v0.4.0
```

CI automatically builds and publishes the release.

---

## Environment Variables

### Installer Options

| Variable | Description |
|----------|-------------|
| `VERSION` | Pin to specific release tag (e.g., `v0.3.0`) |
| `DEST` | Install directory (default: `~/.local/bin`) |
| `OWNER` | GitHub owner (default: `Dicklesworthstone`) |
| `REPO` | GitHub repo (default: `source_to_prompt_tui`) |
| `BINARY` | Installed binary name (default: `s2p`) |
| `CHECKSUM_URL` | Override checksum location |

### Installer Flags

```bash
curl -fsSL .../install.sh | bash -s -- [OPTIONS]

Options:
  --version vX.Y.Z   Install specific version
  --dest DIR         Install directory
  --system           Install to /usr/local/bin
  --from-source      Build from source instead of downloading
  --quiet, -q        Suppress output
  --verify           Require checksum verification
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `command not found: s2p` | Install dir not in PATH | Add `~/.local/bin` to PATH; restart shell |
| Binary won't start | Wrong architecture | Reinstall; check `uname -m` matches binary |
| Large file missing | >5MB limit | Intentional; split large files or increase limit in source |
| Token count seems off | Encoding differences | Estimation uses cl100k_base; actual varies by model |
| Minify fails silently | Invalid syntax | Original content used; check for syntax errors |
| Clipboard fails | Missing utility | Install `xclip` (Linux) or ensure `pbcopy` works (macOS) |
| Slow on large projects | Many files | Normal; scanning 10K+ files takes a few seconds |
| Preset files missing | Project moved | Presets store paths; re-select if structure changed |
| Raw mode error | Not a TTY | Run in a real terminal, not piped |

### Debug Mode

For issues, run with Bun directly to see full errors:

```bash
cd /path/to/source_to_prompt_tui
bun run src/index.tsx
```

---

## Comparison

### vs. Manual Copy-Paste

| Aspect | Manual | s2p |
|--------|--------|-----|
| Project structure | Lost | Preserved with tree |
| Token awareness | None | Real-time counting |
| Format consistency | Variable | Structured XML |
| Repeated workflows | Start over | Use presets |
| File selection | Mouse clicking | Keyboard shortcuts |
| Binary file handling | Accidental inclusion | Auto-filtered |

### vs. Other Tools

| Feature | s2p | repomix | code2prompt |
|---------|-----|---------|-------------|
| Interactive TUI | ✅ | ❌ | ❌ |
| Real-time preview | ✅ | ❌ | ❌ |
| Token counting | ✅ | ✅ | ✅ |
| Presets | ✅ | ❌ | ❌ |
| Single binary | ✅ | ❌ | ❌ |
| Minification | ✅ | ❌ | ❌ |
| File sizes in tree | ✅ | ❌ | ❌ |
| Line counts | ✅ | ❌ | ❌ |

---

## Contributing

Contributions are welcome! Here's how to help:

### Bug Reports

Open an issue with:
- Your platform (macOS/Linux, architecture)
- Steps to reproduce
- Expected vs actual behavior
- Any error messages

### Feature Requests

Open an issue describing:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you considered

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run `bun run typecheck` to ensure no type errors
5. Test locally with `bun run dev`
6. Commit with a descriptive message
7. Push and open a PR

### Code Style

- TypeScript with strict mode
- Functional components with hooks
- Descriptive variable names
- Comments for complex logic

---

## Acknowledgments

Built with:
- [Bun](https://bun.sh) — Fast JavaScript runtime
- [Ink](https://github.com/vadimdemedes/ink) — React for CLIs
- [tiktoken](https://github.com/openai/tiktoken) — Token counting
- [Terser](https://terser.org) — JavaScript minification
- [csso](https://github.com/css/csso) — CSS minification

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">

**[Report Bug](https://github.com/Dicklesworthstone/source_to_prompt_tui/issues) · [Request Feature](https://github.com/Dicklesworthstone/source_to_prompt_tui/issues)**

Made with ❤️ for the AI-assisted development community

</div>
