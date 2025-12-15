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

// mdn-data JSON files that need to be copied locally for css-tree
const mdnDataPatches = [
  {
    targetDir: "node_modules/css-tree/lib",
    files: [
      { src: "node_modules/mdn-data/css/at-rules.json", dest: "mdn-atrules.json" },
      { src: "node_modules/mdn-data/css/properties.json", dest: "mdn-properties.json" },
      { src: "node_modules/mdn-data/css/syntaxes.json", dest: "mdn-syntaxes.json" },
    ],
    patchFile: "node_modules/css-tree/lib/data.js",
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

// Apply mdn-data patches - copy JSON files locally and update imports
for (const patch of mdnDataPatches) {
  const patchFilePath = path.resolve(patch.patchFile);
  const targetDir = path.resolve(patch.targetDir);

  if (!fs.existsSync(patchFilePath)) {
    console.log(`Skipping mdn-data patch (${patch.patchFile} not found)`);
    continue;
  }

  let content = fs.readFileSync(patchFilePath, "utf-8");

  // Check if already patched
  if (content.includes("from './mdn-atrules.json'")) {
    console.log(`Already patched ${patch.patchFile} (mdn-data)`);
    continue;
  }

  // Copy JSON files to target directory
  for (const file of patch.files) {
    const srcPath = path.resolve(file.src);
    const destPath = path.join(targetDir, file.dest);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
    } else {
      console.warn(`Warning: ${file.src} not found`);
    }
  }

  // Update imports in data.js to use local JSON files with ESM import assertions
  content = content
    .replace(
      "import { createRequire } from 'module';",
      `import mdnAtrules from './mdn-atrules.json' with { type: 'json' };
import mdnProperties from './mdn-properties.json' with { type: 'json' };
import mdnSyntaxes from './mdn-syntaxes.json' with { type: 'json' };`
    )
    .replace("const require = createRequire(import.meta.url);", "")
    .replace("const mdnAtrules = require('mdn-data/css/at-rules.json');", "")
    .replace("const mdnProperties = require('mdn-data/css/properties.json');", "")
    .replace("const mdnSyntaxes = require('mdn-data/css/syntaxes.json');", "");

  fs.writeFileSync(patchFilePath, content);
  console.log(`Patched ${patch.patchFile} (mdn-data JSON imports)`);
}
