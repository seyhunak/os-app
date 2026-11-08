import { ApiError, type BriefDraft } from './api';
import { TimeoutError, withTimeout } from './connectivity';

/** Changes made on this device, waiting to reach the server. */
export type Op =
  | { kind: 'update'; clientId: string; text: string; createdAt: string }
  | { kind: 'archive'; clientId: string; ids: number[] }
  /** A brief written offline. `id` is its temporary, negative id on this device. */
  | { kind: 'brief'; clientId: string; id: number; draft: BriefDraft };

/** Updates queued before ops had a kind. */
type Stored = Op | { kind?: undefined; clientId: string; text: string; createdAt: string };

export interface OutboxStorage {
  load(): Promise<Stored[] | undefined>;
  save(ops: Op[]): Promise<void>;
}

export type FlushResult = 'sent' | 'offline' | 'signed-out';

export const isOfflineError = (error: unknown) => error instanceof TimeoutError || (error instanceof ApiError && error.status === 0);

export const newClientId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

/**
 * A queue kept on the device. Changes are added here first, then sent oldest first, one at a
 * time. A send that can't reach the server stops the run and leaves the rest for next time; one
 * the server refuses for good is dropped, so a bad entry can't block the queue. Sends are safe to
 * repeat: updates carry a client id the server dedupes on, and archiving twice changes nothing.
 */
export function createOutbox({ storage, send, onChange }: { storage: OutboxStorage; send(op: Op): Promise<unknown>; onChange?(): void }) {
  const read = async (): Promise<Op[]> => ((await storage.load()) ?? []).map((op) => (op.kind ? op : { ...op, kind: 'update' as const }));
  // Saves run one after another, so an add can't be lost to a concurrent removal.
  let writes: Promise<unknown> = Promise.resolve();
  const change = <T>(fn: (ops: Op[]) => Op[]): Promise<void> => {
    const next = writes.then(async () => {
      await storage.save(fn(await read()));
      onChange?.();
    });
    writes = next.catch(() => undefined);
    return next;
  };

  let running: Promise<FlushResult> | null = null;

  async function run(): Promise<FlushResult> {
    for (;;) {
      await writes;
      const [next] = await read();
      if (!next) return 'sent';
      try {
        await send(next);
      } catch (error) {
        if (isOfflineError(error)) return 'offline';
        if (error instanceof ApiError && error.status === 401) return 'signed-out';
        // Anything else the server has refused for good.
      }
      await change((ops) => ops.filter((op) => op.clientId !== next.clientId));
    }
  }

  return {
    list: read,
    /** Drops changes that are no longer wanted, such as a draft deleted before it synced. */
    remove: (match: (op: Op) => boolean) => change((ops) => ops.filter((op) => !match(op))),
    /** Adds a change. One already queued with the same client id isn't added twice. */
    add: (op: Op) => change((ops) => (ops.some((o) => o.clientId === op.clientId) ? ops : [...ops, op])),
    /** Sends everything queued. Calls made while a run is going join that run. */
    flush(): Promise<FlushResult> {
      running ??= run().finally(() => {
        running = null;
      });
      return running;
    },
  };
}

export type Outbox = ReturnType<typeof createOutbox>;

/** How long a save waits for the server before saying "saved on this device". */
export const SAVE_WAIT_MS = 4_000;

/**
 * Queues a change, then gives the server a short while to take it. It never waits longer than
 * `waitMs`, and doesn't wait at all while offline. Returns whether the change is still queued.
 */
export async function queueAndSend(outbox: Outbox, op: Op, online: boolean, waitMs = SAVE_WAIT_MS): Promise<boolean> {
  await outbox.add(op);
  const sending = outbox.flush();
  if (online) await withTimeout(sending, waitMs).catch(() => undefined);
  else void sending.catch(() => undefined);
  return (await outbox.list()).some((o) => o.clientId === op.clientId);
}

/** Brief ids waiting to be archived, so they stay hidden before the server hears about it. */
export const archivedIds = (ops: Op[]) => new Set(ops.flatMap((op) => (op.kind === 'archive' ? op.ids : [])));
