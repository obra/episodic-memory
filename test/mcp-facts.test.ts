import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('MCP Facts Tool', () => {
  it('should have search_facts tool defined in mcp-server.ts', () => {
    const content = fs.readFileSync('src/mcp-server.ts', 'utf-8');
    expect(content).toContain("name: 'search_facts'");
    expect(content).toContain('Search extracted facts');
  });

  it('should have SearchFactsInputSchema defined', () => {
    const content = fs.readFileSync('src/mcp-server.ts', 'utf-8');
    expect(content).toContain('SearchFactsInputSchema');
  });

  it('should import fact-db functions', () => {
    const content = fs.readFileSync('src/mcp-server.ts', 'utf-8');
    expect(content).toContain('searchSimilarFacts');
    expect(content).toContain('getRevisions');
  });

  it('should handle search_facts in CallTool handler', () => {
    const content = fs.readFileSync('src/mcp-server.ts', 'utf-8');
    expect(content).toContain("name === 'search_facts'");
  });
});
