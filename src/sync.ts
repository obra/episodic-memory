import fs from 'fs';
import path from 'path';

const EXCLUSION_MARKERS = [
  '<INSTRUCTIONS-TO-EPISODIC-MEMORY>DO NOT INDEX THIS CHAT</INSTRUCTIONS-TO-EPISODIC-MEMORY>',
  'Only use NO_INSIGHTS_FOUND',
  'Context: This summary will be shown in a list to help users and Claude choose which conversations are relevant',
];

function shouldSkipConversation(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return EXCLUSION_MARKERS.some(marker => content.includes(marker));
  } catch (error) {
    // If we can't read the file, don't skip it
    return false;
  }
}

export interface SyncResult {
  copied: number;
  skipped: number;
  indexed: number;
  errors: Array<{ file: string; error: string }>;
}

export interface SyncOptions {
  skipIndex?: boolean;
}

function copyIfNewer(src: string, dest: string): boolean {
  // Ensure destination directory exists
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // Check if destination exists and is up-to-date
  if (fs.existsSync(dest)) {
    const srcStat = fs.statSync(src);
    const destStat = fs.statSync(dest);
    if (destStat.mtimeMs >= srcStat.mtimeMs) {
      return false; // Dest is current, skip
    }
  }

  // Atomic copy: temp file + rename
  const tempDest = dest + '.tmp.' + process.pid;
  fs.copyFileSync(src, tempDest);
  fs.renameSync(tempDest, dest); // Atomic on same filesystem
  return true;
}

export async function syncConversations(
  sourceDir: string,
  destDir: string,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const result: SyncResult = {
    copied: 0,
    skipped: 0,
    indexed: 0,
    errors: []
  };

  // Ensure source directory exists
  if (!fs.existsSync(sourceDir)) {
    return result;
  }

  // Collect files to index
  const filesToIndex: string[] = [];

  // Walk source directory
  const projects = fs.readdirSync(sourceDir);

  for (const project of projects) {
    const projectPath = path.join(sourceDir, project);
    const stat = fs.statSync(projectPath);

    if (!stat.isDirectory()) continue;

    const files = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));

    for (const file of files) {
      const srcFile = path.join(projectPath, file);
      const destFile = path.join(destDir, project, file);

      try {
        const wasCopied = copyIfNewer(srcFile, destFile);
        if (wasCopied) {
          result.copied++;
          filesToIndex.push(destFile);
        } else {
          result.skipped++;
        }
      } catch (error) {
        result.errors.push({
          file: srcFile,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  // Index copied files (unless skipIndex is set)
  if (!options.skipIndex && filesToIndex.length > 0) {
    const { initDatabase, insertExchange } = await import('./db.js');
    const { initEmbeddings, generateExchangeEmbedding } = await import('./embeddings.js');
    const { parseConversation } = await import('./parser.js');

    const db = initDatabase();
    await initEmbeddings();

    for (const file of filesToIndex) {
      try {
        // Check for DO NOT INDEX marker
        if (shouldSkipConversation(file)) {
          continue; // Skip indexing but file is already copied
        }

        const project = path.basename(path.dirname(file));
        const exchanges = await parseConversation(file, project, file);

        for (const exchange of exchanges) {
          const toolNames = exchange.toolCalls?.map(tc => tc.toolName);
          const embedding = await generateExchangeEmbedding(
            exchange.userMessage,
            exchange.assistantMessage,
            toolNames
          );
          insertExchange(db, exchange, embedding, toolNames);
        }

        result.indexed++;
      } catch (error) {
        result.errors.push({
          file,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    db.close();
  }

  return result;
}
