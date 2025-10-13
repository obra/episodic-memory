#!/usr/bin/env node
import { verifyIndex, repairIndex } from './verify.js';
import { indexSession, indexUnprocessed, indexConversations } from './indexer.js';
import { initDatabase } from './db.js';
import { getDbPath, getArchiveDir } from './paths.js';
import fs from 'fs';
import path from 'path';

const command = process.argv[2];

// Parse --concurrency flag from remaining args
function getConcurrency(): number {
  const concurrencyIndex = process.argv.findIndex(arg => arg === '--concurrency' || arg === '-c');
  if (concurrencyIndex !== -1 && process.argv[concurrencyIndex + 1]) {
    const value = parseInt(process.argv[concurrencyIndex + 1], 10);
    if (value >= 1 && value <= 16) return value;
  }
  return 1; // default
}

// Parse --no-summaries flag
function getNoSummaries(): boolean {
  return process.argv.includes('--no-summaries');
}

const concurrency = getConcurrency();
const noSummaries = getNoSummaries();

async function main() {
  try {
    switch (command) {
      case 'index-session':
        const sessionId = process.argv[3];
        if (!sessionId) {
          console.error('Usage: index-cli index-session <session-id>');
          process.exit(1);
        }
        await indexSession(sessionId, concurrency, noSummaries);
        break;

      case 'index-cleanup':
        await indexUnprocessed(concurrency, noSummaries);
        break;

      case 'verify':
        console.log('Verifying conversation index...');
        const issues = await verifyIndex();

        console.log('\n=== Verification Results ===');
        console.log(`Missing summaries: ${issues.missing.length}`);
        console.log(`Orphaned entries: ${issues.orphaned.length}`);
        console.log(`Outdated files: ${issues.outdated.length}`);
        console.log(`Corrupted files: ${issues.corrupted.length}`);

        if (issues.missing.length > 0) {
          console.log('\nMissing summaries:');
          issues.missing.forEach(m => console.log(`  ${m.path}`));
        }

        if (issues.missing.length + issues.orphaned.length + issues.outdated.length + issues.corrupted.length > 0) {
          console.log('\nRun with --repair to fix these issues.');
          process.exit(1);
        } else {
          console.log('\n✅ Index is healthy!');
        }
        break;

      case 'repair':
        console.log('Verifying conversation index...');
        const repairIssues = await verifyIndex();

        if (repairIssues.missing.length + repairIssues.orphaned.length + repairIssues.outdated.length > 0) {
          await repairIndex(repairIssues);
        } else {
          console.log('✅ No issues to repair!');
        }
        break;

      case 'rebuild':
        console.log('Rebuilding entire index...');

        // Delete database
        const dbPath = getDbPath();
        if (fs.existsSync(dbPath)) {
          fs.unlinkSync(dbPath);
          console.log('Deleted existing database');
        }

        // Delete all summary files
        const archiveDir = getArchiveDir();
        if (fs.existsSync(archiveDir)) {
          const projects = fs.readdirSync(archiveDir);
          for (const project of projects) {
            const projectPath = path.join(archiveDir, project);
            if (!fs.statSync(projectPath).isDirectory()) continue;

            const summaries = fs.readdirSync(projectPath).filter(f => f.endsWith('-summary.txt'));
            for (const summary of summaries) {
              fs.unlinkSync(path.join(projectPath, summary));
            }
          }
          console.log('Deleted all summary files');
        }

        // Re-index everything
        console.log('Re-indexing all conversations...');
        await indexConversations(undefined, undefined, concurrency, noSummaries);
        break;

      case 'index-all':
      default:
        await indexConversations(undefined, undefined, concurrency, noSummaries);
        break;
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
