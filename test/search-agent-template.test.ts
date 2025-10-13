import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('search-agent template', () => {
  const templatePath = path.join(__dirname, '..', 'prompts', 'search-agent.md');

  it('exists at expected location', () => {
    expect(fs.existsSync(templatePath)).toBe(true);
  });

  it('contains required placeholders', () => {
    const content = fs.readFileSync(templatePath, 'utf-8');

    // Check for all required placeholders
    expect(content).toContain('{TOPIC}');
    expect(content).toContain('{SEARCH_QUERY}');
    expect(content).toContain('{FOCUS_AREAS}');
  });

  it('contains required output sections', () => {
    const content = fs.readFileSync(templatePath, 'utf-8');

    // Check for required output format sections
    expect(content).toContain('### Summary');
    expect(content).toContain('### Sources');
    expect(content).toContain('### For Follow-Up');
  });

  it('specifies word count requirements', () => {
    const content = fs.readFileSync(templatePath, 'utf-8');

    // Should specify 200-1000 words for synthesis
    expect(content).toMatch(/200-1000 words/);
    expect(content).toMatch(/max 1000 words/);
  });

  it('includes source metadata requirements', () => {
    const content = fs.readFileSync(templatePath, 'utf-8');

    // Check for source metadata fields
    expect(content).toContain('project-name');
    expect(content).toContain('YYYY-MM-DD');
    expect(content).toContain('% match');
    expect(content).toContain('Conversation summary:');
    expect(content).toContain('File:');
    expect(content).toContain('Status:');
    expect(content).toContain('Read in detail');
    expect(content).toContain('Reviewed summary only');
    expect(content).toContain('Skimmed');
  });

  it('provides search command', () => {
    const content = fs.readFileSync(templatePath, 'utf-8');

    // Should include the search command
    expect(content).toContain('~/.claude/skills/collaboration/remembering-conversations/tool/search-conversations');
  });

  it('includes critical rules', () => {
    const content = fs.readFileSync(templatePath, 'utf-8');

    // Check for DO and DO NOT sections
    expect(content).toContain('## Critical Rules');
    expect(content).toContain('**DO:**');
    expect(content).toContain('**DO NOT:**');
  });

  it('includes complete example output', () => {
    const content = fs.readFileSync(templatePath, 'utf-8');

    // Check example has all required components
    expect(content).toContain('## Example Output');

    // Example should show Summary, Sources, and For Follow-Up
    const exampleSection = content.substring(content.indexOf('## Example Output'));
    expect(exampleSection).toContain('### Summary');
    expect(exampleSection).toContain('### Sources');
    expect(exampleSection).toContain('### For Follow-Up');

    // Example should show specific details
    expect(exampleSection).toContain('react-router-7-starter');
    expect(exampleSection).toContain('92% match');
    expect(exampleSection).toContain('.jsonl');
  });

  it('emphasizes synthesis over raw excerpts', () => {
    const content = fs.readFileSync(templatePath, 'utf-8');

    // Should explicitly discourage raw conversation excerpts
    expect(content).toContain('synthesize');
    expect(content).toContain('raw conversation excerpts');
    expect(content).toContain('synthesize instead');
  });

  it('provides follow-up options', () => {
    const content = fs.readFileSync(templatePath, 'utf-8');

    // Should explain how main agent can follow up
    expect(content).toContain('Main agent can:');
    expect(content).toContain('dig deeper');
    expect(content).toContain('refined query');
    expect(content).toContain('context bloat');
  });
});
