#!/usr/bin/env bun
/**
 * Patches node_modules that use require for JSON files, which breaks bun compile.
 * Run this after bun install (it's the postinstall script).
 */

import fs from "node:fs";
import path from "node:path";

// Simple regex-based patches
const regexPatches = [
  {
    file: "node_modules/csso/lib/version.js",
    find: /import \{ createRequire \} from 'module';\s*const require = createRequire\(import\.meta\.url\);\s*export const \{ version \} = require\('\.\.\/package\.json'\);/,
    replace: 'export const version = "5.0.5";',
    check: 'export const version = "',
  },
  {
    file: "node_modules/css-tree/lib/version.js",
    find: /import \{ createRequire \} from 'module';\s*const require = createRequire\(import\.meta\.url\);\s*export const \{ version \} = require\('\.\.\/package\.json'\);/,
    replace: 'export const version = "2.2.1";',
    check: 'export const version = "',
  },
];

// JSON inlining patches - read JSON file and inline it
const jsonInlinePatches = [
  {
    file: "node_modules/css-tree/lib/data-patch.js",
    jsonFile: "node_modules/css-tree/data/patch.json",
  },
];

// Apply regex patches
for (const patch of regexPatches) {
  const filePath = path.resolve(patch.file);
  if (!fs.existsSync(filePath)) {
    console.log(`Skipping ${patch.file} (not found)`);
    continue;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  if (patch.find.test(content)) {
    fs.writeFileSync(filePath, patch.replace);
    console.log(`Patched ${patch.file}`);
  } else if (content.includes(patch.check)) {
    console.log(`Already patched ${patch.file}`);
  } else {
    console.warn(`Warning: ${patch.file} has unexpected content`);
  }
}

// Apply JSON inlining patches
for (const patch of jsonInlinePatches) {
  const filePath = path.resolve(patch.file);
  const jsonPath = path.resolve(patch.jsonFile);

  if (!fs.existsSync(filePath) || !fs.existsSync(jsonPath)) {
    console.log(`Skipping ${patch.file} (not found)`);
    continue;
  }

  const content = fs.readFileSync(filePath, "utf-8");

  // Check if already patched
  if (content.includes("const patch = {")) {
    console.log(`Already patched ${patch.file}`);
    continue;
  }

  // Read JSON and create inline export
  const jsonData = fs.readFileSync(jsonPath, "utf-8");
  const newContent = `const patch = ${jsonData};\nexport default patch;`;
  fs.writeFileSync(filePath, newContent);
  console.log(`Patched ${patch.file} (inlined JSON)`);
}
