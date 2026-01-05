import fs from "node:fs";
import path from "node:path";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonLines(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function sanitizeBasename(value) {
  return value.replace(/[^\w.-]+/g, "_");
}

function extractPatchFiles(patchText) {
  if (typeof patchText !== "string") return [];
  const out = [];
  const re = /^\*\*\* (Add File|Update File|Delete File|Move to):\s+(.+)$/gm;
  let match;
  while ((match = re.exec(patchText))) out.push(match[2].trim());
  return out;
}

function normalizeCommand(command) {
  return String(command || "").replace(/\s+/g, " ").trim();
}

function parseShellArgs(payload) {
  let args = payload?.arguments;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return null;
    }
  }
  return args || null;
}

function sessionSummary(sessionPath, lines) {
  const patches = [];
  const touchedFiles = new Set();
  const gitCommands = [];
  const destructiveGitCommands = [];

  let sessionMeta = null;

  for (const entry of lines) {
    if (!sessionMeta && entry.type === "session_meta") {
      sessionMeta = {
        id: entry?.payload?.id ?? null,
        timestamp: entry?.payload?.timestamp ?? null,
        cwd: entry?.payload?.cwd ?? null,
        originator: entry?.payload?.originator ?? null,
      };
      continue;
    }

    if (entry.type !== "response_item") continue;
    const payload = entry.payload;
    if (!payload) continue;

    if (payload.type === "custom_tool_call" && payload.name === "apply_patch") {
      const patchText = payload.input;
      const files = extractPatchFiles(patchText);
      for (const f of files) touchedFiles.add(f);
      patches.push({
        timestamp: entry.timestamp ?? null,
        bytes: typeof patchText === "string" ? patchText.length : 0,
        files,
        patchText,
      });
      continue;
    }

    if (payload.type === "function_call" && payload.name === "shell_command") {
      const args = parseShellArgs(payload);
      const cmd = normalizeCommand(args?.command);
      if (!cmd) continue;
      if (!/\bgit\b/i.test(cmd)) continue;
      gitCommands.push(cmd);
      if (/\bgit\s+(restore|checkout|reset|clean)\b/i.test(cmd)) destructiveGitCommands.push(cmd);
    }
  }

  return {
    sessionPath,
    sessionFile: path.basename(sessionPath),
    meta: sessionMeta,
    applyPatchCount: patches.length,
    touchedFiles: Array.from(touchedFiles).sort(),
    gitCommands: Array.from(new Set(gitCommands)).sort(),
    destructiveGitCommands: Array.from(new Set(destructiveGitCommands)).sort(),
    patches,
  };
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    // eslint-disable-next-line no-console
    console.error(
      "Usage: node tools/recovery/extract-codex-patches.mjs <session.jsonl> [more sessions...]\n" +
        "Example: node tools/recovery/extract-codex-patches.mjs C:/Users/.../rollout-....jsonl"
    );
    process.exit(2);
  }

  const outputRoot = path.resolve("tools", "recovery", "codex-patches");
  ensureDir(outputRoot);

  const summaries = [];

  for (const sessionPathRaw of args) {
    const sessionPath = sessionPathRaw.replaceAll("\\", "/");
    if (!fs.existsSync(sessionPath)) {
      // eslint-disable-next-line no-console
      console.warn(`Missing session file: ${sessionPath}`);
      continue;
    }

    const lines = readJsonLines(sessionPath);
    const summary = sessionSummary(sessionPath, lines);
    summaries.push({
      sessionFile: summary.sessionFile,
      meta: summary.meta,
      applyPatchCount: summary.applyPatchCount,
      touchedFiles: summary.touchedFiles,
      destructiveGitCommands: summary.destructiveGitCommands,
    });

    const sessionOutDir = path.join(outputRoot, sanitizeBasename(summary.sessionFile));
    ensureDir(sessionOutDir);

    const sessionSummaryPath = path.join(sessionOutDir, "summary.json");
    fs.writeFileSync(
      sessionSummaryPath,
      JSON.stringify(
        {
          sessionFile: summary.sessionFile,
          meta: summary.meta,
          applyPatchCount: summary.applyPatchCount,
          touchedFiles: summary.touchedFiles,
          gitCommands: summary.gitCommands,
          destructiveGitCommands: summary.destructiveGitCommands,
        },
        null,
        2
      )
    );

    summary.patches.forEach((patch, idx) => {
      const outName = `${String(idx + 1).padStart(3, "0")}-${patch.timestamp ? sanitizeBasename(patch.timestamp) : "unknown"}.patch`;
      fs.writeFileSync(path.join(sessionOutDir, outName), patch.patchText);
    });
  }

  const indexPath = path.join(outputRoot, "index.json");
  fs.writeFileSync(indexPath, JSON.stringify({ generatedAt: new Date().toISOString(), sessions: summaries }, null, 2));

  // eslint-disable-next-line no-console
  console.log(`Wrote ${summaries.length} session(s) to ${outputRoot}`);
  // eslint-disable-next-line no-console
  console.log(`Index: ${indexPath}`);
}

main();

