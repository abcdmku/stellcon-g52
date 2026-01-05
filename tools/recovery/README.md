# Recovery helpers

This folder contains small scripts to help recover work from local Codex session logs.

## Extract Codex patches from session logs

Creates patch files for every `apply_patch` tool call found in the provided `.jsonl` sessions.

Output folder: `tools/recovery/codex-patches/`

Run:

```powershell
node tools/recovery/extract-codex-patches.mjs `
  "C:\Users\cafal\.codex\sessions\2026\01\04\rollout-....jsonl"
```

