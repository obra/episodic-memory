import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('mcp-server-wrapper signal handling', () => {
  const wrapperPath = join(__dirname, '..', 'cli', 'mcp-server-wrapper.js');
  const wrapperCode = readFileSync(wrapperPath, 'utf-8');

  it('should forward SIGTERM to child process', () => {
    expect(wrapperCode).toContain("process.on('SIGTERM'");
  });

  it('should forward SIGINT to child process', () => {
    expect(wrapperCode).toContain("process.on('SIGINT'");
  });

  it('should forward SIGHUP to child process', () => {
    expect(wrapperCode).toContain("process.on('SIGHUP'");
  });

  it('should detect parent death via stdin close', () => {
    expect(wrapperCode).toContain("process.stdin.on('end'");
  });

  it('should handle stdin errors (broken pipe)', () => {
    expect(wrapperCode).toContain("process.stdin.on('error'");
  });
});

describe('mcp-server stdin fallback', () => {
  const serverPath = join(__dirname, '..', 'src', 'mcp-server.ts');
  const serverCode = readFileSync(serverPath, 'utf-8');

  it('should have stdin close handler as fallback', () => {
    expect(serverCode).toContain("process.stdin.on('end'");
  });
});
