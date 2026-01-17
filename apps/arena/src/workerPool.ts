import { Worker } from "node:worker_threads";

type WorkerRequest = {
  id: number;
  kind: "simulateGame";
  payload: unknown;
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

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type WorkerSlot = {
  worker: Worker;
  busy: boolean;
};

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

export class WorkerPool {
  private readonly workerUrl: URL;
  private readonly slots: WorkerSlot[];
  private readonly pending = new Map<number, Pending>();
  private readonly queue: WorkerRequest[] = [];
  private nextId = 1;
  private fatalError: Error | null = null;
  private closed = false;

  constructor(workerUrl: URL, size: number) {
    this.workerUrl = workerUrl;
    this.slots = Array.from({ length: Math.max(1, Math.floor(size)) }).map(() => ({
      worker: new Worker(this.workerUrl),
      busy: false,
    }));

    for (const slot of this.slots) {
      slot.worker.on("message", (message: WorkerResponse) => this.onMessage(slot, message));
      slot.worker.on("error", (error) => this.failAll(error));
      slot.worker.on("exit", (code) => {
        if (code !== 0) {
          this.failAll(new Error(`Worker exited with code ${code}`));
        }
      });
    }
  }

  get size() {
    return this.slots.length;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    const slots = [...this.slots];
    this.slots.length = 0;
    this.queue.length = 0;

    await Promise.allSettled(
      slots.map(async (slot) => {
        try {
          await slot.worker.terminate();
        } catch {}
      })
    );
  }

  run<TPayload, TResult>(kind: WorkerRequest["kind"], payload: TPayload): Promise<TResult> {
    if (this.closed) {
      return Promise.reject(new Error("WorkerPool is closed"));
    }
    if (this.fatalError) {
      return Promise.reject(this.fatalError);
    }

    const id = this.nextId++;
    const request: WorkerRequest = { id, kind, payload };
    const promise = new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as Pending["resolve"], reject });
    });

    this.queue.push(request);
    this.dispatch();
    return promise;
  }

  private onMessage(slot: WorkerSlot, message: WorkerResponse) {
    slot.busy = false;
    const pending = this.pending.get(message?.id);
    if (!pending) {
      this.dispatch();
      return;
    }
    this.pending.delete(message.id);

    if (message.ok === true) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error(message.error));
    }

    this.dispatch();
  }

  private dispatch() {
    if (this.closed) return;
    if (this.fatalError) return;

    for (const slot of this.slots) {
      if (slot.busy) continue;
      const request = this.queue.shift();
      if (!request) break;
      slot.busy = true;
      slot.worker.postMessage(request);
    }
  }

  private failAll(error: unknown) {
    if (this.fatalError) return;
    this.fatalError = asError(error);

    for (const [, pending] of this.pending.entries()) {
      pending.reject(this.fatalError);
    }
    this.pending.clear();
    this.queue.length = 0;
  }
}
