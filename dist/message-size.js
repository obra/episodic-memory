// Real conversational turns are ~1.6 KB median. A single message in the
// hundreds-of-KB-to-MB range is not a turn — it is a foreign summarizer agent's
// prompt with a whole conversation transcript pasted in, which otherwise indexes
// as one giant exchange that dominates the DB and pollutes vector search (#139).
// 256 KB is ~160x the median: far above any genuine turn (including a large code
// paste) yet well under those payloads. Skipping (not truncating) drops noise
// with no real loss. Cooperative marker opt-out (SUMMARIZER_CONTEXT_MARKER) still
// applies for our own summarizer; this is the non-cooperative backstop.
export const DEFAULT_MAX_MESSAGE_BYTES = 256 * 1024;
export function getMaxMessageBytes(env = process.env) {
    const raw = env.EPISODIC_MEMORY_MAX_MESSAGE_BYTES;
    const parsed = raw !== undefined ? Number.parseInt(raw, 10) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_MESSAGE_BYTES;
}
export function isOversizeExchange(exchange, maxBytes) {
    return (Buffer.byteLength(exchange.userMessage ?? '', 'utf8') > maxBytes ||
        Buffer.byteLength(exchange.assistantMessage ?? '', 'utf8') > maxBytes);
}
