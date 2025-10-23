import { readFileSync } from 'fs';
import { formatConversationAsMarkdown, formatConversationAsHTML } from './show.js';
const args = process.argv.slice(2);
// Parse arguments
let format = 'markdown';
let filePath = null;
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--format' || arg === '-f') {
        format = args[++i];
    }
    else if (arg === '--help' || arg === '-h') {
        console.log(`
Usage: episodic-memory show [OPTIONS] <file>

Display a conversation from a JSONL file in a human-readable format.

OPTIONS:
  --format, -f FORMAT    Output format: markdown or html (default: markdown)
  --help, -h             Show this help

EXAMPLES:
  # Show conversation as markdown
  episodic-memory show conversation.jsonl

  # Generate HTML for browser viewing
  episodic-memory show --format html conversation.jsonl > output.html

  # View with pipe
  episodic-memory show conversation.jsonl | less
`);
        process.exit(0);
    }
    else if (!filePath) {
        filePath = arg;
    }
}
if (!filePath) {
    console.error('Error: No file specified');
    console.error('Usage: episodic-memory show [OPTIONS] <file>');
    console.error('Try: episodic-memory show --help');
    process.exit(1);
}
try {
    const jsonl = readFileSync(filePath, 'utf-8');
    if (format === 'html') {
        console.log(formatConversationAsHTML(jsonl));
    }
    else {
        console.log(formatConversationAsMarkdown(jsonl));
    }
}
catch (error) {
    console.error(`Error reading file: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
