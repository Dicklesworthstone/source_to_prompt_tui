#!/usr/bin/env bun
import React, { useEffect, useMemo, useState } from "react";
import { render, Box, Text, useInput, useApp, useStdout } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import Gradient from "ink-gradient";
import BigText from "ink-big-text";
import SyntaxHighlight from "ink-syntax-highlight";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ignore, { Ignore } from "ignore";
import clipboardy from "clipboardy";
import { minify as terserMinify } from "terser";
import * as csso from "csso";
import { minify as htmlMinify } from "html-minifier-terser";
import { encodingForModel, getEncoding, Tiktoken } from "js-tiktoken";

declare const Bun: any;

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
  totalItems: number;
  visibleItems: number;
  showScrollbar?: boolean;
}

const ScrollableBox: React.FC<ScrollableBoxProps> = ({
  children,
  height,
  scrollOffset,
  totalItems,
  visibleItems,
  showScrollbar = true
}) => {
  const needsScrollbar = totalItems > visibleItems;

  // Calculate scrollbar position and size
  const trackHeight = Math.max(1, height - 2); // Leave room for arrows
  const thumbSize = Math.max(1, Math.round((visibleItems / totalItems) * trackHeight));
  const maxThumbPos = trackHeight - thumbSize;
  const scrollRatio = totalItems > visibleItems ? scrollOffset / (totalItems - visibleItems) : 0;
  const thumbPos = Math.round(scrollRatio * maxThumbPos);

  const scrollbarChars = [];
  if (needsScrollbar && showScrollbar) {
    scrollbarChars.push(scrollOffset > 0 ? "^" : "|");
    for (let i = 0; i < trackHeight; i++) {
      if (i >= thumbPos && i < thumbPos + thumbSize) {
        scrollbarChars.push("#");
      } else {
        scrollbarChars.push("|");
      }
    }
    scrollbarChars.push(scrollOffset + visibleItems < totalItems ? "v" : "|");
  }

  return (
    <Box flexDirection="row" height={height}>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {children}
      </Box>
      {needsScrollbar && showScrollbar && (
        <Box flexDirection="column" width={1}>
          {scrollbarChars.map((char, i) => (
            <Text key={i} dimColor={char === "|"} color={char === "#" ? "cyan" : undefined}>
              {char}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
};

/* ---------- Help Modal Component ---------- */
interface HelpModalProps {
  onClose: () => void;
  rows: number;
  cols: number;
}

const HelpModal: React.FC<HelpModalProps> = ({ onClose, rows, cols }) => {
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
            <Text>  F1         Show this help</Text>
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
          </Box>

          <Box flexDirection="column" width="48%">
            <Text bold color="yellow">Quick Select (Explorer)</Text>
            <Text>  t          All text files</Text>
            <Text>  1-9,0,r    JS/React/TS/JSON/MD/...</Text>
            <Text></Text>
            <Text bold color="yellow">Config Pane</Text>
            <Text>  Left/Right Switch tabs</Text>
            <Text>  p/g        Edit preamble/goal</Text>
            <Text>  i/o        Toggle preamble/goal</Text>
            <Text>  x/m        Toggle comments/minify</Text>
            <Text>  s/l/d      Save/load/delete preset</Text>
            <Text></Text>
            <Text bold color="yellow">Combined Output View</Text>
            <Text>  y          Copy to clipboard</Text>
            <Text>  w          Save to file</Text>
            <Text>  Esc/q      Return to main view</Text>
          </Box>
        </Box>

        <Box justifyContent="center" marginTop={1}>
          <Text dimColor>Press Esc or F1 to close</Text>
        </Box>
      </Box>
    </Box>
  );
};

/* ---------- Exit Confirmation Component ---------- */
interface ExitConfirmProps {
  onCancel: () => void;
}

const ExitConfirm: React.FC<ExitConfirmProps> = ({ onCancel }) => {
  return (
    <Box>
      <Text color="yellow" bold>
        Press Esc again to quit, or any other key to cancel
      </Text>
    </Box>
  );
};

/* ---------- Types & constants ---------- */

type Pane = "explorer" | "config" | "preview";
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
  content: string; // only for small text files; else ""
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
  ".gitignore",
  ".gitattributes",
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
  ".editorconfig",
  ".prettierrc",
  ".eslintrc",
  ".babelrc",
  ".npmrc",
  ".nvmrc",
  ".dockerignore",
  ".helmignore"
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
  ".prettierignore",
  ".eslintignore",
  ".dockerignore",
  ".npmignore"
]);

const PRESET_FILE = path.join(os.homedir(), ".source2prompt.json");
const CONTEXT_WINDOW = 128000;
const COST_PER_1M_TOKENS = 5.0;
const MAX_PREVIEW_CHARS = 2000;
const MAX_READ_BYTES = 5 * 1024 * 1024; // 5MB

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
  // Check for files that start with a dot but have no other extension
  if (filename.startsWith(".") && !ext) {
    return TEXT_FILENAMES.has(filename);
  }
  return false;
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

  async function addGitignore(dirAbs: string, relPrefix: string) {
    const giPath = path.join(dirAbs, ".gitignore");
    try {
      const content = await fsp.readFile(giPath, "utf8");
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const pattern = relPrefix ? path.posix.join(relPrefix, trimmed) : trimmed;
        ig.add(pattern);
      }
    } catch {
      // ignore
    }

    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== ".git") {
        const childAbs = path.join(dirAbs, entry.name);
        const childRel = relPrefix
          ? path.posix.join(relPrefix, entry.name)
          : entry.name;
        await addGitignore(childAbs, childRel);
      }
    }
  }

  await addGitignore(rootDir, "");
  return ig;
}

async function scanProject(
  rootDir: string,
  onProgress?: (info: { processedFiles: number; currentPath?: string }) => void
): Promise<{ root: FileNode; flatFiles: FileNode[] }> {
  const resolvedRoot = path.resolve(rootDir);
  const ig = await buildIgnore(resolvedRoot);

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
    content: "",
    children: []
  };

  const flatFiles: FileNode[] = [];
  let processed = 0;

  async function walk(dirAbs: string, parent: FileNode, relDir: string, depth: number) {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const relPath = relDir ? path.posix.join(relDir, entry.name) : entry.name;
      if (ig.ignores(relPath)) continue;

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
          content: "",
          children: []
        };
        parent.children!.push(node);
        await walk(absPath, node, relPath, depth + 1);
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
        let numLines = 0;

        if (isText && sizeBytes <= MAX_READ_BYTES) {
          try {
            content = await fsp.readFile(absPath, "utf8");
            numLines = content.split(/\r?\n/).length;
          } catch {
            isText = false;
            content = "";
          }
        } else if (isText) {
          isText = false;
        }

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
          content,
          children: undefined
        };

        parent.children!.push(node);
        flatFiles.push(node);
        processed++;
        onProgress?.({ processedFiles: processed, currentPath: relPath });
      }
    }
  }

  await walk(resolvedRoot, root, "", 0);

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

  return { root, flatFiles };
}

/* ---------- Minification & transformation ---------- */

function stripCommentsGeneric(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

function stripHashComments(content: string): string {
  return content.replace(/(^|\s)#.*$/gm, "$1");
}

function stripHtmlComments(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, "");
}

async function transformFileContent(
  file: FileNode,
  options: { removeComments: boolean; minify: boolean }
): Promise<string> {
  if (!file.isText) return file.content;
  let text =
    file.content || (await fsp.readFile(file.path, "utf8").catch(() => "")) || "";
  const ext = file.extension.toLowerCase();

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
        ext === ".ts" || ext === ".tsx"
          ? "tsx"
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
  } else if (options.removeComments) {
    if (
      ext === ".js" ||
      ext === ".jsx" ||
      ext === ".ts" ||
      ext === ".tsx" ||
      ext === ".mjs" ||
      ext === ".cjs" ||
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
      text = stripHashComments(text);
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

  lines.push("<project_tree>");

  const printNode = (node: FileNode, prefix: string) => {
    if (!hasSelected(node)) return;
    const isRoot = node.relPath === ".";
    const label = isRoot ? node.name : node.relPath;
    const icon = node.isDirectory ? "+" : "-";
    lines.push(`${prefix}${icon} ${label}`);
    if (node.children && node.children.length) {
      for (const child of node.children) {
        printNode(child, prefix + "  ");
      }
    }
  };

  printNode(root, "");
  lines.push("</project_tree>");

  return lines;
}

/* ---------- Combined output & preview snippet ---------- */

async function buildCombinedOutput(
  root: FileNode | null,
  flatFiles: FileNode[],
  selected: Set<string>,
  options: CombineOptions
): Promise<CombinedResult> {
  const selectedFiles = flatFiles
    .filter(f => !f.isDirectory && f.isText && selected.has(f.path))
    .sort((a, b) => a.relPath.localeCompare(b.relPath));

  const bodyLines: string[] = [];

  if (options.includePreamble && options.preambleText.trim()) {
    bodyLines.push(
      "<preamble>",
      options.preambleText.trim(),
      "</preamble>",
      ""
    );
  }

  if (options.includeGoal && options.goalText.trim()) {
    bodyLines.push("<goal>", options.goalText.trim(), "</goal>", "");
  }

  if (root && selectedFiles.length > 0) {
    const treeLines = buildProjectTreeLines(root, selected);
    if (treeLines.length > 0) {
      bodyLines.push(...treeLines, "");
    }
  }

  bodyLines.push("<files>");

  for (const file of selectedFiles) {
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

    bodyLines.push(
      `<file path="${file.relPath}" lang="${lang}" lines="${numLines}" bytes="${contentBytes}" tokens="${fileTokens}">`,
      content,
      "</file>",
      ""
    );
  }

  bodyLines.push("</files>");

  const bodyText = bodyLines.join("\n");
  const bodyBytes = Buffer.byteLength(bodyText, "utf8");
  const bodyTokens = countTokens(bodyText);
  const bodyLinesCount = bodyText.split(/\r?\n/).length;

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
    const transformed = await transformFileContent(f, {
      removeComments: options.removeComments,
      minify: options.minify
    });
    let snippet = transformed || f.content;
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

function loadPresets(): Preset[] {
  try {
    const raw = fs.readFileSync(PRESET_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.presets)) return parsed.presets;
    return [];
  } catch {
    return [];
  }
}

function savePresets(presets: Preset[]) {
  try {
    fs.writeFileSync(PRESET_FILE, JSON.stringify(presets, null, 2), "utf8");
  } catch {
    // ignore
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await clipboardy.write(text);
    return true;
  } catch {
    return false;
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

const App: React.FC = () => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [rootDir, setRootDir] = useState(path.resolve(process.cwd()));

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
  const [previewContent, setPreviewContent] = useState("");
  const [previewLang, setPreviewLang] = useState("txt");

  const [mode, setMode] = useState<Mode>("main");
  const [combined, setCombined] = useState<CombinedResult | null>(null);
  const [exportPath, setExportPath] = useState("combined-prompt.txt");

  const [promptPreview, setPromptPreview] = useState("");

  // UI state for modals and exit confirmation
  const [showHelp, setShowHelp] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);

  // Scroll offsets for different panes
  const [previewScrollOffset, setPreviewScrollOffset] = useState(0);
  const [promptSampleScrollOffset, setPromptSampleScrollOffset] = useState(0);
  const [combinedScrollOffset, setCombinedScrollOffset] = useState(0);

  const rows = stdout.rows ?? 30;
  const cols = stdout.columns ?? 120;
  const listHeight = Math.max(8, rows - 16);

  const handleScan = async (
    dir: string
  ): Promise<{ root: FileNode | null; files: FileNode[] }> => {
    const resolved = path.resolve(dir);
    setRootDir(resolved);
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

    try {
      const result = await scanProject(resolved, info => {
        setProgressText(
          info.currentPath
            ? `Scanning ${info.currentPath} (${info.processedFiles} files)...`
            : `Scanning... (${info.processedFiles} files)`
        );
      });
      setRootNode(result.root);
      setFlatFiles(result.flatFiles);
      setExpanded(new Set([result.root.path]));
      setStatus(`Scanned ${result.flatFiles.length} files from ${resolved}`);
      setLoading(false);
      setProgressText(null);
      return { root: result.root, files: result.flatFiles };
    } catch (err: any) {
      setScanError(err?.message || String(err));
      setStatus("Scan error");
      setLoading(false);
      setProgressText(null);
      return { root: null, files: [] };
    }
  };

  useEffect(() => {
    (async () => {
      const loaded = loadPresets();
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

  const viewNodes = useMemo(
    () => visibleNodes.slice(scrollOffset, scrollOffset + listHeight),
    [visibleNodes, scrollOffset, listHeight]
  );

  const debouncedStats = useMemo(
    () =>
      debounce(
        (
          files: FileNode[],
          selectedSet: Set<string>,
          includePreamble: boolean,
          preambleText: string,
          includeGoal: boolean,
          goalText: string
        ) => {
          const selectedFiles = files.filter(
            f => !f.isDirectory && f.isText && selectedSet.has(f.path)
          );
          const size = selectedFiles.reduce(
            (acc, f) => acc + f.sizeBytes,
            0
          );

          const tokensFromFiles = selectedFiles.reduce((acc, f) => {
            if (f.content) return acc + countTokens(f.content);
            const approx = Math.ceil(f.sizeBytes / 4);
            return acc + approx;
          }, 0);

          const paramTokens =
            (includePreamble ? countTokens(preambleText) : 0) +
            (includeGoal ? countTokens(goalText) : 0);

          const totalTokens = tokensFromFiles + paramTokens;

          setStatsFileCount(selectedFiles.length);
          setStatsSizeBytes(size);
          setStatsTokens(totalTokens);
        },
        200
      ),
    []
  );

  useEffect(() => {
    debouncedStats(
      flatFiles,
      selected,
      includePreamble,
      preamble,
      includeGoal,
      goal
    );
  }, [flatFiles, selected, includePreamble, preamble, includeGoal, goal, debouncedStats]);

  useEffect(() => {
    const node = visibleNodes[cursor];
    if (!node || node.isDirectory || !node.isText) {
      setPreviewContent("");
      setPreviewLang("txt");
      return;
    }
    const lang = languageFromExtension(node.extension);
    setPreviewLang(lang);

    if (node.content) {
      setPreviewContent(
        node.content.length > MAX_PREVIEW_CHARS
          ? node.content.slice(0, MAX_PREVIEW_CHARS)
          : node.content
      );
    } else if (node.isText) {
      fsp
        .readFile(node.path, "utf8")
        .then(content =>
          setPreviewContent(
            content.length > MAX_PREVIEW_CHARS
              ? content.slice(0, MAX_PREVIEW_CHARS)
              : content
          )
        )
        .catch(() => setPreviewContent("// Error reading file"));
    }
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
    if (node.isDirectory && !filter.trim()) {
      const descendants: FileNode[] = [];
      const collectDesc = (n: FileNode) => {
        if (!n.isDirectory && n.isText) descendants.push(n);
        if (n.children) for (const c of n.children) collectDesc(c);
      };
      collectDesc(node);
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

    if (!node.isDirectory) {
      if (!node.isText) {
        setStatus("File is binary or too large to include.");
        return;
      }
      const newSel = new Set(selected);
      if (newSel.has(node.path)) newSel.delete(node.path);
      else newSel.add(node.path);
      setSelected(newSel);
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
      f => f.isText
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
    const inFilter = flatFiles.filter(f =>
      f.relPath.toLowerCase().includes(q)
    );
    if (!inFilter.length) return;
    const newSel = new Set(selected);
    for (const f of inFilter) newSel.delete(f.path);
    setSelected(newSel);
    setStatus("Cleared selections for files matching current filter.");
  };

  const handleSavePreset = () => {
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
    savePresets(next);
    setPresetName("");
    setStatus(`Saved preset "${name}".`);
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
          if (node && node.isText) newSel.add(abs);
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
        if (node && node.isText) newSel.add(abs);
      }
      setSelected(newSel);
      setStatus(
        `Loaded preset "${preset.name}" (${newSel.size} files selected).`
      );
    }
  };

  const handleDeletePreset = (index: number) => {
    const preset = presets[index];
    if (!preset) return;
    const next = presets.filter((_, i) => i !== index);
    setPresets(next);
    savePresets(next);
    setSelectedPresetIndex(prev =>
      prev >= next.length ? Math.max(0, next.length - 1) : prev
    );
    setStatus(`Deleted preset "${preset.name}".`);
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
      const result = await buildCombinedOutput(
        rootNode,
        flatFiles,
        selected,
        options
      );
      setCombined(result);
      const copied = await copyToClipboard(result.text);
      setMode("combined");
      setStatus(
        `${copied ? "Copied to clipboard" : "Generated"}: ${formatBytes(
          result.bytes
        )}, ~${result.tokens.toLocaleString()} tokens.`
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

  useInput((input, key) => {
    // Force quit with Ctrl+C
    if (key.ctrl && input === "c") {
      exit();
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
      if (key.escape || input === "\x1bOP" || input === "\x1b[11~") {
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
        setStatus("Press Esc again to quit, or any other key to cancel.");
        return;
      }
    }

    // Any non-Escape key cancels the exit confirmation
    if (confirmExit && !key.escape) {
      setConfirmExit(false);
      setStatus("Exit cancelled.");
      // Don't return - continue processing the key
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
      if (key.upArrow || input === "k") {
        setCombinedScrollOffset(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        if (combined) {
          const maxScroll = Math.max(0, combined.lines - (rows - 15));
          setCombinedScrollOffset(prev => Math.min(maxScroll, prev + 1));
        }
        return;
      }
      if (key.pageUp || input === "b") {
        setCombinedScrollOffset(prev => Math.max(0, prev - (rows - 15)));
        return;
      }
      if (key.pageDown || input === " ") {
        if (combined) {
          const maxScroll = Math.max(0, combined.lines - (rows - 15));
          setCombinedScrollOffset(prev => Math.min(maxScroll, prev + (rows - 15)));
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
      const panes: Pane[] = ["explorer", "config", "preview"];
      const idx = panes.indexOf(activePane);
      const next = panes[(idx + 1) % panes.length];
      setActivePane(next);
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
    const combinedViewHeight = rows - 15;
    const visibleCombinedLines = combinedLines.slice(
      combinedScrollOffset,
      combinedScrollOffset + combinedViewHeight
    );

    return (
      <Box flexDirection="column" height={rows} width={cols} paddingX={1}>
        <Box justifyContent="center" height={3}>
          <Gradient name="pastel">
            <BigText text="Combined Prompt" font="tiny" />
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
          <Box flexDirection="column" flexGrow={1} overflow="hidden">
            {visibleCombinedLines.map((line, idx) => (
              <Text key={idx}>{line || " "}</Text>
            ))}
          </Box>
          {combinedLines.length > combinedViewHeight && (
            <Box flexDirection="column" width={1} marginLeft={1}>
              <Text color={combinedScrollOffset > 0 ? "cyan" : "gray"}>^</Text>
              {Array.from({ length: Math.max(1, combinedViewHeight - 2) }).map((_, i) => {
                const trackHeight = combinedViewHeight - 2;
                const thumbSize = Math.max(1, Math.round((combinedViewHeight / combinedLines.length) * trackHeight));
                const maxThumbPos = trackHeight - thumbSize;
                const scrollRatio = combinedLines.length > combinedViewHeight
                  ? combinedScrollOffset / (combinedLines.length - combinedViewHeight)
                  : 0;
                const thumbPos = Math.round(scrollRatio * maxThumbPos);
                const isThumb = i >= thumbPos && i < thumbPos + thumbSize;
                return (
                  <Text key={i} color={isThumb ? "cyan" : "gray"}>
                    {isThumb ? "#" : "|"}
                  </Text>
                );
              })}
              <Text color={combinedScrollOffset + combinedViewHeight < combinedLines.length ? "cyan" : "gray"}>v</Text>
            </Box>
          )}
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

  const explorerWidth = Math.floor(cols * 0.4);
  const configWidth = Math.floor(cols * 0.3);
  const previewWidth = cols - explorerWidth - configWidth - 4;

  return (
    <Box flexDirection="column" height={rows} width={cols} paddingX={1}>
      <Box justifyContent="center" height={3}>
        <Gradient name="morning">
          <BigText text="Source2Prompt" font="tiny" />
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

            <Box flexDirection="row" flexGrow={1}>
              <Box flexDirection="column" paddingLeft={1} flexGrow={1} overflow="hidden">
                {viewNodes.length === 0 && (
                  <Text dimColor>No files match current filter.</Text>
                )}
                {viewNodes.map((node, idx) => {
                  const isCursor = scrollOffset + idx === cursor;
                  const isSel = selected.has(node.path);
                  const marker = isCursor ? ">" : " ";
                  const indent = filter.trim() ? 0 : node.depth;
                  const icon = node.isDirectory
                    ? expanded.has(node.path)
                      ? "[-]"
                      : "[+]"
                    : isSel
                    ? "[x]"
                    : node.isText
                    ? "[ ]"
                    : "[!]";

                  let color: any = node.isDirectory
                    ? "yellow"
                    : node.isText
                    ? isSel
                      ? "green"
                      : "white"
                    : "red";

                  if (isCursor) color = "cyan";

                  return (
                    <Box key={node.path}>
                      <Text color={isCursor ? "cyan" : "gray"}>{marker}</Text>
                      <Text dimColor>{" ".repeat(indent)}</Text>
                      <Text color={color}>
                        {icon}{" "}
                        {node.relPath === "." ? node.name : node.relPath}{" "}
                        {!node.isDirectory &&
                          `(${formatBytes(node.sizeBytes)}${
                            node.isText ? "" : ", binary"
                          })`}
                      </Text>
                    </Box>
                  );
                })}
              </Box>
              {/* Explorer scrollbar */}
              {visibleNodes.length > listHeight && (
                <Box flexDirection="column" width={1}>
                  <Text color={scrollOffset > 0 ? "cyan" : "gray"}>^</Text>
                  {Array.from({ length: Math.max(1, listHeight - 2) }).map((_, i) => {
                    const trackHeight = listHeight - 2;
                    const thumbSize = Math.max(1, Math.round((listHeight / visibleNodes.length) * trackHeight));
                    const maxThumbPos = trackHeight - thumbSize;
                    const scrollRatio = visibleNodes.length > listHeight
                      ? scrollOffset / (visibleNodes.length - listHeight)
                      : 0;
                    const thumbPos = Math.round(scrollRatio * maxThumbPos);
                    const isThumb = i >= thumbPos && i < thumbPos + thumbSize;
                    return (
                      <Text key={i} color={isThumb ? "cyan" : "gray"}>
                        {isThumb ? "#" : "|"}
                      </Text>
                    );
                  })}
                  <Text color={scrollOffset + listHeight < visibleNodes.length ? "cyan" : "gray"}>v</Text>
                </Box>
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
                    [P] Edit preamble  [G] Edit goal (while in Inputs tab)
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
            >
              <Text bold>FILE PREVIEW</Text>
            </Box>
            <Box flexGrow={1} paddingX={1}>
              <SyntaxHighlight
                language={previewLang}
                code={
                  previewContent ||
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
                  Selected size: {formatBytes(statsSizeBytes)} | Files:{" "}
                  {statsFileCount}
                </Text>
                <Text dimColor>
                  Generation: press Ctrl+G to build combined prompt and open Combined view.
                </Text>
              </Box>
            </Box>
          </Box>
        </Box>

        {/* Prompt sample pane (4th pane) */}
        <Box
          borderTop
          borderStyle="single"
          borderColor="gray"
          flexDirection="column"
          padding={1}
        >
          <Text bold>PROMPT SAMPLE</Text>
          <Text dimColor>
            Live preview of the first part of the combined prompt, based on your current
            selections and options.
          </Text>
          <Box marginTop={1}>
            <SyntaxHighlight language="txt" code={promptPreview} />
          </Box>
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
            F1: Help | Tab: Panes | Explorer: j/k, h/l, Space/Enter, / filter, D root, T/1-9/0/R quick select
          </Text>
          <Text dimColor>
            Config: arrows, P/G/I/O/X/M, S/L/D | Ctrl+G: Generate | Esc: Quit (2x)
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

      {/* Help Modal Overlay */}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} rows={rows} cols={cols} />}
    </Box>
  );
};

render(<App />);
