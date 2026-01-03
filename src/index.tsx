#!/usr/bin/env bun
import React, { useEffect, useMemo, useRef, useState } from "react";
import { render, Box, Text, useInput, useApp, useStdout, useStdin } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import Gradient from "ink-gradient";
// BigText removed - cfonts breaks bun compile (runtime require of package.json)
import SyntaxHighlight from "ink-syntax-highlight";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ignore, { Ignore } from "ignore";
import { minify as terserMinify } from "terser";
import * as csso from "csso";
import { minify as htmlMinify } from "html-minifier-terser";
import { encodingForModel, getEncoding, Tiktoken } from "js-tiktoken";

declare const Bun: any;

/* ---------- Concurrency Semaphore ---------- */
const MAX_CONCURRENT_OPS = 64;
let activeOps = 0;
const opQueue: (() => void)[] = [];

async function acquireOp(): Promise<void> {
  if (activeOps < MAX_CONCURRENT_OPS) {
    activeOps++;
    return;
  }
  return new Promise<void>(resolve => opQueue.push(resolve));
}

function releaseOp(): void {
  activeOps--;
  if (opQueue.length > 0) {
    activeOps++; // Immediately take next
    const next = opQueue.shift()!;
    next();
  }
}

async function withConcurrency<T>(fn: () => Promise<T>): Promise<T> {
  await acquireOp();
  try {
    return await fn();
  } finally {
    releaseOp();
  }
}

/* ---------- Custom Progress Bar Component ---------- */
interface ProgressBarProps {
  percent: number;
  color?: string;
  width?: number;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ percent, color = "green", width = 30 }) => {
  const filled = Math.round(percent * width);
  const empty = width - filled;
  const filledStr = "=".repeat(Math.max(0, filled));
  const emptyStr = "-".repeat(Math.max(0, empty));
  return (
    <Box>
      <Text>[</Text>
      <Text color={color as any}>{filledStr}</Text>
      <Text dimColor>{emptyStr}</Text>
      <Text>]</Text>
    </Box>
  );
};

/* ---------- Scrollable Box Component ---------- */
interface ScrollableBoxProps {
  children: React.ReactNode;
  height: number;
  scrollOffset: number;
  showScrollbar?: boolean;
  accentColor?: string;
  totalItems?: number; // If provided, assumes children are already sliced (virtual scrolling)
}

const ScrollableBox: React.FC<ScrollableBoxProps> = ({
  children,
  height,
  scrollOffset,
  showScrollbar = true,
  accentColor = "cyan",
  totalItems: explicitTotal
}) => {
  const childArray = React.Children.toArray(children);
  
  let totalItems: number;
  let visibleChildren: React.ReactNode[];

  if (explicitTotal !== undefined) {
    totalItems = explicitTotal;
    visibleChildren = childArray;
  } else {
    totalItems = childArray.length;
    visibleChildren = childArray.slice(scrollOffset, scrollOffset + height);
  }

  const needsScrollbar = totalItems > height;

  // Calculate scrollbar metrics (only used when scrollbar is shown)
  const trackHeight = Math.max(1, height - 2); // -2 for up/down arrows
  const thumbSize = totalItems > 0
    ? Math.max(1, Math.round((height / totalItems) * trackHeight))
    : 1;
  const maxThumbPos = Math.max(0, trackHeight - thumbSize);
  const scrollRatio = totalItems > height
    ? scrollOffset / (totalItems - height)
    : 0;
  const thumbPos = Math.round(scrollRatio * maxThumbPos);

  const canScrollUp = scrollOffset > 0;
  const canScrollDown = scrollOffset + height < totalItems;

  return (
    <Box flexDirection="row" height={height}>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visibleChildren}
      </Box>
      {showScrollbar && needsScrollbar && (
        <Box flexDirection="column" width={1} marginLeft={1}>
          <Text color={canScrollUp ? accentColor : "gray"}>^</Text>
          {Array.from({ length: trackHeight }).map((_, i) => {
            const isThumb = i >= thumbPos && i < thumbPos + thumbSize;
            return (
              <Text key={i} color={isThumb ? accentColor : "gray"}>
                {isThumb ? "#" : "|"}
              </Text>
            );
          })}
          <Text color={canScrollDown ? accentColor : "gray"}>v</Text>
        </Box>
      )}
    </Box>
  );
};

/* ---------- Exit Confirm Modal Component ---------- */
interface ExitConfirmProps {
  rows: number;
  cols: number;
}

const ExitConfirm: React.FC<ExitConfirmProps> = ({ rows, cols }) => {
  const modalWidth = 50;
  const modalHeight = 9;

  return (
    <Box
      position="absolute"
      flexDirection="column"
      width={cols}
      height={rows}
      justifyContent="center"
      alignItems="center"
    >
      <Box
        flexDirection="column"
        width={modalWidth}
        height={modalHeight}
        borderStyle="double"
        borderColor="yellow"
        padding={1}
        alignItems="center"
        justifyContent="center"
      >
        <Box marginBottom={1}>
          <Text bold color="yellow">Exit Confirmation</Text>
        </Box>
        <Text>Are you sure you want to quit?</Text>
        <Box marginTop={1}>
          <Text dimColor>Press </Text>
          <Text bold color="red">Esc</Text>
          <Text dimColor> to quit, any other key to cancel</Text>
        </Box>
      </Box>
    </Box>
  );
};

/* ---------- Help Modal Component ---------- */
interface HelpModalProps {
  rows: number;
  cols: number;
}

const HelpModal: React.FC<HelpModalProps> = ({ rows, cols }) => {
  const modalWidth = Math.min(80, cols - 4);
  const modalHeight = Math.min(30, rows - 4);

  return (
    <Box
      position="absolute"
      flexDirection="column"
      width={cols}
      height={rows}
      justifyContent="center"
      alignItems="center"
    >
      <Box
        flexDirection="column"
        width={modalWidth}
        height={modalHeight}
        borderStyle="double"
        borderColor="cyan"
        padding={1}
      >
        <Box justifyContent="center" marginBottom={1}>
          <Text bold color="cyan">Help - Keyboard Shortcuts</Text>
        </Box>

        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="column" width="48%">
            <Text bold color="yellow">Global</Text>
            <Text>  F1 / ?     Show this help</Text>
            <Text>  Esc        Exit (press twice to quit)</Text>
            <Text>  Ctrl+C     Force quit</Text>
            <Text>  Ctrl+G     Generate combined prompt</Text>
            <Text>  Tab        Switch panes</Text>
            <Text></Text>
            <Text bold color="yellow">Explorer Pane</Text>
            <Text>  j/k        Move cursor down/up</Text>
            <Text>  h/l        Collapse/expand directory</Text>
            <Text>  Space      Toggle file selection</Text>
            <Text>  Enter      Toggle select/expand</Text>
            <Text>  / or f     Filter files</Text>
            <Text>  d          Change root directory</Text>
            <Text>  u          Clear filtered selection</Text>
            <Text>  a/A        Select/deselect all filtered</Text>
          </Box>

          <Box flexDirection="column" width="48%">
            <Text bold color="yellow">Quick Select (Explorer)</Text>
            <Text>  t          All text files</Text>
            <Text>  1-9,0,r    JS/React/TS/JSON/MD/...</Text>
            <Text></Text>
            <Text bold color="yellow">Config Pane</Text>
            <Text>  Left/Right Switch tabs</Text>
            <Text>  p/g        Focus preamble/goal</Text>
            <Text>  Ctrl+E     Edit in $EDITOR (multiline)</Text>
            <Text>  i/o        Toggle preamble/goal</Text>
            <Text>  x/m        Toggle comments/minify</Text>
            <Text>  s/l/d      Save/load/delete preset</Text>
            <Text></Text>
            <Text bold color="yellow">Preview Pane</Text>
            <Text>  j/k        Scroll preview</Text>
            <Text>  b/Space    Page up/down</Text>
            <Text>  g/G        Top/bottom</Text>
            <Text></Text>
            <Text bold color="yellow">Prompt Sample</Text>
            <Text>  z          Collapse/expand</Text>
            <Text>  j/k        Scroll (when focused)</Text>
            <Text>  b/Space    Page up/down</Text>
            <Text>  g/G        Top/bottom</Text>
            <Text></Text>
            <Text bold color="yellow">Combined Output View</Text>
            <Text>  y          Copy to clipboard</Text>
            <Text>  w          Save to file</Text>
            <Text>  Esc/q      Return to main view</Text>
          </Box>
        </Box>

        <Box justifyContent="center" marginTop={1}>
          <Text dimColor>Press Esc, F1, or ? to close</Text>
        </Box>
      </Box>
    </Box>
  );
};

/* ---------- Types & constants ---------- */

type Pane = "explorer" | "config" | "preview" | "sample";
type ConfigTab = "inputs" | "presets" | "options";
type Mode = "main" | "combined";

type FileCategory =
  | "javascript"
  | "react"
  | "typescript"
  | "json"
  | "markdown"
  | "python"
  | "go"
  | "java"
  | "ruby"
  | "php"
  | "rust"
  | "other";

interface FileNode {
  path: string; // absolute
  relPath: string; // relative to root
  name: string;
  isDirectory: boolean;
  sizeBytes: number;
  depth: number;
  extension: string;
  isText: boolean;
  category: FileCategory;
  numLines: number;
  tokens?: number; // Cached token count
  children?: FileNode[];
}

interface Preset {
  name: string;
  rootDir: string;
  includePreamble: boolean;
  includeGoal: boolean;
  preamble: string;
  goal: string;
  minify: boolean;
  removeComments: boolean;
  selectedRelPaths: string[];
  createdAt: string;
}

interface CombinedResult {
  text: string;
  bytes: number;
  tokens: number;
  lines: number;
}

type FocusField =
  | "none"
  | "filter"
  | "rootDir"
  | "preamble"
  | "goal"
  | "presetName"
  | "exportPath";

type QuickSelectKey =
  | "allText"
  | "javascript"
  | "react"
  | "typescript"
  | "json"
  | "markdown"
  | "python"
  | "go"
  | "java"
  | "ruby"
  | "php"
  | "rust";

interface CombineOptions {
  includePreamble: boolean;
  preambleText: string;
  includeGoal: boolean;
  goalText: string;
  removeComments: boolean;
  minify: boolean;
}

/* ---------- Tokenizer setup ---------- */

let encoder: Tiktoken | null = null;
try {
  encoder = encodingForModel("gpt-4o-mini");
} catch {
  try {
    encoder = getEncoding("cl100k_base");
  } catch {
    encoder = null;
  }
}

function countTokens(text: string): number {
  if (!text) return 0;
  if (!encoder) {
    const bytes = Buffer.byteLength(text, "utf8");
    return Math.ceil(bytes / 4);
  }
  return encoder.encode(text).length;
}

/* ---------- FS & scanning utilities ---------- */

const DEFAULT_IGNORES = [
  "node_modules/",
  ".git/",
  ".hg/",
  ".svn/",
  ".idea/",
  ".vscode/",
  "dist/",
  "build/",
  "out/",
  ".next/",
  ".turbo/",
  ".vercel/"
];

const TEXT_EXTENSIONS = new Set<string>([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".markdown",
  ".rst",
  ".txt",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".yml",
  ".yaml",
  ".xml",
  ".py",
  ".rb",
  ".go",
  ".java",
  ".php",
  ".rs",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cc",
  ".hh",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".env",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".sql",
  ".graphql",
  ".gql",
  ".prisma",
  ".svelte",
  ".vue",
  ".astro",
  ".swift",
  ".kt",
  ".kts",
  ".scala",
  ".clj",
  ".cljs",
  ".ex",
  ".exs",
  ".erl",
  ".hrl",
  ".hs",
  ".lua",
  ".r",
  ".R",
  ".pl",
  ".pm",
  ".tf",
  ".tfvars",
  ".dockerfile",
  ".containerfile",
  ".cs",
  ".dart",
  ".bat",
  ".cmd",
  ".ps1",
  ".gradle",
  ".properties",
  ".cmake"
]);

// Files without extensions that are known to be text
const TEXT_FILENAMES = new Set<string>([
  "Makefile",
  "Dockerfile",
  "Containerfile",
  "LICENSE",
  "README",
  "CHANGELOG",
  "CONTRIBUTING",
  "AUTHORS",
  "COPYING",
  "INSTALL",
  "TODO",
  "NEWS",
  "NOTICE",
  "Rakefile",
  "Gemfile",
  "Podfile",
  "Brewfile",
  "Procfile",
  "Vagrantfile",
  "Justfile",
  "Taskfile",
  ".gitignore",
  ".gitattributes",
  ".gitmodules",
  ".editorconfig",
  ".prettierrc",
  ".prettierignore",
  ".eslintrc",
  ".eslintignore",
  ".babelrc",
  ".npmrc",
  ".nvmrc",
  ".dockerignore",
  ".helmignore",
  ".npmignore"
]);

const PRESET_FILE = path.join(os.homedir(), ".source2prompt.json");
const CONTEXT_WINDOW = 128000;
const COST_PER_1M_TOKENS = 5.0;
const MAX_PREVIEW_CHARS = 2000;
const MAX_READ_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_INCLUDE_BYTES = 25 * 1024 * 1024; // 25MB safety cap for including a single file
const MAX_SCAN_TOKEN_BYTES = 2 * 1024; // 2KB - files larger than this use byte estimation during scan (js-tiktoken is slow)

function expandTilde(filepath: string): string {
  if (filepath.startsWith("~/") || filepath === "~") {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const k = 1024;
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  const value = bytes / Math.pow(k, i);
  const decimals = value >= 10 || i === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[i]}`;
}

function getFileCategory(ext: string): FileCategory {
  const e = ext.toLowerCase();
  switch (e) {
    case ".jsx":
    case ".tsx":
      return "react";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".ts":
      return "typescript";
    case ".json":
      return "json";
    case ".md":
    case ".mdx":
    case ".markdown":
      return "markdown";
    case ".py":
      return "python";
    case ".go":
      return "go";
    case ".java":
      return "java";
    case ".rb":
      return "ruby";
    case ".php":
      return "php";
    case ".rs":
      return "rust";
    default:
      return "other";
  }
}

function isTextFile(ext: string, filename: string): boolean {
  if (TEXT_EXTENSIONS.has(ext.toLowerCase())) return true;
  if (TEXT_FILENAMES.has(filename)) return true;
  return false;
}

function isLargeTextNode(node: FileNode): boolean {
  return !node.isDirectory && node.isText && node.sizeBytes > MAX_READ_BYTES;
}

function isSelectableTextNode(node: FileNode): boolean {
  return !node.isDirectory && node.isText && node.sizeBytes <= MAX_INCLUDE_BYTES;
}

async function readFileHeadUtf8(filePath: string, maxBytes: number): Promise<string> {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return "";
  const file = await fsp.open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(maxBytes);
    const { bytesRead } = await file.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close().catch(() => {});
  }
}

function languageFromExtension(ext: string): string {
  const e = ext.toLowerCase();
  if (e === ".ts" || e === ".tsx") return "ts";
  if (e === ".js" || e === ".jsx" || e === ".mjs" || e === ".cjs") return "js";
  if (e === ".json") return "json";
  if (e === ".md" || e === ".markdown" || e === ".mdx") return "md";
  if (e === ".py") return "py";
  if (e === ".java") return "java";
  if (e === ".go") return "go";
  if (e === ".rb") return "rb";
  if (e === ".php") return "php";
  if (e === ".rs") return "rs";
  if (e === ".html" || e === ".htm") return "html";
  if (e === ".css" || e === ".scss" || e === ".sass" || e === ".less") return "css";
  if (e === ".yml" || e === ".yaml") return "yaml";
  if (e === ".xml") return "xml";
  return "txt";
}

async function buildIgnore(rootDir: string): Promise<Ignore> {
  const ig = ignore();
  ig.add(DEFAULT_IGNORES);
  return ig;
}

type IgnoreRule = { baseRel: string; matcher: Ignore };

async function loadGitignoreMatcher(dirAbs: string): Promise<Ignore | null> {
  const giPath = path.join(dirAbs, ".gitignore");
  let content: string;
  try {
    content = await fsp.readFile(giPath, "utf8");
  } catch {
    return null;
  }

  const patterns = content
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.length > 0 && !line.startsWith("#"));

  if (patterns.length === 0) return null;
  const matcher = ignore();
  matcher.add(patterns);
  return matcher;
}

function shouldIgnorePath(relPath: string, isDir: boolean, rules: IgnoreRule[]): boolean {
  const pathForMatch = isDir ? `${relPath}/` : relPath;
  let ignored = false;

  for (const { baseRel, matcher } of rules) {
    const candidate = baseRel
      ? pathForMatch.startsWith(`${baseRel}/`)
        ? pathForMatch.slice(baseRel.length + 1)
        : null
      : pathForMatch;
    if (!candidate) continue;
    const res = matcher.test(candidate);
    if (res.ignored) ignored = true;
    else if (res.unignored) ignored = false;
  }

  return ignored;
}

async function scanProject(
  rootDir: string,
  onProgress?: (info: { processedFiles: number; currentPath?: string }) => void
): Promise<{ root: FileNode; flatFiles: FileNode[] }> {
  const resolvedRoot = path.resolve(rootDir);
  const defaultIgnore = await buildIgnore(resolvedRoot);

  const root: FileNode = {
    path: resolvedRoot,
    relPath: ".",
    name: path.basename(resolvedRoot),
    isDirectory: true,
    sizeBytes: 0,
    depth: 0,
    extension: "",
    isText: false,
    category: "other",
    numLines: 0,
    children: []
  };

  const flatFiles: FileNode[] = [];
  let processed = 0;

  async function walk(
    dirAbs: string,
    parent: FileNode,
    relDir: string,
    depth: number,
    rules: IgnoreRule[]
  ) {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    const nextRules = [...rules];
    const localGitignore = await loadGitignoreMatcher(dirAbs);
    if (localGitignore) {
      nextRules.push({ baseRel: relDir, matcher: localGitignore });
    }

    const childrenPromises = entries.map(async (entry) => {
      return withConcurrency(async () => {
        const relPath = relDir ? path.posix.join(relDir, entry.name) : entry.name;
        if (shouldIgnorePath(relPath, entry.isDirectory(), nextRules)) return null;

        const absPath = path.join(dirAbs, entry.name);

        if (entry.isDirectory()) {
          const node: FileNode = {
            path: absPath,
            relPath,
            name: entry.name,
            isDirectory: true,
            sizeBytes: 0,
            depth: depth + 1,
            extension: "",
            isText: false,
            category: "other",
            numLines: 0,
            children: []
          };
          await walk(absPath, node, relPath, depth + 1, nextRules);
          return node;
        } else if (entry.isFile()) {
          let sizeBytes = 0;
          try {
            const stat = await fsp.stat(absPath);
            sizeBytes = stat.size;
          } catch {
            sizeBytes = 0;
          }

          const extension = path.extname(entry.name).toLowerCase();
          let isText = isTextFile(extension, entry.name);
          let content = "";
          let numLines = isText && sizeBytes > MAX_READ_BYTES ? -1 : 0;
          let tokens: number | undefined = undefined;

          if (isText && sizeBytes <= MAX_READ_BYTES) {
            try {
              content = await fsp.readFile(absPath, "utf8");
              numLines = content.length === 0 ? 0 : content.split(/\r?\n/).length;
              // Use byte estimation for larger files during scan (js-tiktoken is slow on large files)
              if (sizeBytes <= MAX_SCAN_TOKEN_BYTES) {
                tokens = countTokens(content);
              } else {
                // Byte-based estimation: ~4 bytes per token
                tokens = Math.ceil(sizeBytes / 4);
              }
            } catch {
              isText = false;
              content = "";
              numLines = 0;
              tokens = undefined;
            }
          }
          // Do not set isText = false for large files; they will be lazy-loaded if selected.

          const node: FileNode = {
            path: absPath,
            relPath,
            name: entry.name,
            isDirectory: false,
            sizeBytes,
            depth: depth + 1,
            extension,
            isText,
            category: getFileCategory(extension),
            numLines,
            tokens,
            children: undefined
          };

          flatFiles.push(node);
          processed++;
          onProgress?.({ processedFiles: processed, currentPath: relPath });
          return node;
        }
        return null;
      });
    });

    const results = await Promise.all(childrenPromises);
    parent.children = results.filter((n): n is FileNode => n !== null);
  }

  const ignoreRules: IgnoreRule[] = [{ baseRel: "", matcher: defaultIgnore }];
  await walk(resolvedRoot, root, "", 0, ignoreRules);

  const sortRecursive = (n: FileNode) => {
    if (n.children) {
      n.children.sort((a, b) => {
        if (a.isDirectory === b.isDirectory) {
          return a.name.localeCompare(b.name);
        }
        return a.isDirectory ? -1 : 1;
      });
      n.children.forEach(sortRecursive);
    }
  };
  sortRecursive(root);

  flatFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));

  return { root, flatFiles };
}

/* ---------- Minification & transformation ---------- */

function stripCommentsGeneric(content: string): string {
  let out = "";
  let i = 0;
  const len = content.length;
  let inString: string | null = null; // " ' or `
  let inLineComment = false;
  let inBlockComment = false;

  while (i < len) {
    const c = content[i];
    const next = i + 1 < len ? content[i + 1] : "";

    if (inLineComment) {
      if (c === "\n") {
        inLineComment = false;
        out += c;
      }
      i++;
    } else if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
      } else {
        i++;
      }
    } else if (inString) {
      out += c;
      if (c === "\\" && i + 1 < len) {
        out += content[i + 1];
        i += 2;
      } else {
        if (c === inString) inString = null;
        i++;
      }
    } else {
      // Not in comment or string
      const prev = i > 0 ? content[i - 1] : "";
      if (c === "/" && next === "/" && prev !== "\\") {
        inLineComment = true;
        i += 2;
      } else if (c === "/" && next === "*" && prev !== "\\") {
        inBlockComment = true;
        i += 2;
      } else {
        out += c;
        if (c === '"' || c === "'" || c === "`") {
          inString = c;
        }
        i++;
      }
    }
  }
  return out;
}

function stripHashCommentsConservative(content: string): string {
  const lines = content.split(/\r?\n/);
  const outLines: string[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx] ?? "";
    if (lineIdx === 0 && line.startsWith("#!")) {
      outLines.push(line);
      continue;
    }

    let out = "";
    let inSingle = false;
    let inDouble = false;
    let escaped = false;

    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (escaped) {
        out += c;
        escaped = false;
        continue;
      }
      if (c === "\\") {
        out += c;
        escaped = true;
        continue;
      }

      if (!inDouble && c === "'") {
        inSingle = !inSingle;
        out += c;
        continue;
      }
      if (!inSingle && c === "\"") {
        inDouble = !inDouble;
        out += c;
        continue;
      }

      if (!inSingle && !inDouble && c === "#") {
        // Treat as comment only when it begins a comment token (conservative).
        const prev = i > 0 ? line[i - 1]! : "";
        if (i === 0 || /\s/.test(prev)) break;
      }

      out += c;
    }

    outLines.push(out.trimEnd());
  }

  return outLines.join("\n");
}

function stripHashCommentsPython(content: string): string {
  const lines = content.split(/\r?\n/);
  const outLines: string[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx] ?? "";
    if (lineIdx === 0 && line.startsWith("#!")) {
      outLines.push(line);
      continue;
    }

    let out = "";
    let inSingle = false;
    let inDouble = false;
    let escaped = false;

    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (escaped) {
        out += c;
        escaped = false;
        continue;
      }
      if (c === "\\") {
        out += c;
        escaped = true;
        continue;
      }

      if (!inDouble && c === "'") {
        inSingle = !inSingle;
        out += c;
        continue;
      }
      if (!inSingle && c === "\"") {
        inDouble = !inDouble;
        out += c;
        continue;
      }

      if (!inSingle && !inDouble && c === "#") {
        break;
      }

      out += c;
    }

    outLines.push(out.trimEnd());
  }

  return outLines.join("\n");
}

function stripHtmlComments(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, "");
}

async function transformFileContent(
  file: FileNode,
  options: { removeComments: boolean; minify: boolean }
): Promise<string> {
  if (!file.isText) return "";
  let text = await fsp.readFile(file.path, "utf8").catch(() => "");
  const ext = file.extension.toLowerCase();

  const isJsLike =
    ext === ".js" ||
    ext === ".jsx" ||
    ext === ".ts" ||
    ext === ".tsx" ||
    ext === ".mjs" ||
    ext === ".cjs";

  if (options.removeComments) {
    if (isJsLike) {
      // If we're also minifying, rely on Bun/Terser to remove comments safely.
      if (!options.minify) {
        text = stripCommentsGeneric(text);
      }
    } else if (
      ext === ".java" ||
      ext === ".go" ||
      ext === ".rs" ||
      ext === ".php" ||
      ext === ".c" ||
      ext === ".cpp" ||
      ext === ".h" ||
      ext === ".hpp"
    ) {
      text = stripCommentsGeneric(text);
    } else if (
      ext === ".py" ||
      ext === ".rb" ||
      ext === ".sh" ||
      ext === ".bash"
    ) {
      text = ext === ".py" ? stripHashCommentsPython(text) : stripHashCommentsConservative(text);
    } else if (
      ext === ".md" ||
      ext === ".mdx" ||
      ext === ".markdown" ||
      ext === ".html" ||
      ext === ".htm"
    ) {
      text = stripHtmlComments(text);
    }
  }

  if (options.minify) {
    if (
      ext === ".js" ||
      ext === ".jsx" ||
      ext === ".ts" ||
      ext === ".tsx" ||
      ext === ".mjs" ||
      ext === ".cjs"
    ) {
      const loader =
        ext === ".tsx"
          ? "tsx"
          : ext === ".ts"
          ? "ts"
          : ext === ".jsx"
          ? "jsx"
          : "js";

      if (typeof Bun !== "undefined" && Bun?.transform) {
        try {
          const res = await Bun.transform(text, { loader, minify: true });
          text = res.code;
          return text;
        } catch {
          // fallback to Terser below
        }
      }

      try {
        const result = await terserMinify(text, {
          ecma: 2020,
          module:
            ext === ".mjs" ||
            ext === ".js" ||
            ext === ".ts" ||
            ext === ".tsx",
          compress: true,
          mangle: true,
          format: { comments: false }
        });
        if (result.code) text = result.code;
      } catch {
        // fallback to raw
      }
    } else if (
      ext === ".css" ||
      ext === ".scss" ||
      ext === ".sass" ||
      ext === ".less"
    ) {
      try {
        const result = csso.minify(text);
        text = result.css;
      } catch {
        // ignore
      }
    } else if (ext === ".html" || ext === ".htm") {
      try {
        text = await htmlMinify(text, {
          collapseWhitespace: true,
          removeComments: true,
          removeRedundantAttributes: true,
          removeEmptyAttributes: true,
          minifyCSS: true,
          minifyJS: true
        });
      } catch {
        // ignore
      }
    } else if (ext === ".json") {
      try {
        text = JSON.stringify(JSON.parse(text));
      } catch {
        // ignore
      }
    } else if (
      ext === ".md" ||
      ext === ".mdx" ||
      ext === ".markdown"
    ) {
      text = stripHtmlComments(text)
        .split(/\r?\n/)
        .map(l => l.trimEnd())
        .join("\n");
    } else {
      text = text
        .split(/\r?\n/)
        .map(l => l.trimEnd())
        .join("\n");
    }
  }

  return text;
}

/* ---------- Project tree section ---------- */

function buildProjectTreeLines(
  root: FileNode | null,
  selected: Set<string>
): string[] {
  if (!root) return [];
  const lines: string[] = [];

  const cache = new Map<string, boolean>();
  const hasSelected = (node: FileNode): boolean => {
    if (cache.has(node.path)) return cache.get(node.path)!;
    let has =
      !node.isDirectory && selected.has(node.path);
    if (node.children) {
      for (const child of node.children) {
        if (hasSelected(child)) {
          has = true;
          break;
        }
      }
    }
    cache.set(node.path, has);
    return has;
  };

  if (!hasSelected(root)) {
    return [];
  }

  lines.push("<project_structure>");

  const printNode = (node: FileNode, prefix: string, isLast: boolean) => {
    if (!hasSelected(node)) return;
    const isRoot = node.relPath === ".";
    const connector = isRoot ? "" : (isLast ? "└── " : "├── ");
    const childPrefix = isRoot ? "" : (prefix + (isLast ? "    " : "│   "));

    if (node.isDirectory) {
      const label = isRoot ? node.name + "/" : node.name + "/";
      lines.push(`${prefix}${connector}${label}`);
    } else {
      // File with size and line count like the HTML version
      const sizeKb = (node.sizeBytes / 1024).toFixed(2);
      const linesLabel = node.numLines >= 0 ? node.numLines.toLocaleString() : "?";
      const fileInfo = `(Size: ${sizeKb}kb; Lines: ${linesLabel})`;
      lines.push(`${prefix}${connector}${node.name} ${fileInfo}`);
    }

    if (node.children && node.children.length) {
      const selectedChildren = node.children.filter(c => hasSelected(c));
      selectedChildren.forEach((child, idx) => {
        const childIsLast = idx === selectedChildren.length - 1;
        printNode(child, childPrefix, childIsLast);
      });
    }
  };

  printNode(root, "", true);
  lines.push("</project_structure>");

  return lines;
}

/* ---------- Combined output & preview snippet ---------- */

async function buildCombinedOutput(
  root: FileNode | null,
  flatFiles: FileNode[],
  selected: Set<string>,
  options: CombineOptions,
  onProgress?: (info: { index: number; total: number; relPath: string }) => void
): Promise<CombinedResult> {
  const selectedFiles = flatFiles
    .filter(f => !f.isDirectory && f.isText && selected.has(f.path))
    .sort((a, b) => a.relPath.localeCompare(b.relPath));

  const bodyLines: string[] = [];
  let bodyBytes = 0;
  let bodyTokens = 0;
  let bodyLinesCount = 0;

  const pushLine = (line: string) => {
    bodyLines.push(line);
    const len = Buffer.byteLength(line, "utf8");
    bodyBytes += len + 1; // +1 for newline
    bodyTokens += countTokens(line);
    // Rough line count, sufficient for stats
    let lines = 1;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '\n') lines++;
    }
    bodyLinesCount += lines;
  };

  if (options.includePreamble && options.preambleText.trim()) {
    pushLine("<preamble>");
    pushLine(options.preambleText.trim());
    pushLine("</preamble>");
    pushLine("");
  }

  if (options.includeGoal && options.goalText.trim()) {
    pushLine("<goal>");
    pushLine(options.goalText.trim());
    pushLine("</goal>");
    pushLine("");
  }

  if (root && selectedFiles.length > 0) {
    const treeLines = buildProjectTreeLines(root, selected);
    if (treeLines.length > 0) {
      for (const line of treeLines) pushLine(line);
      pushLine("");
    }
  }

  pushLine("<files>");

  for (let idx = 0; idx < selectedFiles.length; idx++) {
    const file = selectedFiles[idx]!;
    onProgress?.({ index: idx + 1, total: selectedFiles.length, relPath: file.relPath });
    const transformed = await transformFileContent(file, {
      removeComments: options.removeComments,
      minify: options.minify
    });
    const content = transformed.trimEnd();
    const numLines =
      content.length === 0 ? 0 : content.split(/\r?\n/).length;
    const lang = languageFromExtension(file.extension);
    const fileTokens = countTokens(content);
    const contentBytes = Buffer.byteLength(content, "utf8");

    pushLine(`<file path="${file.relPath}" lang="${lang}" lines="${numLines}" bytes="${contentBytes}" tokens="${fileTokens}">`);
    pushLine(content);
    pushLine("</file>");
    pushLine("");
  }

  pushLine("</files>");

  // Adjust counters for the final join which adds N-1 newlines, not N
  if (bodyBytes > 0) bodyBytes -= 1; 

  const headerLines = [
    "===== SOURCE2PROMPT v2 =====",
    "",
    "[meta]",
    `project_root: ${root?.path ?? "unknown"}`,
    `generated_at: ${new Date().toISOString()}`,
    `files_selected: ${selectedFiles.length}`,
    `body_bytes: ${bodyBytes}`,
    `body_lines: ${bodyLinesCount}`,
    `body_tokens_est: ${bodyTokens}`,
    `options: include_preamble=${options.includePreamble}, include_goal=${options.includeGoal}, remove_comments=${options.removeComments}, minify=${options.minify}`,
    "[/meta]",
    ""
  ];

  const text = [...headerLines, ...bodyLines].join("\n");
  const bytes = Buffer.byteLength(text, "utf8");
  const tokens = countTokens(text);
  const lines = text.split(/\r?\n/).length;

  return { text, bytes, tokens, lines };
}

async function buildPromptPreviewSnippet(
  root: FileNode | null,
  flatFiles: FileNode[],
  selected: Set<string>,
  options: CombineOptions
): Promise<string> {
  const selectedFiles = flatFiles
    .filter(f => !f.isDirectory && f.isText && selected.has(f.path))
    .sort((a, b) => a.relPath.localeCompare(b.relPath));

  const hasPreamble = options.includePreamble && options.preambleText.trim();
  const hasGoal = options.includeGoal && options.goalText.trim();
  if (!selectedFiles.length && !hasPreamble && !hasGoal) {
    return "// Adjust preamble/goal and select some files to see a live sample of the combined prompt.";
  }

  const lines: string[] = [];

  if (options.includePreamble && options.preambleText.trim()) {
    const pre = options.preambleText.trim();
    lines.push("<preamble>");
    lines.push(pre.length > 600 ? pre.slice(0, 600) + " ..." : pre);
    lines.push("</preamble>", "");
  }

  if (options.includeGoal && options.goalText.trim()) {
    const g = options.goalText.trim();
    lines.push("<goal>");
    lines.push(g.length > 600 ? g.slice(0, 600) + " ..." : g);
    lines.push("</goal>", "");
  }

  if (root && selectedFiles.length > 0) {
    const treeLines = buildProjectTreeLines(root, selected);
    if (treeLines.length > 0) {
      lines.push(...treeLines, "");
    }
  }

  lines.push("<files_preview>");

  const previewFiles = selectedFiles.slice(0, 3);
  for (const f of previewFiles) {
    let snippet = "";
    if (f.sizeBytes > MAX_READ_BYTES) {
      const headBytes = Math.min(64 * 1024, f.sizeBytes);
      try {
        const head = await readFileHeadUtf8(f.path, headBytes);
        const prefix = `// Large file (${formatBytes(f.sizeBytes)}). Sample shows first ${formatBytes(
          headBytes
        )}.\n\n`;
        snippet = prefix + head;
      } catch {
        snippet = "// Error reading file";
      }
    } else {
      const transformed = await transformFileContent(f, {
        removeComments: options.removeComments,
        minify: options.minify
      });
      snippet = transformed || "";
    }
    const maxLines = 40;
    const maxChars = 1200;
    const parts = snippet.split(/\r?\n/).slice(0, maxLines);
    snippet = parts.join("\n");
    if (snippet.length > maxChars) {
      snippet = snippet.slice(0, maxChars) + "\n...";
    }
    lines.push(
      `--- file: ${f.relPath} (${f.extension || "txt"}) ---`,
      snippet,
      ""
    );
  }

  if (selectedFiles.length > previewFiles.length) {
    lines.push(
      `... + ${selectedFiles.length - previewFiles.length} more file(s) in full prompt.`
    );
  }

  lines.push("</files_preview>");

  const text = lines.join("\n");
  return text.length > 4000 ? text.slice(0, 4000) + "\n..." : text;
}

/* ---------- Presets & clipboard ---------- */

function validatePreset(p: any): p is Preset {
  return (
    typeof p === "object" &&
    p !== null &&
    typeof p.name === "string" &&
    typeof p.rootDir === "string" &&
    Array.isArray(p.selectedRelPaths)
  );
}

async function loadPresets(): Promise<Preset[]> {
  try {
    const raw = await fsp.readFile(PRESET_FILE, "utf8");
    const parsed = JSON.parse(raw);
    let candidates: any[] = [];
    if (Array.isArray(parsed)) {
      candidates = parsed;
    } else if (parsed && Array.isArray(parsed.presets)) {
      candidates = parsed.presets;
    }
    return candidates.filter(validatePreset);
  } catch {
    return [];
  }
}

async function savePresets(presets: Preset[]): Promise<boolean> {
  try {
    await fsp.writeFile(PRESET_FILE, JSON.stringify(presets, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  const platform = process.platform;
  // Encode text once
  const encoder = new TextEncoder();
  const data = encoder.encode(text);

  try {
    if (platform === "darwin") {
      const proc = Bun.spawn(["pbcopy"], {
        stdin: "pipe",
        stdout: "ignore",
        stderr: "ignore",
      });
      const writer = proc.stdin.getWriter();
      await writer.write(data);
      await writer.close();
      await proc.exited;
      return proc.exitCode === 0;
    }

    if (platform === "linux") {
      // Try common Linux clipboard utilities in order
      const candidates = [
        ["wl-copy"],
        ["xclip", "-selection", "clipboard"],
        ["xsel", "--clipboard", "--input"],
        ["clip.exe"],
      ];

      for (const cmd of candidates) {
        try {
          const proc = Bun.spawn(cmd, {
            stdin: "pipe",
            stdout: "ignore",
            stderr: "ignore",
          });
          const writer = proc.stdin.getWriter();
          await writer.write(data);
          await writer.close();
          await proc.exited;
          if (proc.exitCode === 0) return true;
        } catch {
          // Continue to next candidate
        }
      }
      return false;
    }

    if (platform === "win32") {
      const proc = Bun.spawn(["clip.exe"], {
        stdin: "pipe",
        stdout: "ignore",
        stderr: "ignore",
      });
      const writer = proc.stdin.getWriter();
      await writer.write(data);
      await writer.close();
      await proc.exited;
      return proc.exitCode === 0;
    }
    
    return false;
  } catch {
    return false;
  }
}

function getPreferredEditor(): string {
  const editor = process.env.VISUAL || process.env.EDITOR;
  return editor && editor.trim() ? editor.trim() : "vi";
}

function quoteForShell(arg: string): string {
  return `"${arg.replace(/"/g, "\\\"")}"`;
}

async function editTextInExternalEditor(
  initialText: string,
  filenameHint: string
): Promise<{ ok: true; text: string; changed: boolean } | { ok: false; error: string }> {
  const editor = getPreferredEditor();
  const safeHint = filenameHint.replace(/[^a-z0-9_-]+/gi, "_");
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "s2p-"));
  const tmpFile = path.join(tmpDir, `${safeHint}.txt`);

  try {
    await fsp.writeFile(tmpFile, initialText, "utf8");

    const cmd = `${editor} ${quoteForShell(tmpFile)}`;
    const res = spawnSync(cmd, { stdio: "inherit", shell: true });
    if (res.error) return { ok: false, error: res.error.message };

    const updated = await fsp.readFile(tmpFile, "utf8").catch(() => initialText);
    return { ok: true, text: updated, changed: updated !== initialText };
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ---------- Quick-select helpers ---------- */

const QUICK_SELECT_LABELS: Record<QuickSelectKey, string> = {
  allText: "Toggled all text files",
  javascript: "Toggled all JavaScript files",
  react: "Toggled all React components",
  typescript: "Toggled all TypeScript files",
  json: "Toggled all JSON files",
  markdown: "Toggled all Markdown files",
  python: "Toggled all Python files",
  go: "Toggled all Go files",
  java: "Toggled all Java files",
  ruby: "Toggled all Ruby files",
  php: "Toggled all PHP files",
  rust: "Toggled all Rust files"
};

function filterFilesByQuickSelect(
  files: FileNode[],
  key: QuickSelectKey
): FileNode[] {
  switch (key) {
    case "allText":
      return files.filter(f => !f.isDirectory && f.isText);
    case "javascript":
      return files.filter(f => f.category === "javascript");
    case "react":
      return files.filter(f => f.category === "react");
    case "typescript":
      return files.filter(f => f.category === "typescript");
    case "json":
      return files.filter(f => f.category === "json");
    case "markdown":
      return files.filter(f => f.category === "markdown");
    case "python":
      return files.filter(f => f.category === "python");
    case "go":
      return files.filter(f => f.category === "go");
    case "java":
      return files.filter(f => f.category === "java");
    case "ruby":
      return files.filter(f => f.category === "ruby");
    case "php":
      return files.filter(f => f.category === "php");
    case "rust":
      return files.filter(f => f.category === "rust");
    default:
      return [];
  }
}

/* ---------- Small debounce ---------- */

function debounce<F extends (...args: any[]) => void>(
  fn: F,
  delay: number
): (...args: Parameters<F>) => void {
  let timer: NodeJS.Timeout | null = null;
  return (...args: Parameters<F>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delay);
  };
}

/* ---------- Main App ---------- */

const DEFAULT_PREAMBLE =
  "The following are the complete project code files for my app. Below is a comprehensive collection of the project's source files.";

interface AppProps {
  initialRootDir?: string;
}

const App: React.FC<AppProps> = ({ initialRootDir }) => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { setRawMode, isRawModeSupported } = useStdin();
  const [rootDir, setRootDir] = useState(
    initialRootDir
      ? path.resolve(expandTilde(initialRootDir))
      : path.resolve(process.cwd())
  );

  const [rootNode, setRootNode] = useState<FileNode | null>(null);
  const [flatFiles, setFlatFiles] = useState<FileNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [scanError, setScanError] = useState<string | null>(null);
  const [status, setStatus] = useState("Scanning project...");
  const [progressText, setProgressText] = useState<string | null>(null);

  const [activePane, setActivePane] = useState<Pane>("explorer");
  const [configTab, setConfigTab] = useState<ConfigTab>("inputs");
  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [filter, setFilter] = useState("");
  const [focusField, setFocusField] = useState<FocusField>("none");

  const [includePreamble, setIncludePreamble] = useState(true);
  const [preamble, setPreamble] = useState(DEFAULT_PREAMBLE);
  const [includeGoal, setIncludeGoal] = useState(false);
  const [goal, setGoal] = useState("");
  const [minify, setMinify] = useState(false);
  const [removeComments, setRemoveComments] = useState(false);

  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [selectedPresetIndex, setSelectedPresetIndex] = useState(0);

  const [statsTokens, setStatsTokens] = useState(0);
  const [statsSizeBytes, setStatsSizeBytes] = useState(0);
  const [statsFileCount, setStatsFileCount] = useState(0);
  const [statsLineCount, setStatsLineCount] = useState(0);
  const tokenEstimateCacheRef = useRef<Map<string, number>>(new Map());
  const tokenEstimateRunIdRef = useRef(0);
  const [previewContent, setPreviewContent] = useState("");
  const [previewLang, setPreviewLang] = useState("txt");
  const [previewScrollOffset, setPreviewScrollOffset] = useState(0);

  const [mode, setMode] = useState<Mode>("main");
  const [combined, setCombined] = useState<CombinedResult | null>(null);
  const [exportPath, setExportPath] = useState("combined-prompt.txt");

  const [promptPreview, setPromptPreview] = useState("");
  const [promptSampleCollapsed, setPromptSampleCollapsed] = useState(false);
  const [promptSampleScrollOffset, setPromptSampleScrollOffset] = useState(0);

  // UI state for modals and exit confirmation
  const [showHelp, setShowHelp] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);

  // Scroll offset for combined view
  const [combinedScrollOffset, setCombinedScrollOffset] = useState(0);

  // Scan ID to handle race conditions
  const [scanId, setScanId] = useState(0);

  const rows = stdout.rows ?? 30;
  const cols = stdout.columns ?? 120;

  const promptSampleHeightExpanded = Math.min(10, Math.max(6, Math.floor(rows * 0.22)));
  const promptSampleHeight = promptSampleCollapsed ? 3 : promptSampleHeightExpanded;
  const promptSampleCodeHeight = Math.max(1, promptSampleHeight - 3);

  const chromeHeight = 3 + 2 + 2 + promptSampleHeight + 6;
  const listHeight = Math.max(6, rows - chromeHeight);
  const previewCodeHeight = Math.max(5, listHeight - 6);

  const previewLines = useMemo(
    () => (previewContent ? previewContent.split(/\r?\n/) : []),
    [previewContent]
  );
  const previewMaxScroll = Math.max(0, previewLines.length - previewCodeHeight);
  const previewWindowText = useMemo(
    () => previewLines.slice(previewScrollOffset, previewScrollOffset + previewCodeHeight).join("\n"),
    [previewLines, previewScrollOffset, previewCodeHeight]
  );

  useEffect(() => {
    if (previewScrollOffset > previewMaxScroll) {
      setPreviewScrollOffset(previewMaxScroll);
    }
  }, [previewScrollOffset, previewMaxScroll]);

  const promptPreviewLines = useMemo(
    () => (promptPreview ? promptPreview.split(/\r?\n/) : []),
    [promptPreview]
  );
  const promptSampleMaxScroll = promptSampleCollapsed
    ? 0
    : Math.max(0, promptPreviewLines.length - promptSampleCodeHeight);

  useEffect(() => {
    if (promptSampleScrollOffset > promptSampleMaxScroll) {
      setPromptSampleScrollOffset(promptSampleMaxScroll);
    }
  }, [promptSampleScrollOffset, promptSampleMaxScroll]);

  const handleScan = async (
    dir: string
  ): Promise<{ root: FileNode | null; files: FileNode[] }> => {
    const resolved = path.resolve(expandTilde(dir));
    setRootDir(resolved);
    
    // Increment scan ID to invalidate previous scans
    const currentScanId = scanId + 1;
    setScanId(currentScanId);

    setLoading(true);
    setScanError(null);
    setStatus("Scanning project...");
    setProgressText(null);
    setRootNode(null);
    setFlatFiles([]);
    setExpanded(new Set());
    setSelected(new Set());
    setCursor(0);
    setScrollOffset(0);
    tokenEstimateCacheRef.current.clear();

    try {
      const result = await scanProject(resolved, info => {
        // Only update progress if this is the active scan
        setScanId(prev => {
           if (prev === currentScanId) {
             setProgressText(
                info.currentPath
                  ? `Scanning ${info.currentPath} (${info.processedFiles} files)...`
                  : `Scanning... (${info.processedFiles} files)`
              );
           }
           return prev;
        });
      });
      
      // Check if this scan is still the latest
      let isLatest = false;
      setScanId(prev => {
        isLatest = (prev === currentScanId);
        return prev;
      });

      if (!isLatest) {
        return { root: null, files: [] };
      }

      setRootNode(result.root);
      setFlatFiles(result.flatFiles);
      setExpanded(new Set([result.root.path]));
      setStatus(`Scanned ${result.flatFiles.length} files from ${resolved}`);
      setLoading(false);
      setProgressText(null);
      return { root: result.root, files: result.flatFiles };
    } catch (err: any) {
      // Check if this scan is still the latest
      let isLatest = false;
      setScanId(prev => {
        isLatest = (prev === currentScanId);
        return prev;
      });
      
      if (isLatest) {
        setScanError(err?.message || String(err));
        setStatus("Scan error");
        setLoading(false);
        setProgressText(null);
      }
      return { root: null, files: [] };
    }
  };

  useEffect(() => {
    (async () => {
      const loaded = await loadPresets();
      setPresets(loaded);
      await handleScan(rootDir);
      setStatus("Ready");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleNodes = useMemo(() => {
    if (!rootNode) return [];
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      return flatFiles.filter(f =>
        f.relPath.toLowerCase().includes(q)
      );
    }

    const out: FileNode[] = [];
    const traverse = (n: FileNode) => {
      out.push(n);
      if (n.isDirectory && expanded.has(n.path) && n.children) {
        for (const child of n.children) traverse(child);
      }
    };
    traverse(rootNode);
    return out;
  }, [rootNode, flatFiles, expanded, filter]);

  useEffect(() => {
    if (cursor >= visibleNodes.length) {
      setCursor(visibleNodes.length > 0 ? visibleNodes.length - 1 : 0);
      setScrollOffset(0);
    }
  }, [visibleNodes.length, cursor]);

  useEffect(() => {
    if (cursor < scrollOffset) {
      setScrollOffset(cursor);
    } else if (cursor >= scrollOffset + listHeight) {
      setScrollOffset(cursor - listHeight + 1);
    }
  }, [cursor, scrollOffset, listHeight]);

  const debouncedStats = useMemo(
    () =>
      debounce(
        (
          files: FileNode[],
          selectedSet: Set<string>
        ) => {
          const selectedFiles = files.filter(
            f => !f.isDirectory && f.isText && selectedSet.has(f.path)
          );
          const size = selectedFiles.reduce(
            (acc, f) => acc + f.sizeBytes,
            0
          );
          const lines = selectedFiles.reduce((acc, f) => acc + Math.max(0, f.numLines), 0);

          setStatsFileCount(selectedFiles.length);
          setStatsSizeBytes(size);
          setStatsLineCount(lines);
        },
        200
      ),
    []
  );

  useEffect(() => {
    debouncedStats(flatFiles, selected);
  }, [flatFiles, selected, debouncedStats]);

  useEffect(() => {
    const runId = ++tokenEstimateRunIdRef.current;
    let cancelled = false;

    const timer = setTimeout(() => {
      (async () => {
        const selectedFiles = flatFiles.filter(
          f => !f.isDirectory && f.isText && selected.has(f.path)
        );

        const baseTokens =
          (includePreamble ? countTokens(preamble) : 0) +
          (includeGoal ? countTokens(goal) : 0);

        const needsTransform = removeComments || minify;
        const cache = tokenEstimateCacheRef.current;

        let totalTokens = baseTokens;
        const toCompute: FileNode[] = [];
        const fallbackTokensByKey = new Map<string, number>();

        for (const f of selectedFiles) {
          if (!needsTransform || f.sizeBytes > MAX_READ_BYTES) {
            if (f.tokens !== undefined) totalTokens += f.tokens;
            else totalTokens += Math.ceil(f.sizeBytes / 4);
            continue;
          }

          const key = `${f.path}|rc=${removeComments ? 1 : 0}|m=${minify ? 1 : 0}`;
          const cached = cache.get(key);
          if (cached !== undefined) {
            totalTokens += cached;
          } else {
            // Conservative fallback until we compute transformed tokens.
            const fallback = f.tokens !== undefined ? f.tokens : Math.ceil(f.sizeBytes / 4);
            totalTokens += fallback;
            fallbackTokensByKey.set(key, fallback);
            toCompute.push(f);
          }
        }

        if (cancelled || runId !== tokenEstimateRunIdRef.current) return;
        setStatsTokens(totalTokens);

        if (!needsTransform || toCompute.length === 0) return;

        for (let i = 0; i < toCompute.length; i++) {
          const f = toCompute[i];
          if (cancelled || runId !== tokenEstimateRunIdRef.current) return;

          const key = `${f.path}|rc=${removeComments ? 1 : 0}|m=${minify ? 1 : 0}`;
          const fallback = fallbackTokensByKey.get(key) ?? 0;
          const existingCached = cache.get(key);
          if (existingCached !== undefined) {
            totalTokens += existingCached - fallback;
            fallbackTokensByKey.delete(key);
            continue;
          }

          try {
            const transformed = await transformFileContent(f, {
              removeComments,
              minify
            });
            const nextTokens = countTokens(transformed);
            cache.set(key, nextTokens);
            totalTokens += nextTokens - fallback;
            fallbackTokensByKey.delete(key);
          } catch {
            // Keep fallback (raw/approx) if transform fails
          }

          // Yield occasionally to keep the UI responsive on large selections.
          if (i % 5 === 4 && !cancelled && runId === tokenEstimateRunIdRef.current) {
            setStatsTokens(totalTokens);
          }
          if (i % 3 === 2) await new Promise(r => setTimeout(r, 0));
        }

        if (cancelled || runId !== tokenEstimateRunIdRef.current) return;
        setStatsTokens(totalTokens);
      })().catch(() => {
        if (!cancelled && runId === tokenEstimateRunIdRef.current) {
          // Fall back to a safe approximation if the background computation fails
          const selectedFiles = flatFiles.filter(
            f => !f.isDirectory && f.isText && selected.has(f.path)
          );
          const baseTokens =
            (includePreamble ? countTokens(preamble) : 0) +
            (includeGoal ? countTokens(goal) : 0);
          const approxTokens = selectedFiles.reduce((acc, f) => {
            if (f.tokens !== undefined) return acc + f.tokens;
            return acc + Math.ceil(f.sizeBytes / 4);
          }, baseTokens);
          setStatsTokens(approxTokens);
        }
      });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    flatFiles,
    selected,
    includePreamble,
    preamble,
    includeGoal,
    goal,
    removeComments,
    minify
  ]);

  useEffect(() => {
    const node = visibleNodes[cursor];
    let cancelled = false;
    if (!node || node.isDirectory || !node.isText) {
      setPreviewContent("");
      setPreviewLang("txt");
      setPreviewScrollOffset(0);
      return () => {
        cancelled = true;
      };
    }
    const lang = languageFromExtension(node.extension);
    setPreviewLang(lang);
    setPreviewScrollOffset(0);

    if (node.isText) {
      if (node.sizeBytes > MAX_READ_BYTES) {
        const headBytes = Math.min(64 * 1024, node.sizeBytes);
        setPreviewContent(
          `// Large file (${formatBytes(node.sizeBytes)}). Loading preview...`
        );
        readFileHeadUtf8(node.path, headBytes)
          .then(head => {
            if (cancelled) return;
            const prefix = `// Large file (${formatBytes(node.sizeBytes)}). Showing first ${formatBytes(
              headBytes
            )}.\n\n`;
            const combined = prefix + head;
            setPreviewContent(
              combined.length > MAX_PREVIEW_CHARS
                ? combined.slice(0, MAX_PREVIEW_CHARS) + "\n..."
                : combined
            );
          })
          .catch(() => {
            if (!cancelled) setPreviewContent("// Error reading file");
          });
      } else {
        setPreviewContent("// Loading preview...");
        fsp
          .readFile(node.path, "utf8")
          .then(content => {
            if (cancelled) return;
            setPreviewContent(
              content.length > MAX_PREVIEW_CHARS
                ? content.slice(0, MAX_PREVIEW_CHARS)
                : content
            );
          })
          .catch(() => {
            if (!cancelled) setPreviewContent("// Error reading file");
          });
      }
    }

    return () => {
      cancelled = true;
    };
  }, [visibleNodes, cursor]);

  useEffect(() => {
    if (!rootNode) {
      setPromptPreview("");
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      (async () => {
        const options: CombineOptions = {
          includePreamble,
          preambleText: preamble,
          includeGoal,
          goalText: goal,
          removeComments,
          minify
        };
        const snippet = await buildPromptPreviewSnippet(
          rootNode,
          flatFiles,
          selected,
          options
        );
        if (!cancelled) setPromptPreview(snippet);
      })().catch(err => {
        if (!cancelled) {
          setPromptPreview(
            "// Error building preview: " + (err?.message || String(err))
          );
        }
      });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rootNode, flatFiles, selected, includePreamble, preamble, includeGoal, goal, removeComments, minify]);

	    const toggleSelectNode = (node: FileNode) => {
	      if (node.isDirectory) {
	        const descendants: FileNode[] = [];
	        const collectDesc = (n: FileNode) => {
	          if (isSelectableTextNode(n)) descendants.push(n);
	          if (n.children) for (const c of n.children) collectDesc(c);
	        };
	        collectDesc(node);
	        if (descendants.length === 0) {
	          setStatus(`No selectable text files in "${node.relPath}".`);
	          return;
	        }
	        const newSel = new Set(selected);
	        const allSelected = descendants.every(d => newSel.has(d.path));
	        if (allSelected) {
	          for (const d of descendants) newSel.delete(d.path);
	        } else {
	          for (const d of descendants) newSel.add(d.path);
	        }
	        setSelected(newSel);
	        setStatus(
	          `${allSelected ? "Deselected" : "Selected"} ${descendants.length} files in "${node.relPath}"`
	        );
	        return;
	      }
	  
	      // It's a file
	      if (!node.isText) {
	        setStatus("File is binary and cannot be included.");
	        return;
	      }
	      if (!isSelectableTextNode(node)) {
	        setStatus(
	          `File too large to include (>${formatBytes(MAX_INCLUDE_BYTES)}): ${node.relPath}`
	        );
	        return;
	      }
	      const newSel = new Set(selected);
	      const wasSelected = newSel.has(node.path);
	      if (wasSelected) newSel.delete(node.path);
	      else newSel.add(node.path);
	      setSelected(newSel);
	  
	      if (!wasSelected && node.sizeBytes > MAX_READ_BYTES) {
	        setStatus(
	          `Selected large file (${formatBytes(node.sizeBytes)}). Generation may be slower.`
	        );
	      }
	    };
  const moveCursor = (delta: number) => {
    if (!visibleNodes.length) return;
    const maxIndex = visibleNodes.length - 1;
    let next = cursor + delta;
    if (next < 0) next = 0;
    if (next > maxIndex) next = maxIndex;
    setCursor(next);
  };

	  const toggleQuickSelect = (key: QuickSelectKey) => {
	    if (!flatFiles.length) return;
	    const matches = filterFilesByQuickSelect(flatFiles, key).filter(
	      f => isSelectableTextNode(f)
	    );
    if (!matches.length) {
      setStatus("No matching files for this quick select.");
      return;
    }

    const newSel = new Set(selected);
    const allSelected = matches.every(m => newSel.has(m.path));
    if (allSelected) {
      for (const m of matches) newSel.delete(m.path);
    } else {
      for (const m of matches) newSel.add(m.path);
    }
    setSelected(newSel);
    setStatus(QUICK_SELECT_LABELS[key]);
  };

	  const clearSelectionInFilter = () => {
	    if (!filter.trim()) return;
	    const q = filter.trim().toLowerCase();
	    const inFilter = flatFiles.filter(
	      f => isSelectableTextNode(f) && f.relPath.toLowerCase().includes(q)
	    );
	    if (!inFilter.length) return;
	    const newSel = new Set(selected);
	    for (const f of inFilter) newSel.delete(f.path);
    setSelected(newSel);
    setStatus("Cleared selections for files matching current filter.");
  };

  const updateSelectionInFilter = (action: "select" | "deselect") => {
    if (!filter.trim()) {
      setStatus("No active filter.");
      return;
	    }
	    const q = filter.trim().toLowerCase();
	    const matches = flatFiles.filter(
	      f => isSelectableTextNode(f) && f.relPath.toLowerCase().includes(q)
	    );
    if (!matches.length) {
      setStatus("No files match current filter.");
      return;
    }

    const newSel = new Set(selected);
    let changed = 0;
    for (const f of matches) {
      if (action === "select") {
        if (!newSel.has(f.path)) {
          newSel.add(f.path);
          changed++;
        }
      } else {
        if (newSel.delete(f.path)) changed++;
      }
    }
    setSelected(newSel);
    setStatus(
      `${action === "select" ? "Selected" : "Deselected"} ${changed} file(s) matching current filter.`
    );
  };

  const handleSavePreset = async () => {
    const name = presetName.trim();
    if (!name) {
      setStatus("Preset name cannot be empty.");
      return;
    }
    const selectedRelPaths = flatFiles
      .filter(f => selected.has(f.path))
      .map(f => f.relPath)
      .sort();

    const preset: Preset = {
      name,
      rootDir,
      includePreamble,
      includeGoal,
      preamble,
      goal,
      minify,
      removeComments,
      selectedRelPaths,
      createdAt: new Date().toISOString()
    };

    const filtered = presets.filter(p => p.name !== name);
    const next = [...filtered, preset].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    setPresets(next);
    if (await savePresets(next)) {
      setPresetName("");
      setStatus(`Saved preset "${name}".`);
    } else {
      setStatus(`Error saving preset "${name}" to disk.`);
    }
  };

  const handleLoadPreset = (index: number) => {
    const preset = presets[index];
    if (!preset) return;
    setIncludePreamble(preset.includePreamble);
    setIncludeGoal(preset.includeGoal);
    setPreamble(preset.preamble);
    setGoal(preset.goal);
    setMinify(preset.minify);
    setRemoveComments(preset.removeComments);
    setStatus(`Loading preset "${preset.name}"...`);

    const presetRootResolved = path.resolve(preset.rootDir);
    const currentRootResolved = path.resolve(rootDir);

    if (presetRootResolved !== currentRootResolved) {
      (async () => {
        const result = await handleScan(preset.rootDir);
        const files = result.files;
        const base = presetRootResolved;
        const newSel = new Set<string>();
        for (const rel of preset.selectedRelPaths) {
          const abs = path.join(base, rel);
          const node = files.find(f => f.path === abs);
          if (node && isSelectableTextNode(node)) newSel.add(abs);
        }
        setSelected(newSel);
        setStatus(
          `Loaded preset "${preset.name}" (${newSel.size} files selected).`
        );
      })();
    } else {
      const base = currentRootResolved;
      const newSel = new Set<string>();
      for (const rel of preset.selectedRelPaths) {
        const abs = path.join(base, rel);
        const node = flatFiles.find(f => f.path === abs);
        if (node && isSelectableTextNode(node)) newSel.add(abs);
      }
      setSelected(newSel);
      setStatus(
        `Loaded preset "${preset.name}" (${newSel.size} files selected).`
      );
    }
  };

  const handleDeletePreset = async (index: number) => {
    const preset = presets[index];
    if (!preset) return;
    const next = presets.filter((_, i) => i !== index);
    setPresets(next);
    if (await savePresets(next)) {
      setStatus(`Deleted preset "${preset.name}".`);
    } else {
      setStatus(`Deleted preset "${preset.name}" (memory only; save failed).`);
    }
    setSelectedPresetIndex(prev =>
      prev >= next.length ? Math.max(0, next.length - 1) : prev
    );
  };

  const handleGenerate = async () => {
    if (!rootNode) return;
    const selectedFiles = flatFiles.filter(
      f => !f.isDirectory && f.isText && selected.has(f.path)
    );
    if (!selectedFiles.length) {
      setStatus("No files selected. Select at least one text file first.");
      return;
    }

    setStatus("Generating combined prompt...");
    setMode("main");
    try {
      const options: CombineOptions = {
        includePreamble,
        preambleText: preamble,
        includeGoal,
        goalText: goal,
        removeComments,
        minify
      };
      let lastProgressAt = 0;
      let lastProgressIndex = 0;
      const result = await buildCombinedOutput(
        rootNode,
        flatFiles,
        selected,
        options,
        info => {
          const now = Date.now();
          if (info.index === lastProgressIndex) return;
          if (now - lastProgressAt < 120 && info.index !== info.total) return;
          lastProgressAt = now;
          lastProgressIndex = info.index;
          setStatus(`Generating (${info.index}/${info.total}): ${info.relPath}`);
        }
      );
      setCombined(result);
      setMode("combined");
      setStatus(
        `Generated: ${formatBytes(
          result.bytes
        )}, ~${result.tokens.toLocaleString()} tokens. Press Y to copy.`
      );
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  };

  const handleSaveCombinedToFile = async () => {
    if (!combined) return;
    const target = exportPath.trim() || "combined-prompt.txt";
    const resolved = path.isAbsolute(target)
      ? target
      : path.resolve(rootDir, target);
    try {
      await fsp.writeFile(resolved, combined.text, "utf8");
      setStatus(`Saved combined output to ${resolved}`);
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  };

  const openEditorForField = async (field: "preamble" | "goal") => {
    const currentText = field === "preamble" ? preamble : goal;
    const editor = getPreferredEditor();
    setConfirmExit(false);
    setFocusField("none");
    setStatus(`Opening ${field} in ${editor}...`);

    const clearScreen = () => {
      try {
        stdout.write("\x1b[2J\x1b[H");
      } catch {
        // ignore
      }
    };

    try {
      if (isRawModeSupported) {
        try {
          setRawMode(false);
        } catch {
          // ignore
        }
      }
      clearScreen();

      const result = await editTextInExternalEditor(currentText, `s2p-${field}`);
      clearScreen();

      if (!result.ok) {
        setStatus(`Editor error: ${result.error}`);
        return;
      }

      if (!result.changed) {
        setStatus(`No changes to ${field}.`);
        return;
      }

      if (field === "preamble") setPreamble(result.text);
      else setGoal(result.text);
      setStatus(`Updated ${field}.`);
    } finally {
      if (isRawModeSupported) {
        try {
          setRawMode(true);
        } catch {
          // ignore
        }
      }
    }
  };

  useInput((input, key) => {
    // Force quit with Ctrl+C
    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    // ? toggles help (reliable across terminals). When help is open, ? closes it.
    if (input === "?" && showHelp) {
      setShowHelp(false);
      setConfirmExit(false);
      return;
    }
    if (input === "?" && focusField === "none") {
      setShowHelp(prev => !prev);
      setConfirmExit(false);
      return;
    }

    // F1 toggles help modal (check for function key)
    if (input === "\x1bOP" || input === "\x1b[11~" || (key.meta && input === "1")) {
      setShowHelp(prev => !prev);
      setConfirmExit(false);
      return;
    }

    // If help modal is shown, Esc or F1 closes it
    if (showHelp) {
      if (key.escape || input === "?" || input === "\x1bOP" || input === "\x1b[11~") {
        setShowHelp(false);
      }
      return;
    }

    // Two-stage Escape to quit (in main mode, not in combined view)
    if (key.escape && mode === "main" && focusField === "none") {
      if (confirmExit) {
        exit();
        return;
      } else {
        setConfirmExit(true);
        // Note: Status bar already shows "Press Esc again to quit" via render ternary
        return;
      }
    }

    // Any non-Escape key cancels the exit confirmation
    if (confirmExit && !key.escape) {
      setConfirmExit(false);
      setStatus("Exit cancelled.");
      // Don't return - continue processing the key
    }

    if (key.ctrl && input.toLowerCase() === "e" && mode === "main") {
      if (focusField === "preamble" || focusField === "goal") {
        void openEditorForField(focusField);
        return;
      }
      if (activePane === "config" && configTab === "inputs") {
        void openEditorForField("preamble");
        return;
      }
    }

    if (mode === "combined") {
      if (focusField === "exportPath") {
        if (key.escape) {
          setFocusField("none");
          return;
        }
        if (key.return) {
          void handleSaveCombinedToFile();
          setFocusField("none");
          return;
        }
        return;
      }

      const lower = input.toLowerCase();
      if (key.escape || lower === "q") {
        setMode("main");
        setCombinedScrollOffset(0);
        setStatus("Back to main view.");
        return;
      }
      if (lower === "y") {
        if (combined) {
          void copyToClipboard(combined.text).then(ok =>
            setStatus(
              ok
                ? "Copied combined output to clipboard."
                : "Clipboard copy failed."
            )
          );
        }
        return;
      }
      if (lower === "w") {
        setFocusField("exportPath");
        return;
      }
      // Scrolling in combined view
      const viewHeight = Math.max(5, rows - 15);
      if (key.upArrow || input === "k") {
        setCombinedScrollOffset(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        if (combined) {
          const maxScroll = Math.max(0, combined.lines - viewHeight);
          setCombinedScrollOffset(prev => Math.min(maxScroll, prev + 1));
        }
        return;
      }
      if (key.pageUp || input === "b") {
        setCombinedScrollOffset(prev => Math.max(0, prev - viewHeight));
        return;
      }
      if (key.pageDown || input === " ") {
        if (combined) {
          const maxScroll = Math.max(0, combined.lines - viewHeight);
          setCombinedScrollOffset(prev => Math.min(maxScroll, prev + viewHeight));
        }
        return;
      }
      return;
    }

    if (focusField !== "none") {
      if (key.escape) {
        setFocusField("none");
        return;
      }
      if (key.return) {
        if (focusField === "rootDir") {
          void handleScan(rootDir);
          setFocusField("none");
          return;
        }
        if (focusField === "filter") {
          setFocusField("none");
          return;
        }
        if (focusField === "preamble") {
          setFocusField("none");
          return;
        }
        if (focusField === "goal") {
          setFocusField("none");
          return;
        }
        if (focusField === "presetName") {
          handleSavePreset();
          setFocusField("none");
          return;
        }
        if (focusField === "exportPath") {
          void handleSaveCombinedToFile();
          setFocusField("none");
          return;
        }
      }
      return;
    }

    if (key.ctrl && input.toLowerCase() === "g") {
      void handleGenerate();
      return;
    }

    if (key.tab) {
      const panes: Pane[] = ["explorer", "config", "preview", "sample"];
      const idx = panes.indexOf(activePane);
      const next = panes[(idx + 1) % panes.length];
      setActivePane(next);
      return;
    }

    if (input === "z") {
      const next = !promptSampleCollapsed;
      setPromptSampleCollapsed(next);
      setStatus(
        next
          ? "Prompt sample collapsed. Press z to expand."
          : "Prompt sample expanded. Press z to collapse."
      );
      return;
    }

    if (activePane === "explorer") {
      if (key.upArrow || input === "k") {
        moveCursor(-1);
        return;
      }
      if (key.downArrow || input === "j") {
        moveCursor(1);
        return;
      }

      const node = visibleNodes[cursor];

      if (key.leftArrow || input === "h") {
        if (node && node.isDirectory && expanded.has(node.path)) {
          const next = new Set(expanded);
          next.delete(node.path);
          setExpanded(next);
        }
        return;
      }

      if (key.rightArrow || input === "l") {
        if (node && node.isDirectory && !expanded.has(node.path)) {
          const next = new Set(expanded);
          next.add(node.path);
          setExpanded(next);
        }
        return;
      }

      if (input === " ") {
        if (node) toggleSelectNode(node);
        return;
      }

      if (key.return) {
        if (node) {
          if (node.isDirectory) {
            const next = new Set(expanded);
            if (next.has(node.path)) next.delete(node.path);
            else next.add(node.path);
            setExpanded(next);
          } else {
            toggleSelectNode(node);
          }
        }
        return;
      }

      if (input === "/" || input.toLowerCase() === "f") {
        setFocusField("filter");
        setActivePane("explorer");
        return;
      }

      if (input.toLowerCase() === "d") {
        setFocusField("rootDir");
        return;
      }

      if (input.toLowerCase() === "u") {
        clearSelectionInFilter();
        return;
      }

      if (input === "a") {
        updateSelectionInFilter("select");
        return;
      }

      if (input === "A") {
        updateSelectionInFilter("deselect");
        return;
      }

      if (input === "t") {
        toggleQuickSelect("allText");
        return;
      }
      if (input === "1") {
        toggleQuickSelect("javascript");
        return;
      }
      if (input === "2") {
        toggleQuickSelect("react");
        return;
      }
      if (input === "3") {
        toggleQuickSelect("typescript");
        return;
      }
      if (input === "4") {
        toggleQuickSelect("json");
        return;
      }
      if (input === "5") {
        toggleQuickSelect("markdown");
        return;
      }
      if (input === "6") {
        toggleQuickSelect("python");
        return;
      }
      if (input === "7") {
        toggleQuickSelect("go");
        return;
      }
      if (input === "8") {
        toggleQuickSelect("java");
        return;
      }
      if (input === "9") {
        toggleQuickSelect("ruby");
        return;
      }
      if (input === "0") {
        toggleQuickSelect("php");
        return;
      }
      if (input.toLowerCase() === "r") {
        toggleQuickSelect("rust");
        return;
      }
    }

    if (activePane === "config") {
      if (key.leftArrow || key.rightArrow) {
        setConfigTab(prev =>
          prev === "inputs"
            ? "presets"
            : prev === "presets"
            ? "options"
            : "inputs"
        );
        return;
      }

      if (configTab === "inputs") {
        if (input.toLowerCase() === "p") {
          setFocusField("preamble");
          return;
        }
        if (input.toLowerCase() === "g") {
          setFocusField("goal");
          return;
        }
      }

      if (configTab === "options") {
        if (input.toLowerCase() === "i") {
          setIncludePreamble(prev => !prev);
          return;
        }
        if (input.toLowerCase() === "o") {
          setIncludeGoal(prev => !prev);
          return;
        }
        if (input.toLowerCase() === "m") {
          setMinify(prev => !prev);
          return;
        }
        if (input.toLowerCase() === "x") {
          setRemoveComments(prev => !prev);
          return;
        }
      }

      if (configTab === "presets") {
        if (key.upArrow || input === "k") {
          setSelectedPresetIndex(prev =>
            prev <= 0 ? 0 : prev - 1
          );
          return;
        }
        if (key.downArrow || input === "j") {
          setSelectedPresetIndex(prev =>
            prev >= presets.length - 1
              ? Math.max(0, presets.length - 1)
              : prev + 1
          );
          return;
        }
        if (input.toLowerCase() === "l") {
          if (presets.length) handleLoadPreset(selectedPresetIndex);
          return;
        }
        if (input.toLowerCase() === "d") {
          if (presets.length) handleDeletePreset(selectedPresetIndex);
          return;
        }
        if (input.toLowerCase() === "s") {
          setFocusField("presetName");
          return;
        }
      }
    }

    if (activePane === "preview") {
      if (!previewLines.length) return;

      if (key.upArrow || input === "k") {
        setPreviewScrollOffset(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        setPreviewScrollOffset(prev => Math.min(previewMaxScroll, prev + 1));
        return;
      }
      if (key.pageUp || input === "b") {
        setPreviewScrollOffset(prev => Math.max(0, prev - previewCodeHeight));
        return;
      }
      if (key.pageDown || input === " ") {
        setPreviewScrollOffset(prev => Math.min(previewMaxScroll, prev + previewCodeHeight));
        return;
      }
      if (input === "g") {
        setPreviewScrollOffset(0);
        return;
      }
      if (input === "G") {
        setPreviewScrollOffset(previewMaxScroll);
        return;
      }
    }

    if (activePane === "sample") {
      if (promptSampleCollapsed) return;
      if (!promptPreviewLines.length) return;

      if (key.upArrow || input === "k") {
        setPromptSampleScrollOffset(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        setPromptSampleScrollOffset(prev => Math.min(promptSampleMaxScroll, prev + 1));
        return;
      }
      if (key.pageUp || input === "b") {
        setPromptSampleScrollOffset(prev => Math.max(0, prev - promptSampleCodeHeight));
        return;
      }
      if (key.pageDown || input === " ") {
        setPromptSampleScrollOffset(prev => Math.min(promptSampleMaxScroll, prev + promptSampleCodeHeight));
        return;
      }
      if (input === "g") {
        setPromptSampleScrollOffset(0);
        return;
      }
      if (input === "G") {
        setPromptSampleScrollOffset(promptSampleMaxScroll);
        return;
      }
    }
  });

  const cost = (statsTokens / 1_000_000) * COST_PER_1M_TOKENS;
  const contextPercent = Math.min(
    1,
    statsTokens / CONTEXT_WINDOW
  );
  const contextWarning =
    statsTokens > CONTEXT_WINDOW
      ? "Warning: Estimated tokens exceed context window; model may truncate."
      : statsTokens > 100_000
      ? "Large prompt; ensure you're using a 128k+ context model."
      : "";

  if (loading && !rootNode) {
    return (
      <Box padding={2} flexDirection="column">
        <Box>
          <Spinner type="dots" />
          <Text> Scanning project...</Text>
        </Box>
        {progressText && (
          <Box marginTop={1}>
            <Text>{progressText}</Text>
          </Box>
        )}
      </Box>
    );
  }

  if (mode === "combined") {
    const combinedLines = combined ? combined.text.split("\n") : [];
    const combinedViewHeight = Math.max(5, rows - 15);

    return (
      <Box flexDirection="column" height={rows} width={cols} paddingX={1}>
        <Box justifyContent="center" height={3} alignItems="center">
          <Gradient name="pastel">
            <Text bold>══════ Combined Prompt ══════</Text>
          </Gradient>
        </Box>
        <Box
          flexDirection="row"
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
          paddingY={1}
          flexGrow={1}
        >
          <ScrollableBox
            height={combinedViewHeight}
            scrollOffset={combinedScrollOffset}
            showScrollbar={combinedLines.length > combinedViewHeight}
            accentColor="cyan"
            totalItems={combinedLines.length}
          >
            {combinedLines
              .slice(combinedScrollOffset, combinedScrollOffset + combinedViewHeight)
              .map((line, idx) => (
                <Text key={idx}>{line || " "}</Text>
              ))}
          </ScrollableBox>
        </Box>
        <Box
          borderTop
          borderStyle="single"
          borderColor="gray"
          paddingTop={1}
          flexDirection="column"
        >
          <Box justifyContent="space-between">
            <Text dimColor>
              [J/K] Scroll  [Space/B] Page  [Y] Copy  [W] Save  [Esc/Q] Back
            </Text>
            {combined && (
              <Text>
                {formatBytes(combined.bytes)} | Lines: {combined.lines} | Tokens:{" "}
                {combined.tokens.toLocaleString()}
              </Text>
            )}
          </Box>
          {combined && (
            <Box marginTop={1} flexDirection="column">
              <ProgressBar
                percent={Math.min(
                  1,
                  combined.tokens / CONTEXT_WINDOW
                )}
                color={
                  combined.tokens > CONTEXT_WINDOW ? "red" : "green"
                }
              />
              <Text dimColor>
                {Math.round(
                  (combined.tokens / CONTEXT_WINDOW) * 1000
                ) / 10}
                % of {CONTEXT_WINDOW.toLocaleString()}-token context
              </Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text color="green">{status}</Text>
          </Box>
          {focusField === "exportPath" && (
            <Box marginTop={1}>
              <Text>Save as: </Text>
              <TextInput
                value={exportPath}
                onChange={setExportPath}
                focus={true}
              />
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  const explorerWidth = Math.max(20, Math.floor(cols * 0.4));
  const configWidth = Math.max(15, Math.floor(cols * 0.3));
  const previewWidth = Math.max(10, cols - explorerWidth - configWidth - 4);

  return (
    <Box flexDirection="column" height={rows} width={cols} paddingX={1}>
      <Box justifyContent="center" height={3} alignItems="center">
        <Gradient name="morning">
          <Text bold>══════ Source2Prompt ══════</Text>
        </Gradient>
      </Box>

      <Box marginBottom={1}>
        <Text>Root: </Text>
        <TextInput
          value={rootDir}
          onChange={setRootDir}
          focus={focusField === "rootDir"}
        />
      </Box>

      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="round"
        borderColor="gray"
      >
        <Box flexDirection="row" flexGrow={1}>
          {/* Explorer */}
          <Box
            width={explorerWidth}
            flexDirection="column"
            borderStyle="single"
            borderColor={activePane === "explorer" ? "cyan" : "gray"}
          >
            <Box
              borderBottom
              borderStyle="single"
              borderColor="gray"
              paddingX={1}
              justifyContent="space-between"
            >
              <Text bold color={activePane === "explorer" ? "cyan" : "white"}>
                EXPLORER
              </Text>
              <Text dimColor>
                {statsFileCount} sel / {flatFiles.length} files
              </Text>
            </Box>

            <Box
              borderBottom
              borderStyle="single"
              borderColor="gray"
              paddingX={1}
            >
              <Text color="cyan">Filter: </Text>
              <TextInput
                value={filter}
                onChange={setFilter}
                focus={focusField === "filter" && activePane === "explorer"}
                placeholder="Filter by path..."
              />
            </Box>

            <Box flexDirection="row" flexGrow={1} paddingLeft={1}>
              {visibleNodes.length === 0 ? (
                <Text dimColor>No files match current filter.</Text>
              ) : (
                <ScrollableBox
                  height={listHeight}
                  scrollOffset={scrollOffset}
                  showScrollbar={visibleNodes.length > listHeight}
                  accentColor="cyan"
                  totalItems={visibleNodes.length}
                >
	                  {visibleNodes
	                    .slice(scrollOffset, scrollOffset + listHeight)
	                    .map((node, sliceIdx) => {
	                      const globalIdx = scrollOffset + sliceIdx;
	                      const isCursor = globalIdx === cursor;
	                      const isSel = selected.has(node.path);
	                      const marker = isCursor ? ">" : " ";
	                      const indent = filter.trim() ? 0 : node.depth;
	                      const isLargeText = isLargeTextNode(node);
	                      const isTooLarge =
	                        !node.isDirectory && node.isText && node.sizeBytes > MAX_INCLUDE_BYTES;
	                      const icon = node.isDirectory
	                        ? expanded.has(node.path)
	                          ? "[-]"
	                          : "[+]"
	                        : isSel
	                        ? "[x]"
	                        : node.isText
	                        ? isTooLarge
	                          ? "[!]"
	                          : isLargeText
	                          ? "[~]"
	                          : "[ ]"
	                        : "[!]";
	
	                      let color: any = node.isDirectory
	                        ? "yellow"
	                        : node.isText
	                        ? isSel
	                          ? "green"
	                          : isTooLarge
	                          ? "yellow"
	                          : isLargeText
	                          ? "cyan"
	                          : "white"
	                        : "red";
	
	                      if (isCursor) color = "cyan";
	                      const lineCountLabel =
	                        node.numLines >= 0 ? node.numLines.toLocaleString() : "?";
	                      const label =
	                        filter.trim() && node.relPath !== "." ? node.relPath : node.name;
	
	                      return (
	                        <Box key={node.path}>
	                          <Text color={isCursor ? "cyan" : "gray"}>{marker}</Text>
	                          <Text dimColor>{" ".repeat(indent)}</Text>
	                          <Text color={color}>
	                            {icon} {label}{" "}
	                            {!node.isDirectory &&
	                              `(${formatBytes(node.sizeBytes)}${
	                                node.isText ? ` | ${lineCountLabel} lines` : ", binary"
	                              })`}
	                          </Text>
	                        </Box>
	                      );
	                    })}
                </ScrollableBox>
              )}
            </Box>
          </Box>

          {/* Config */}
          <Box
            width={configWidth}
            flexDirection="column"
            borderStyle="single"
            borderColor={activePane === "config" ? "cyan" : "gray"}
          >
            <Box flexDirection="row" borderBottom borderStyle="single" borderColor="gray">
              <Box
                paddingX={1}
                borderRight
                borderStyle="single"
                borderColor={configTab === "inputs" ? "cyan" : "gray"}
              >
                <Text bold={configTab === "inputs"}>Inputs</Text>
              </Box>
              <Box
                paddingX={1}
                borderRight
                borderStyle="single"
                borderColor={configTab === "presets" ? "cyan" : "gray"}
              >
                <Text bold={configTab === "presets"}>Presets</Text>
              </Box>
              <Box
                paddingX={1}
                borderColor={configTab === "options" ? "cyan" : "gray"}
              >
                <Text bold={configTab === "options"}>Options</Text>
              </Box>
            </Box>

            {configTab === "inputs" && (
              <Box flexDirection="column" padding={1}>
                <Text bold>
                  Preamble{" "}
                  <Text color={includePreamble ? "green" : "red"}>
                    [{includePreamble ? "ON" : "OFF"}]
                  </Text>
                </Text>
                <Box
                  borderStyle="single"
                  borderColor={focusField === "preamble" ? "cyan" : "gray"}
                  paddingX={1}
                  marginBottom={1}
                >
                  <TextInput
                    value={preamble}
                    onChange={setPreamble}
                    focus={focusField === "preamble"}
                    placeholder="System / context instructions..."
                  />
                </Box>

                <Text bold>
                  Goal{" "}
                  <Text color={includeGoal ? "green" : "red"}>
                    [{includeGoal ? "ON" : "OFF"}]
                  </Text>
                </Text>
                <Box
                  borderStyle="single"
                  borderColor={focusField === "goal" ? "cyan" : "gray"}
                  paddingX={1}
                >
                  <TextInput
                    value={goal}
                    onChange={setGoal}
                    focus={focusField === "goal"}
                    placeholder="High-level task / objective..."
                  />
                </Box>

                <Box marginTop={1}>
                  <Text dimColor>
                    [P] Focus preamble  [G] Focus goal  [Ctrl+E] $EDITOR (multiline)
                  </Text>
                </Box>
              </Box>
            )}

            {configTab === "presets" && (
              <Box flexDirection="column" padding={1}>
                {presets.length === 0 && (
                  <Text dimColor>No presets yet. Press 'S' to save one.</Text>
                )}
                {presets.map((p, idx) => {
                  const active = idx === selectedPresetIndex;
                  return (
                    <Box key={p.name}>
                      <Text color={active ? "cyanBright" : "white"}>
                        {active ? "*" : " "} {p.name}
                      </Text>
                    </Box>
                  );
                })}
                <Box
                  borderTop
                  borderStyle="single"
                  borderColor="gray"
                  paddingTop={1}
                  flexDirection="column"
                >
                  <Text>Save current selection as preset:</Text>
                  <Box>
                    <Text>Name: </Text>
                    <TextInput
                      value={presetName}
                      onChange={setPresetName}
                      focus={focusField === "presetName"}
                      placeholder="Preset name..."
                    />
                  </Box>
                  <Box marginTop={1} flexDirection="column">
                    <Text dimColor>
                      [J/K] Move  [L] Load  [D] Delete  [S] Focus name + save
                    </Text>
                  </Box>
                </Box>
              </Box>
            )}

            {configTab === "options" && (
              <Box flexDirection="column" padding={1}>
                <Text>
                  Include preamble:{" "}
                  <Text color={includePreamble ? "green" : "red"}>
                    {includePreamble ? "ON" : "OFF"}
                  </Text>{" "}
                  (toggle with [I])
                </Text>
                <Text>
                  Include goal:{" "}
                  <Text color={includeGoal ? "green" : "red"}>
                    {includeGoal ? "ON" : "OFF"}
                  </Text>{" "}
                  (toggle with [O])
                </Text>
                <Text>
                  Remove comments:{" "}
                  <Text color={removeComments ? "green" : "red"}>
                    {removeComments ? "ON" : "OFF"}
                  </Text>{" "}
                  (toggle with [X])
                </Text>
                <Text>
                  Minify:{" "}
                  <Text color={minify ? "green" : "red"}>
                    {minify ? "ON" : "OFF"}
                  </Text>{" "}
                  (toggle with [M])
                </Text>
                <Box marginTop={1}>
                  <Text dimColor>
                    Options tab shortcuts: [I] preamble, [O] goal, [X] comments, [M] minify
                  </Text>
                </Box>
              </Box>
            )}
          </Box>

          {/* Preview & stats */}
          <Box
            width={previewWidth}
            flexDirection="column"
            borderStyle="single"
            borderColor={activePane === "preview" ? "cyan" : "gray"}
          >
            <Box
              borderBottom
              borderStyle="single"
              borderColor="gray"
              paddingX={1}
              justifyContent="space-between"
            >
              <Text bold>FILE PREVIEW</Text>
              {previewLines.length > 0 && (
                <Text dimColor>
                  Ln {previewScrollOffset + 1}-
                  {Math.min(previewScrollOffset + previewCodeHeight, previewLines.length)} /{" "}
                  {previewLines.length}
                </Text>
              )}
            </Box>
            <Box flexGrow={1} paddingX={1}>
              <SyntaxHighlight
                language={previewLang}
                code={
                  previewContent
                    ? previewWindowText
                    :
                  "// Select a text file to preview (or press Ctrl+G to generate)."
                }
              />
            </Box>
            <Box
              borderTop
              borderStyle="single"
              borderColor="gray"
              flexDirection="column"
              padding={1}
            >
              <Box justifyContent="space-between">
                <Text>
                  Tokens:{" "}
                  <Text color="magenta">
                    {statsTokens.toLocaleString()}
                  </Text>
                </Text>
                <Text color="green">${cost.toFixed(4)}</Text>
              </Box>
              <ProgressBar
                percent={contextPercent}
                color={statsTokens > CONTEXT_WINDOW ? "red" : "green"}
              />
              <Text dimColor>
                {Math.round(contextPercent * 1000) / 10}% of{" "}
                {CONTEXT_WINDOW.toLocaleString()}-token context
              </Text>
              {contextWarning && (
                <Text color="yellow">{contextWarning}</Text>
              )}
              <Box marginTop={1} flexDirection="column">
                <Text>
                  Size: {formatBytes(statsSizeBytes)} | Lines:{" "}
                  {statsLineCount.toLocaleString()} | Files: {statsFileCount}
                </Text>
                <Text dimColor>
                  Press Ctrl+G to generate combined prompt.
                </Text>
              </Box>
            </Box>
          </Box>
        </Box>

        {/* Prompt sample pane (4th pane) */}
        <Box
          borderTop
          borderStyle="single"
          borderColor={activePane === "sample" ? "cyan" : "gray"}
          flexDirection="column"
          padding={1}
          height={promptSampleHeight}
        >
          <Box justifyContent="space-between">
            <Text bold>PROMPT SAMPLE</Text>
            {promptSampleCollapsed ? (
              <Text dimColor>collapsed (z)</Text>
            ) : promptPreviewLines.length > 0 ? (
              <Text dimColor>
                Ln {promptSampleScrollOffset + 1}-
                {Math.min(
                  promptSampleScrollOffset + promptSampleCodeHeight,
                  promptPreviewLines.length
                )}{" "}
                / {promptPreviewLines.length}
              </Text>
            ) : (
              <Text dimColor>empty</Text>
            )}
          </Box>

          {promptSampleCollapsed ? (
            <Text dimColor>
              Collapsed. Press z to expand. (Tab to focus pane)
            </Text>
          ) : (
            <>
              <Text dimColor>
                Live preview of the first part of the combined prompt. (z to collapse)
              </Text>
              <Box marginTop={1}>
                <ScrollableBox
                  height={promptSampleCodeHeight}
                  scrollOffset={promptSampleScrollOffset}
                  showScrollbar={promptPreviewLines.length > promptSampleCodeHeight}
                  accentColor="magenta"
                >
                  {promptPreviewLines.map((line, idx) => (
                    <Text key={idx}>{line || " "}</Text>
                  ))}
                </ScrollableBox>
              </Box>
            </>
          )}
        </Box>
      </Box>

      <Box
        height={2}
        justifyContent="space-between"
        paddingX={1}
        borderTop
        borderStyle="single"
        borderColor="gray"
      >
        <Box flexDirection="column">
          <Text dimColor>
            F1/?: Help | Tab: Panes | Explorer: j/k, h/l, Space/Enter, / filter, D root, T/1-9/0/R quick select
          </Text>
          <Text dimColor>
            Config: arrows, P/G/I/O/X/M, S/L/D, Ctrl+E: $EDITOR | Sample: z, j/k | Ctrl+G: Generate | Esc: Quit (2x)
          </Text>
        </Box>
        <Box alignItems="flex-end">
          {confirmExit ? (
            <Text color="yellow" bold>Press Esc again to quit</Text>
          ) : scanError ? (
            <Text color="red">Error: {scanError}</Text>
          ) : (
            <Text color={status.startsWith("Ready") ? "white" : "green"}>
              {status}
            </Text>
          )}
        </Box>
      </Box>

      {/* Exit Confirmation Modal */}
      {confirmExit && <ExitConfirm rows={rows} cols={cols} />}

      {/* Help Modal Overlay */}
      {showHelp && <HelpModal rows={rows} cols={cols} />}
    </Box>
  );
};

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
source2prompt-tui (s2p) - A TUI for combining source code into LLM prompts.

Usage:
  s2p [directory]

Options:
  -h, --help    Show this help message

Controls:
  Explorer:     j/k (move), h/l (collapse/expand), Space (select)
  Help:         ? or F1
  Generate:     Ctrl+G
  Quit:         Esc (twice) or Ctrl+C
`);
  process.exit(0);
}

const rootDirArg = args[0];
const { waitUntilExit } = render(<App initialRootDir={rootDirArg} />);
await waitUntilExit();
