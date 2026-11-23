/**
 * Run `processor` over `items` with at most `concurrency` calls in flight,
 * returning results in input order.
 *
 * A worker pool, not fixed batches: each worker pulls the next item as soon
 * as its current one finishes. Fixed batches (`await Promise.all(slice)`)
 * left every other slot idle until the slowest item in the slice finished,
 * so one long hierarchical summary stalled an 8-wide backfill for tens of
 * minutes (#204). Peak concurrency is unchanged, which is what keeps the
 * number of live summarizer subprocesses bounded (#61).
 */
export declare function mapWithConcurrency<T, R>(items: T[], processor: (item: T) => Promise<R>, concurrency: number): Promise<R[]>;
