import type {
  ProviderBatchInput,
  ProviderBatchResult,
  TranslationProvider,
} from './orchestrator';

type Job = { signal: AbortSignal; run(): Promise<void> };
type Queue = {
  active: number;
  nextStart: number;
  jobs: Job[];
  timer?: ReturnType<typeof setTimeout>;
};
type Flight = {
  controller: AbortController;
  promise: Promise<ProviderBatchResult>;
  readers: number;
};

/** Shared by all sessions in one worker. Every service attempt uses this queue. */
export function createRequestControl(concurrency = 2, intervalMs = 125) {
  const queues = new Map<string, Queue>();
  const flights = new Map<string, Flight>();
  const preparing = new Map<string, Promise<void>>();
  const anonymousIds = new WeakMap<TranslationProvider, string>();
  let nextId = 0;

  function drain(queue: Queue) {
    clearTimeout(queue.timer);
    queue.jobs = queue.jobs.filter((job) => !job.signal.aborted);
    if (!queue.jobs.length || queue.active >= concurrency) return;
    const delay = queue.nextStart - Date.now();
    if (delay > 0) {
      queue.timer = setTimeout(() => drain(queue), delay);
      return;
    }
    const job = queue.jobs.shift();
    if (!job) return;
    queue.active += 1;
    queue.nextStart = Date.now() + intervalMs;
    void job.run().finally(() => {
      queue.active -= 1;
      drain(queue);
    });
    drain(queue);
  }

  return async function execute(
    provider: TranslationProvider,
    input: ProviderBatchInput,
    run: (signal: AbortSignal) => Promise<ProviderBatchResult>,
  ): Promise<ProviderBatchResult> {
    input.signal?.throwIfAborted();
    let providerId = provider.id ?? anonymousIds.get(provider);
    if (!providerId) {
      providerId = `anonymous-${nextId++}`;
      anonymousIds.set(provider, providerId);
    }
    // Preserve viewport/batch arrival order while asynchronous hashing finishes.
    const previous = preparing.get(providerId);
    let releasePreparation = () => {};
    const preparation = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    preparing.set(providerId, preparation);
    await previous;
    try {
      const payload = JSON.stringify({
        providerId,
        source: input.sourceLanguage,
        target: input.targetLanguage,
        quality: input.quality,
        texts: input.units.map((unit) => unit.text),
        context: input.context
          ? {
              title: input.context.pageTitle,
              texts: input.context.units.map((unit) => unit.text),
            }
          : undefined,
      });
      const key = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(payload),
          ),
        ),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('');
      input.signal?.throwIfAborted();
      let flight = flights.get(key);
      if (!flight || flight.controller.signal.aborted) {
        const controller = new AbortController();
        const queue = queues.get(providerId) ?? {
          active: 0,
          nextStart: 0,
          jobs: [],
        };
        queues.set(providerId, queue);
        const promise = new Promise<ProviderBatchResult>((resolve, reject) => {
          const onAbort = () => {
            reject(controller.signal.reason);
            drain(queue);
          };
          controller.signal.addEventListener('abort', onAbort, { once: true });
          queue.jobs.push({
            signal: controller.signal,
            async run() {
              try {
                const results = await run(controller.signal);
                // Store by position so another page's stable ids can share the result.
                resolve(
                  results.map((result) => ({
                    ...result,
                    id: String(
                      input.units.findIndex((unit) => unit.id === result.id),
                    ),
                  })),
                );
              } catch (error) {
                reject(error);
              } finally {
                controller.signal.removeEventListener('abort', onAbort);
              }
            },
          });
          drain(queue);
        });
        flight = { controller, promise, readers: 0 };
        flights.set(key, flight);
        const created = flight;
        void promise
          .then(
            () => {},
            () => {},
          )
          .finally(() => {
            if (flights.get(key) === created) flights.delete(key);
          });
      }
      const shared = flight;
      shared.readers += 1;
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = () => {
          if (settled) return false;
          settled = true;
          input.signal?.removeEventListener('abort', onAbort);
          shared.readers -= 1;
          if (shared.readers === 0) shared.controller.abort();
          return true;
        };
        const onAbort = () => {
          if (finish()) reject(input.signal?.reason);
        };
        input.signal?.addEventListener('abort', onAbort, { once: true });
        if (input.signal?.aborted) onAbort();
        void shared.promise.then(
          (results) => {
            if (finish())
              resolve(
                results.flatMap((result) => {
                  const unit = input.units[Number(result.id)];
                  return unit ? [{ ...result, id: unit.id }] : [];
                }),
              );
          },
          (error: unknown) => {
            if (finish()) reject(error);
          },
        );
      });
    } finally {
      releasePreparation();
      if (preparing.get(providerId) === preparation)
        preparing.delete(providerId);
    }
  };
}
