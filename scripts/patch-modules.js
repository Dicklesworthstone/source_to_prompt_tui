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

// Patch css-tree/lib/data.js to inline mdn-data JSON files instead of require()
// This fixes: "Cannot find module 'mdn-data/css/at-rules.json' from '/$bunfs/root/s2p'"
const mdnDataPatch = {
  file: "node_modules/css-tree/lib/data.js",
  jsonFiles: {
    mdnAtrules: "node_modules/mdn-data/css/at-rules.json",
    mdnProperties: "node_modules/mdn-data/css/properties.json",
    mdnSyntaxes: "node_modules/mdn-data/css/syntaxes.json",
  },
};

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

// Apply mdn-data inlining patch to css-tree/lib/data.js
{
  const filePath = path.resolve(mdnDataPatch.file);
  if (!fs.existsSync(filePath)) {
    console.log(`Skipping ${mdnDataPatch.file} (not found)`);
  } else {
    const content = fs.readFileSync(filePath, "utf-8");

    // Check if already patched (inlined JSON won't have createRequire)
    if (!content.includes("createRequire")) {
      console.log(`Already patched ${mdnDataPatch.file}`);
    } else {
      // Read all three mdn-data JSON files
      const jsonVars = [];
      let allFound = true;
      for (const [varName, jsonFile] of Object.entries(mdnDataPatch.jsonFiles)) {
        const jsonPath = path.resolve(jsonFile);
        if (!fs.existsSync(jsonPath)) {
          console.warn(`Warning: ${jsonFile} not found, skipping mdn-data patch`);
          allFound = false;
          break;
        }
        const jsonData = fs.readFileSync(jsonPath, "utf-8");
        jsonVars.push(`const ${varName} = ${jsonData.trim()};`);
      }

      if (allFound) {
        // Build new file content by splicing out the require() lines and
        // inserting inlined JSON. We avoid String.prototype.replace() because
        // the JSON data contains '$' characters which have special meaning
        // in replacement strings (e.g. $' means "text after match").
        const lines = content.split("\n");
        const newLines = [];
        let didPatch = false;

        for (let i = 0; i < lines.length; i++) {
          // Skip the createRequire import line
          if (lines[i].includes("import { createRequire } from 'module';")) {
            didPatch = true;
            continue;
          }
          // Skip the const require = createRequire(...) line
          if (lines[i].includes("const require = createRequire(import.meta.url);")) {
            continue;
          }
          // Replace the three require() lines with inlined JSON
          if (lines[i].includes("const mdnAtrules = require('mdn-data/css/at-rules.json');")) {
            // Validate that the next two lines are the expected require() calls
            // before replacing them. If upstream changes the file layout, we must
            // not silently corrupt the file by inlining JSON alongside mismatched lines.
            const nextLine1 = lines[i + 1] || "";
            const nextLine2 = lines[i + 2] || "";
            const match1 = nextLine1.includes("const mdnProperties = require('mdn-data/css/properties.json');");
            const match2 = nextLine2.includes("const mdnSyntaxes = require('mdn-data/css/syntaxes.json');");
            if (!match1 || !match2) {
              if (!match1) {
                console.warn(
                  `Warning: ${mdnDataPatch.file} line ${i + 2} does not match expected mdnProperties require().\n` +
                  `  Expected: const mdnProperties = require('mdn-data/css/properties.json');\n` +
                  `  Got:      ${nextLine1.trim()}`
                );
              }
              if (!match2) {
                console.warn(
                  `Warning: ${mdnDataPatch.file} line ${i + 3} does not match expected mdnSyntaxes require().\n` +
                  `  Expected: const mdnSyntaxes = require('mdn-data/css/syntaxes.json');\n` +
                  `  Got:      ${nextLine2.trim()}`
                );
              }
              console.warn(`Aborting mdn-data JSON inlining — pushing original line unchanged.`);
              // Do NOT inline JSON when the surrounding lines are unexpected.
              // Push the original line unchanged and let downstream checks catch
              // the residual require() calls.
              newLines.push(lines[i]);
              continue;
            }
            // All three require() lines match — safe to inline JSON and skip them.
            newLines.push(jsonVars.join("\n"));
            i += 2;
            continue;
          }
          newLines.push(lines[i]);
        }

        const newContent = newLines.join("\n");
        if (!didPatch) {
          console.warn(`Warning: ${mdnDataPatch.file} did not match expected pattern`);
        } else {
          // Verify that the inlined JSON data is actually present in the output.
          // didPatch only confirms createRequire was found; we must also confirm
          // the JSON variable declarations were successfully spliced in.
          const missingVars = [];
          for (const varName of Object.keys(mdnDataPatch.jsonFiles)) {
            if (!newContent.includes(`const ${varName} = {`)) {
              missingVars.push(varName);
            }
          }
          if (missingVars.length > 0) {
            console.warn(
              `Warning: ${mdnDataPatch.file} patched output is missing inlined data for: ${missingVars.join(", ")}. ` +
              `The require() lines were removed but JSON was not inlined. Aborting write.`
            );
          } else if (newContent.includes("require('mdn-data")) {
            console.warn(
              `Warning: ${mdnDataPatch.file} patched output still contains mdn-data require() calls. ` +
              `Upstream file may have changed. Aborting write.`
            );
          } else {
            fs.writeFileSync(filePath, newContent);
            console.log(`Patched ${mdnDataPatch.file} (inlined mdn-data JSON)`);
          }
        }
      }
    }
  }
}

// Patch tiktoken/tiktoken.cjs to inline tiktoken_bg.wasm as base64 instead of
// reading it from disk via fs.readFileSync(__dirname + "/tiktoken_bg.wasm").
// In a `bun build --compile` single-file binary, __dirname resolves to
// /$bunfs/root and the sibling .wasm is never embedded, so tiktoken throws
// "Missing tiktoken_bg.wasm" at load time and the binary crashes on startup
// (issue #5 was the same class of bug for mdn-data). Inlining the bytes makes
// tokenization work with zero filesystem dependency, identically on every
// cross-compiled target.
{
  const tkFile = path.resolve("node_modules/tiktoken/tiktoken.cjs");
  const wasmPath = path.resolve("node_modules/tiktoken/tiktoken_bg.wasm");
  const MARKER = "/* tiktoken_bg.wasm inlined by patch-modules.js */";

  if (!fs.existsSync(tkFile)) {
    console.log("Skipping node_modules/tiktoken/tiktoken.cjs (not found)");
  } else {
    const content = fs.readFileSync(tkFile, "utf-8");
    if (content.includes(MARKER)) {
      console.log("Already patched node_modules/tiktoken/tiktoken.cjs");
    } else if (!fs.existsSync(wasmPath)) {
      console.warn(
        "Warning: node_modules/tiktoken/tiktoken_bg.wasm not found, skipping tiktoken patch"
      );
    } else {
      // Replace the disk-reading block spanning:
      //   const path = require("path");   ...through...
      //   if (bytes == null) throw new Error("Missing tiktoken_bg.wasm");
      // with an inline base64 decode. The lines before it (require of
      // tiktoken_bg.cjs + imports setup) and after it (WebAssembly.Module /
      // Instance + exports) are preserved. `fs`/`path` are only used by the
      // removed block, so dropping their requires is safe.
      const startAnchor = 'const path = require("path");';
      const endAnchor =
        'if (bytes == null) throw new Error("Missing tiktoken_bg.wasm");';
      const startIdx = content.indexOf(startAnchor);
      const endIdx = content.indexOf(endAnchor);
      if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
        console.warn(
          "Warning: node_modules/tiktoken/tiktoken.cjs does not match expected " +
            "wasm-loading layout. Upstream tiktoken may have changed; skipping inline patch."
        );
      } else {
        const b64 = fs.readFileSync(wasmPath).toString("base64");
        const before = content.slice(0, startIdx);
        const after = content.slice(endIdx + endAnchor.length);
        const inlined = `${MARKER}\nconst bytes = Buffer.from("${b64}", "base64");`;
        const newContent = before + inlined + after;
        // Sanity: the filesystem read must be gone and the module must still
        // build the WebAssembly module from `bytes`.
        if (
          newContent.includes("fs.readFileSync") ||
          newContent.includes("Missing tiktoken_bg.wasm") ||
          !newContent.includes("new WebAssembly.Module(bytes)")
        ) {
          console.warn(
            "Warning: tiktoken.cjs patch produced unexpected output " +
              "(residual fs read or missing WebAssembly.Module). Aborting write."
          );
        } else {
          fs.writeFileSync(tkFile, newContent);
          console.log(
            `Patched node_modules/tiktoken/tiktoken.cjs (inlined ${(
              b64.length /
              1024 /
              1024
            ).toFixed(1)}MB base64 wasm)`
          );
        }
      }
    }
  }
}
