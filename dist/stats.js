import Database from 'better-sqlite3';
import { getDbPath } from './paths.js';
export async function getIndexStats(dbPath) {
    const resolvedDbPath = dbPath || getDbPath();
    // Check if database exists
    const fs = await import('fs');
    if (!fs.existsSync(resolvedDbPath)) {
        return {
            totalConversations: 0,
            conversationsWithSummaries: 0,
            conversationsWithoutSummaries: 0,
            totalExchanges: 0,
            projectCount: 0,
        };
    }
    const db = new Database(resolvedDbPath, { readonly: true });
    try {
        // Check if tables exist
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        const hasExchanges = tables.some(t => t.name === 'exchanges');
        if (!hasExchanges) {
            // Empty database
            return {
                totalConversations: 0,
                conversationsWithSummaries: 0,
                conversationsWithoutSummaries: 0,
                totalExchanges: 0,
                projectCount: 0,
            };
        }
        // Total conversations
        const totalConversations = db.prepare('SELECT COUNT(DISTINCT archive_path) as count FROM exchanges').get();
        // Check for summaries (these are files, not DB fields)
        const fs = await import('fs');
        const conversationPaths = db.prepare('SELECT DISTINCT archive_path FROM exchanges').all();
        let withSummariesCount = 0;
        for (const { archive_path } of conversationPaths) {
            const summaryPath = archive_path.replace('.jsonl', '-summary.txt');
            if (fs.existsSync(summaryPath)) {
                withSummariesCount++;
            }
        }
        // Total exchanges
        const totalExchanges = db.prepare('SELECT COUNT(*) as count FROM exchanges').get();
        // Date range
        const dateRange = db.prepare('SELECT MIN(timestamp) as earliest, MAX(timestamp) as latest FROM exchanges').get();
        // Project counts
        const projectCount = db.prepare('SELECT COUNT(DISTINCT project) as count FROM exchanges').get();
        // Top 10 projects
        const topProjects = db.prepare(`
      SELECT project, COUNT(DISTINCT archive_path) as count
      FROM exchanges
      GROUP BY project
      ORDER BY count DESC
      LIMIT 10
    `).all();
        return {
            totalConversations: totalConversations.count,
            conversationsWithSummaries: withSummariesCount,
            conversationsWithoutSummaries: totalConversations.count - withSummariesCount,
            totalExchanges: totalExchanges.count,
            dateRange: dateRange?.earliest ? {
                earliest: dateRange.earliest,
                latest: dateRange.latest,
            } : undefined,
            projectCount: projectCount.count,
            topProjects,
        };
    }
    finally {
        db.close();
    }
}
export function formatStats(stats) {
    let output = 'Episodic Memory Index Statistics\n';
    output += '='.repeat(50) + '\n\n';
    output += `Total Conversations: ${stats.totalConversations.toLocaleString()}\n`;
    output += `Total Exchanges: ${stats.totalExchanges.toLocaleString()}\n\n`;
    output += `With Summaries: ${stats.conversationsWithSummaries.toLocaleString()}\n`;
    output += `Without Summaries: ${stats.conversationsWithoutSummaries.toLocaleString()}\n`;
    if (stats.conversationsWithoutSummaries > 0) {
        const percentage = ((stats.conversationsWithoutSummaries / stats.totalConversations) * 100).toFixed(1);
        output += `  (${percentage}% missing summaries)\n`;
    }
    output += '\n';
    if (stats.dateRange) {
        output += `Date Range:\n`;
        output += `  Earliest: ${new Date(stats.dateRange.earliest).toLocaleDateString()}\n`;
        output += `  Latest: ${new Date(stats.dateRange.latest).toLocaleDateString()}\n\n`;
    }
    output += `Unique Projects: ${stats.projectCount.toLocaleString()}\n\n`;
    if (stats.topProjects && stats.topProjects.length > 0) {
        output += `Top Projects by Conversation Count:\n`;
        for (const { project, count } of stats.topProjects) {
            const displayProject = project || '(unknown)';
            output += `  ${count.toString().padStart(4)} - ${displayProject}\n`;
        }
    }
    return output;
}
