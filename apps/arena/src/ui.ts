import { startArenaUiServer, type ArenaUiOptions } from "./uiServer.js";

export async function runArenaUi(options: ArenaUiOptions) {
  await startArenaUiServer(options);
}

