import { parseArgs } from 'node:util';
import fs from 'node:fs';
import { formatConversationWithMetadata, formatConversationAsHTML } from './show.js';
import { PAGINATION_DEFAULTS } from './constants.js';

const args = parseArgs({
  args: process.argv.slice(2),
  options: {
    format: {
      type: 'string',
      short: 'f',
      default: 'markdown'
    },
    'start-line': {
      type: 'string',
      short: 's'
    },
    'end-line': {
      type: 'string',
      short: 'e'
    },
    'page-size': {
      type: 'string',
      default: String(PAGINATION_DEFAULTS.PAGE_SIZE)
    },
    page: {
      type: 'string',
      short: 'p'
    },
    info: {
      type: 'boolean',
      short: 'i',
      default: false
    },
    help: {
      type: 'boolean',
      short: 'h',
      default: false
    }
  },
  allowPositionals: true,
});

function showHelp(): void {
  console.log(`
Usage: episodic-memory show [options] <file>

Options:
  -f, --format <type>     Output format: markdown (default) or html
  -s, --start-line <n>    Start reading from line n (1-indexed)
  -e, --end-line <n>      Stop reading at line n (1-indexed)
  -p, --page <n>          Show page n (use with --page-size)
  --page-size <n>         Lines per page (default: ${PAGINATION_DEFAULTS.PAGE_SIZE})
  -i, --info              Show file info without content
  -h, --help              Show this help message

Examples:
  # Show first 50 lines
  episodic-memory show conversation.jsonl --start-line 1 --end-line 50

  # Show page 3 with 50 lines per page
  episodic-memory show conversation.jsonl --page 3 --page-size 50

  # Show file info only
  episodic-memory show conversation.jsonl --info
`);
}

function showInfo(filePath: string, jsonl: string): void {
  const lines = jsonl.trim().split('\n').filter(l => l.trim());
  const totalLines = lines.length;
  const sizeKB = Math.round(jsonl.length / 1024 * 10) / 10;
  const sizeMB = Math.round(jsonl.length / 1024 / 1024 * 100) / 100;

  const pageSize = PAGINATION_DEFAULTS.PAGE_SIZE;
  const totalPages = Math.ceil(totalLines / pageSize);

  console.log(`
Conversation Info:
  File: ${filePath}
  Size: ${sizeMB > 1 ? sizeMB + ' MB' : sizeKB + ' KB'}
  Lines: ${totalLines} messages

Suggested pagination (${pageSize} lines per page):
`);

  for (let i = 0; i < Math.min(totalPages, 10); i++) {
    const start = i * pageSize + 1;
    const end = Math.min((i + 1) * pageSize, totalLines);
    console.log(`  Page ${i + 1}: --start-line ${start} --end-line ${end}`);
  }

  if (totalPages > 10) {
    console.log(`  ... (${totalPages - 10} more pages)`);
  }
}

function main(): void {
  if (args.values.help) {
    showHelp();
    process.exit(0);
  }

  const filePath = args.positionals[0];
  if (!filePath) {
    console.error('Error: No file specified');
    showHelp();
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const jsonl = fs.readFileSync(filePath, 'utf-8');

  // Info mode - show statistics only
  if (args.values.info) {
    showInfo(filePath, jsonl);
    return;
  }

  // Calculate line range
  const pageSize = parseInt(args.values['page-size'] || String(PAGINATION_DEFAULTS.PAGE_SIZE), 10);
  let startLine: number | undefined;
  let endLine: number | undefined;

  if (args.values.page) {
    const page = parseInt(args.values.page, 10);
    startLine = (page - 1) * pageSize + 1;
    endLine = page * pageSize;
  } else {
    startLine = args.values['start-line']
      ? parseInt(args.values['start-line'], 10)
      : undefined;
    endLine = args.values['end-line']
      ? parseInt(args.values['end-line'], 10)
      : undefined;
  }

  // Check for large file and warn
  const allLines = jsonl.trim().split('\n').filter(l => l.trim());
  const totalLines = allLines.length;
  const sizeKB = jsonl.length / 1024;

  const isLargeFile = totalLines > PAGINATION_DEFAULTS.WARN_THRESHOLD_LINES ||
                      sizeKB > PAGINATION_DEFAULTS.WARN_THRESHOLD_KB;

  if (isLargeFile && startLine === undefined && endLine === undefined) {
    console.error(`
Warning: This conversation has ${totalLines} lines (${Math.round(sizeKB)} KB).
Showing first ${PAGINATION_DEFAULTS.AUTO_TRUNCATE_LINES} lines.
Use --page or --start-line/--end-line for more, or --info for file details.
`);
    startLine = 1;
    endLine = PAGINATION_DEFAULTS.AUTO_TRUNCATE_LINES;
  }

  // Format output
  if (args.values.format === 'html') {
    // HTML doesn't support pagination yet
    console.log(formatConversationAsHTML(jsonl));
  } else {
    const result = formatConversationWithMetadata(jsonl, startLine, endLine, pageSize);
    console.log(result.content);

    // Show pagination footer if paginated
    if (startLine !== undefined || endLine !== undefined) {
      const meta = result.metadata;
      console.log(`\n---`);
      console.log(`Showing lines ${meta.startLine}-${meta.endLine} of ${meta.totalLines}`);
      if (meta.hasMore && meta.suggestedNextRange) {
        console.log(`Next: --start-line ${meta.suggestedNextRange.start} --end-line ${meta.suggestedNextRange.end}`);
      }
    }
  }
}

main();
