const DEFAULT_COMMAND = 'episodic-memory';
const DEFAULT_SUMMARY_LIMIT = 10;
function optionString(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
function optionPositiveInteger(value, fallback) {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number.parseInt(value, 10);
        if (Number.isInteger(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return fallback;
}
async function log(input, level, message, extra) {
    try {
        await input.client?.app?.log?.({
            body: {
                service: 'episodic-memory',
                level,
                message,
                extra,
            },
        });
    }
    catch {
        // Logging is best-effort; failed sync attempts still surface in the
        // episodic-memory background log.
    }
}
export async function server(input, options = {}) {
    const command = optionString(options.command, DEFAULT_COMMAND);
    const summaryLimit = optionPositiveInteger(options.summaryLimit, DEFAULT_SUMMARY_LIMIT);
    return {
        event: async ({ event }) => {
            if (event.type !== 'session.idle') {
                return;
            }
            const result = await input.$ `${command} sync --background --only opencode --summary-limit ${summaryLimit}`
                .quiet()
                .nothrow();
            if (result.exitCode === 0) {
                await log(input, 'info', 'Started opencode conversation sync', { summaryLimit });
            }
            else {
                await log(input, 'warn', 'Failed to start opencode conversation sync', {
                    exitCode: result.exitCode,
                    stderr: result.stderr?.toString('utf-8'),
                });
            }
        },
    };
}
export default {
    id: 'episodic-memory',
    server,
};
