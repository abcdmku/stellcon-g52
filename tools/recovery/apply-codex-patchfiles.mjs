import fs from "node:fs";
import path from "node:path";

function walk(dirPath) {
  const out = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function splitLines(text) {
  return text.split(/\r?\n/);
}

function joinLines(lines, eol) {
  return lines.join(eol);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err && err.code === "ENOENT") return;
    throw err;
  }
}

function safeRmdir(filePath) {
  try {
    fs.rmSync(filePath, { recursive: true, force: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return;
    throw err;
  }
}

function startsWithAny(line, prefixes) {
  return prefixes.some((p) => line.startsWith(p));
}

function extractPatchOperations(patchText) {
  const lines = splitLines(patchText);
  let index = 0;

  function nextLine() {
    if (index >= lines.length) return null;
    return lines[index++];
  }

  const begin = nextLine();
  if (begin?.trim() !== "*** Begin Patch") throw new Error("Missing *** Begin Patch");

  const ops = [];
  let current = null;

  while (index < lines.length) {
    const line = nextLine();
    if (line == null) break;
    if (line.trim() === "*** End Patch") break;

    const updateMatch = line.match(/^\*\*\* (Add File|Update File|Delete File): (.+)$/);
    if (updateMatch) {
      if (current) ops.push(current);
      current = {
        kind: updateMatch[1],
        file: updateMatch[2].trim(),
        moveTo: null,
        body: [],
      };
      continue;
    }

    if (!current) {
      // Ignore any stray lines outside a file op.
      continue;
    }

    const moveMatch = line.match(/^\*\*\* Move to: (.+)$/);
    if (moveMatch) {
      current.moveTo = moveMatch[1].trim();
      continue;
    }

    current.body.push(line);
  }

  if (current) ops.push(current);
  return ops;
}

function findSubsequenceIndex(haystack, needle) {
  if (!needle.length) return 0;
  outer: for (let start = 0; start + needle.length <= haystack.length; start++) {
    for (let i = 0; i < needle.length; i++) {
      if (haystack[start + i] !== needle[i]) continue outer;
    }
    return start;
  }
  return -1;
}

function fuzzyContainsLine(lines, needle) {
  if (lines.includes(needle)) return true;
  const trimmed = String(needle || "").trim();
  if (!trimmed) return false;

  const withoutSemicolon = trimmed.endsWith(";") ? trimmed.slice(0, -1) : trimmed;
  const candidates = [trimmed, withoutSemicolon].filter(Boolean);

  return lines.some((line) => candidates.some((c) => c.length >= 8 && String(line).includes(c)));
}

function applyUnifiedHunks(originalLines, hunkBlocks) {
  let lines = originalLines.slice();

  for (const hunkLines of hunkBlocks) {
    const needle = [];
    for (const hl of hunkLines) {
      if (!hl) continue;
      const prefix = hl[0];
      const content = hl.slice(1);
      if (prefix === " " || prefix === "-") needle.push(content);
    }

    const startIndex = findSubsequenceIndex(lines, needle);
    if (startIndex < 0) {
      // Heuristic: if the hunk "after" state already exists in the file, treat as already applied.
      const afterNeedle = [];
      const addedLines = [];
      const removedLines = [];
      for (const hl of hunkLines) {
        if (!hl) continue;
        const prefix = hl[0];
        const content = hl.slice(1);
        if (prefix === " " || prefix === "+") afterNeedle.push(content);
        if (prefix === "+") addedLines.push(content);
        if (prefix === "-") removedLines.push(content);
      }
      const afterIndex = findSubsequenceIndex(lines, afterNeedle);
      if (afterIndex >= 0) continue;

      // Looser heuristic: if all added lines exist and all removed lines are absent, treat as already applied.
      const hasAllAdds = addedLines.every((l) => fuzzyContainsLine(lines, l));
      const hasNoRemoves = removedLines.every((l) => !fuzzyContainsLine(lines, l));
      if (hasAllAdds && hasNoRemoves) continue;

      const snippet = needle.slice(0, 6).join("\\n");
      throw new Error(`Hunk context not found. First lines:\\n${snippet}`);
    }

    const replacement = [];
    let needleIndex = 0;
    for (const hl of hunkLines) {
      if (!hl) continue;
      const prefix = hl[0];
      const content = hl.slice(1);
      if (prefix === " ") {
        replacement.push(lines[startIndex + needleIndex]);
        needleIndex++;
      } else if (prefix === "-") {
        needleIndex++;
      } else if (prefix === "+") {
        replacement.push(content);
      } else {
        throw new Error(`Unexpected hunk line prefix: ${prefix}`);
      }
    }

    lines.splice(startIndex, needle.length, ...replacement);
  }

  return lines;
}

function parseUpdateBody(bodyLines) {
  const hunks = [];
  let current = null;

  for (const line of bodyLines) {
    if (line.trim() === "*** End of File") continue;
    if (line.startsWith("@@")) {
      if (current) hunks.push(current);
      current = [];
      continue;
    }
    if (!current) continue;
    if (!line) {
      current.push(" ");
      continue;
    }
    if (!startsWithAny(line, [" ", "+", "-"])) continue;
    current.push(line);
  }

  if (current) hunks.push(current);
  return hunks;
}

function applyUpdateFile({ filePath, moveTo, body }) {
  const diskPath = path.resolve(filePath);
  if (!fs.existsSync(diskPath)) return { applied: false, reason: "missing" };

  const originalText = readText(diskPath);
  const eol = detectEol(originalText);
  const originalLines = splitLines(originalText);
  const hunks = parseUpdateBody(body);
  const updatedLines = applyUnifiedHunks(originalLines, hunks);
  const updatedText = joinLines(updatedLines, eol);

  fs.writeFileSync(diskPath, updatedText, "utf8");

  if (moveTo) {
    const movePath = path.resolve(moveTo);
    ensureDir(path.dirname(movePath));
    fs.copyFileSync(diskPath, movePath);
    safeUnlink(diskPath);
  }

  return { applied: true };
}

function applyAddFile({ filePath, moveTo, body }) {
  if (moveTo) throw new Error("Move to is not valid for Add File");
  const diskPath = path.resolve(filePath);
  if (fs.existsSync(diskPath)) return { applied: false, reason: "exists" };
  ensureDir(path.dirname(diskPath));
  const lines = body.map((line) => (line.startsWith("+") ? line.slice(1) : ""));
  fs.writeFileSync(diskPath, joinLines(lines, "\n"), "utf8");
  return { applied: true };
}

function applyDeleteFile({ filePath, moveTo }) {
  if (moveTo) throw new Error("Move to is not valid for Delete File");
  const diskPath = path.resolve(filePath);
  if (!fs.existsSync(diskPath)) return { applied: false, reason: "missing" };
  const stat = fs.statSync(diskPath);
  if (stat.isDirectory()) safeRmdir(diskPath);
  else safeUnlink(diskPath);
  return { applied: true };
}

function shouldSkipPatch(patchText) {
  return patchText.includes("tools/recovery/");
}

function main() {
  const inputs = process.argv.slice(2);
  const skipMissing = inputs.includes("--skip-missing");
  const skipFailed = inputs.includes("--skip-failed");
  const args = inputs.filter((arg) => arg !== "--skip-missing" && arg !== "--skip-failed");
  const root = path.resolve("tools", "recovery", "codex-patches");
  const files =
    args.length > 0
      ? args.map((p) => path.resolve(p))
      : walk(root).filter((p) => p.endsWith(".patch"));

  const patchFiles = files.filter((p) => p.endsWith(".patch")).sort((a, b) => a.localeCompare(b));
  if (!patchFiles.length) {
    // eslint-disable-next-line no-console
    console.log("No patch files found.");
    return;
  }

  let applied = 0;
  let skipped = 0;
  let opSkipped = 0;
  let opFailed = 0;

  for (const patchFile of patchFiles) {
    const patchText = readText(patchFile);
    if (shouldSkipPatch(patchText)) {
      skipped++;
      continue;
    }

    const ops = extractPatchOperations(patchText);
    for (const op of ops) {
      const filePath = op.file;
      const moveTo = op.moveTo;
      const body = op.body;

      try {
        if (op.kind === "Update File") {
          const result = applyUpdateFile({ filePath, moveTo, body });
          if (!result.applied) {
            if (skipMissing && result.reason === "missing") {
              opSkipped++;
              continue;
            }
            throw new Error(`Missing file to update: ${filePath}`);
          }
        } else if (op.kind === "Add File") {
          const result = applyAddFile({ filePath, moveTo, body });
          if (!result.applied) opSkipped++;
        } else if (op.kind === "Delete File") {
          const result = applyDeleteFile({ filePath, moveTo, body });
          if (!result.applied) opSkipped++;
        } else {
          throw new Error(`Unsupported op kind: ${op.kind}`);
        }
      } catch (err) {
        if (!skipFailed) throw err;
        opFailed++;
        // eslint-disable-next-line no-console
        console.warn(`Skipped failed op (${op.kind}) for ${filePath}: ${err?.message || err}`);
      }
    }

    applied++;
  }

  // eslint-disable-next-line no-console
  console.log(`Applied ${applied} patch file(s), skipped ${skipped}, skippedOps ${opSkipped}, failedOps ${opFailed}.`);
}

main();
