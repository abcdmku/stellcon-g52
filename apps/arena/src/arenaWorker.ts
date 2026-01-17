import { parentPort } from "node:worker_threads";
import type { SimGameOptions } from "./simulate.js";
import { simulateGame } from "./simulate.js";

type WorkerRequest =
  | {
      id: number;
      kind: "simulateGame";
      payload: SimGameOptions;
    };

type WorkerResponse =
  | {
      id: number;
      ok: true;
      result: unknown;
    }
  | {
      id: number;
      ok: false;
      error: string;
    };

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

if (!parentPort) {
  throw new Error("arenaWorker must be run as a worker thread");
}

parentPort.on("message", (message: WorkerRequest) => {
  if (!message || typeof message !== "object" || typeof (message as any).id !== "number") {
    const response: WorkerResponse = { id: -1, ok: false, error: "Invalid worker message" };
    parentPort.postMessage(response);
    return;
  }

  const id = message.id;
  try {
    if (message.kind === "simulateGame") {
      const result = simulateGame(message.payload);
      const response: WorkerResponse = { id, ok: true, result };
      parentPort.postMessage(response);
      return;
    }
    const response: WorkerResponse = { id, ok: false, error: `Unknown worker request kind: ${(message as any).kind}` };
    parentPort.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = { id, ok: false, error: asErrorMessage(error) };
    parentPort.postMessage(response);
  }
});

