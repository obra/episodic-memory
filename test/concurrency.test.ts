import { describe, it, expect, vi } from 'vitest';
import { mapWithConcurrency } from '../src/concurrency.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

describe('mapWithConcurrency — worker pool (#204)', () => {
  it('returns results in input order', async () => {
    const delays = [30, 5, 20, 1, 10];
    const results = await mapWithConcurrency(
      delays.map((d, i) => ({ d, i })),
      async ({ d, i }) => { await new Promise(r => setTimeout(r, d)); return i * 10; },
      3
    );
    expect(results).toEqual([0, 10, 20, 30, 40]);
  });

  it('never runs more than `concurrency` items at once (#61)', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      async i => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise(r => setTimeout(r, (i % 4) + 1));
        inFlight--;
        return i;
      },
      4
    );
    expect(peak).toBe(4);
  });

  it('keeps other slots busy while one item is slow, instead of waiting for the whole batch', async () => {
    const slow = deferred();
    const finished: number[] = [];

    const run = mapWithConcurrency(
      [0, 1, 2, 3, 4, 5],
      async i => {
        if (i === 0) await slow.promise; // one long conversation
        finished.push(i);
        return i;
      },
      2
    );

    // With fixed batches of 2, only item 1 could finish while item 0 is
    // stuck. A pool drains every other item through the free slot.
    await vi.waitFor(() => expect(finished).toEqual([1, 2, 3, 4, 5]));

    slow.resolve();
    await expect(run).resolves.toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('handles an empty list and concurrency larger than the list', async () => {
    const processor = vi.fn(async (i: number) => i);
    await expect(mapWithConcurrency([], processor, 8)).resolves.toEqual([]);
    expect(processor).not.toHaveBeenCalled();
    await expect(mapWithConcurrency([7, 8], processor, 8)).resolves.toEqual([7, 8]);
  });
});
