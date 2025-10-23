import { getIndexStats, formatStats } from './stats.js';
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: episodic-memory stats

Display statistics about the indexed conversation archive.

Shows:
- Total conversations and exchanges
- Conversations with/without AI summaries
- Date range coverage
- Project breakdown
- Top projects by conversation count

EXAMPLES:
  # Show index statistics
  episodic-memory stats
`);
    process.exit(0);
}
getIndexStats()
    .then(stats => {
    console.log(formatStats(stats));
})
    .catch(error => {
    console.error('Error getting stats:', error);
    process.exit(1);
});
