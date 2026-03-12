#!/usr/bin/env node

/**
 * SessionEnd Hook: Extract facts from session conversations
 *
 * Environment:
 *   SESSION_ID - current session ID
 *   CWD / PROJECT_DIR - current project path
 */

import { initDatabase } from '../dist/db.js';
import { runFactExtraction } from '../dist/fact-extractor.js';

async function main() {
  const sessionId = process.env.SESSION_ID;
  const project = process.env.CWD || process.env.PROJECT_DIR || process.cwd();

  if (!sessionId) {
    console.log('fact-extract: SESSION_ID not set, skipping');
    process.exit(0);
  }

  console.log(`fact-extract: Processing session ${sessionId}`);

  try {
    const db = initDatabase();
    const result = await runFactExtraction(db, sessionId, project);
    console.log(`fact-extract: Extracted ${result.extracted} facts, saved ${result.saved}`);
    db.close();
  } catch (error) {
    console.error('fact-extract: Error:', error instanceof Error ? error.message : error);
    // Don't block session end on extraction failure
    process.exit(0);
  }
}

main();
