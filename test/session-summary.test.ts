import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { suppressConsole } from './test-utils.js';
import { ConversationExchange, ToolCall } from '../src/types.js';

// Suppress console output for clean test runs
const restoreConsole = suppressConsole();

// Restore console after all tests
afterAll(() => {
  restoreConsole();
});

// Import the types and functions we're going to create
// These will fail until we implement them
import type {
  SessionSummary,
  Decision,
  FileModification,
  WorkItem,
  ToolUsage,
  Outcome,
  NextStep
} from '../src/session-summary-types.js';

import {
  extractToolUsage,
  calculateDuration,
  generateSessionSummary
} from '../src/session-summary.js';

describe('SessionSummary types', () => {
  it('Decision type has required fields', () => {
    const decision: Decision = {
      description: 'Use TypeScript for the implementation',
      rationale: 'Better type safety'
    };
    expect(decision.description).toBe('Use TypeScript for the implementation');
    expect(decision.rationale).toBe('Better type safety');
  });

  it('Decision type allows optional rationale', () => {
    const decision: Decision = {
      description: 'Use vitest for testing'
    };
    expect(decision.description).toBe('Use vitest for testing');
    expect(decision.rationale).toBeUndefined();
  });

  it('FileModification type has required fields', () => {
    const mod: FileModification = {
      path: '/src/index.ts',
      action: 'modified'
    };
    expect(mod.path).toBe('/src/index.ts');
    expect(mod.action).toBe('modified');
  });

  it('FileModification action is restricted to valid values', () => {
    const created: FileModification = { path: '/a.ts', action: 'created' };
    const modified: FileModification = { path: '/b.ts', action: 'modified' };
    const deleted: FileModification = { path: '/c.ts', action: 'deleted' };

    expect(['created', 'modified', 'deleted']).toContain(created.action);
    expect(['created', 'modified', 'deleted']).toContain(modified.action);
    expect(['created', 'modified', 'deleted']).toContain(deleted.action);
  });

  it('WorkItem type has required fields', () => {
    const item: WorkItem = {
      id: 'feat-001',
      action: 'completed'
    };
    expect(item.id).toBe('feat-001');
    expect(item.action).toBe('completed');
  });

  it('ToolUsage type tracks name and count', () => {
    const usage: ToolUsage = {
      name: 'Read',
      count: 5
    };
    expect(usage.name).toBe('Read');
    expect(usage.count).toBe(5);
  });

  it('Outcome type has required fields', () => {
    const outcome: Outcome = {
      description: 'Feature implemented successfully',
      status: 'success'
    };
    expect(outcome.description).toBe('Feature implemented successfully');
    expect(outcome.status).toBe('success');
  });

  it('NextStep type has required fields', () => {
    const step: NextStep = {
      description: 'Add unit tests',
      priority: 'high'
    };
    expect(step.description).toBe('Add unit tests');
    expect(step.priority).toBe('high');
  });

  it('SessionSummary type has all required fields', () => {
    const summary: SessionSummary = {
      id: 'summary-123',
      sessionId: 'session-456',
      project: 'test-project',
      timestamp: '2024-01-01T00:00:00Z',
      durationMinutes: 30,
      summary: {
        oneLiner: 'Implemented session summaries',
        detailed: 'Added types and functions for generating session summaries.'
      },
      decisions: [],
      filesModified: [],
      workItems: [],
      toolsUsed: [],
      outcomes: [],
      nextSteps: [],
      tags: []
    };

    expect(summary.id).toBe('summary-123');
    expect(summary.sessionId).toBe('session-456');
    expect(summary.project).toBe('test-project');
    expect(summary.summary.oneLiner).toBe('Implemented session summaries');
  });

  it('SessionSummary embedding is optional', () => {
    const withEmbedding: SessionSummary = {
      id: 'a',
      sessionId: 'b',
      project: 'c',
      timestamp: '2024-01-01T00:00:00Z',
      durationMinutes: 0,
      summary: { oneLiner: 'test', detailed: '' },
      decisions: [],
      filesModified: [],
      workItems: [],
      toolsUsed: [],
      outcomes: [],
      nextSteps: [],
      tags: [],
      embedding: [0.1, 0.2, 0.3]
    };

    expect(withEmbedding.embedding).toHaveLength(3);
  });
});

describe('extractToolUsage', () => {
  it('returns empty array for exchanges without tool calls', () => {
    const exchanges: ConversationExchange[] = [
      {
        id: '1',
        project: 'test',
        timestamp: '2024-01-01T00:00:00Z',
        userMessage: 'Hello',
        assistantMessage: 'Hi',
        archivePath: '/path',
        lineStart: 1,
        lineEnd: 2
      }
    ];

    const result = extractToolUsage(exchanges);
    expect(result).toEqual([]);
  });

  it('counts tool usage correctly', () => {
    const exchanges: ConversationExchange[] = [
      {
        id: '1',
        project: 'test',
        timestamp: '2024-01-01T00:00:00Z',
        userMessage: 'Read file',
        assistantMessage: 'Done',
        archivePath: '/path',
        lineStart: 1,
        lineEnd: 2,
        toolCalls: [
          { toolName: 'Read', args: { file_path: '/a.ts' } } as ToolCall,
          { toolName: 'Read', args: { file_path: '/b.ts' } } as ToolCall,
          { toolName: 'Write', args: { file_path: '/c.ts' } } as ToolCall
        ]
      }
    ];

    const result = extractToolUsage(exchanges);

    expect(result).toContainEqual({ name: 'Read', count: 2 });
    expect(result).toContainEqual({ name: 'Write', count: 1 });
  });

  it('aggregates tool usage across multiple exchanges', () => {
    const exchanges: ConversationExchange[] = [
      {
        id: '1',
        project: 'test',
        timestamp: '2024-01-01T00:00:00Z',
        userMessage: 'First',
        assistantMessage: 'Done',
        archivePath: '/path',
        lineStart: 1,
        lineEnd: 2,
        toolCalls: [
          { toolName: 'Read', args: {} } as ToolCall
        ]
      },
      {
        id: '2',
        project: 'test',
        timestamp: '2024-01-01T00:01:00Z',
        userMessage: 'Second',
        assistantMessage: 'Done',
        archivePath: '/path',
        lineStart: 3,
        lineEnd: 4,
        toolCalls: [
          { toolName: 'Read', args: {} } as ToolCall,
          { toolName: 'Edit', args: {} } as ToolCall
        ]
      }
    ];

    const result = extractToolUsage(exchanges);

    expect(result).toContainEqual({ name: 'Read', count: 2 });
    expect(result).toContainEqual({ name: 'Edit', count: 1 });
  });

  it('sorts results by count in descending order', () => {
    const exchanges: ConversationExchange[] = [
      {
        id: '1',
        project: 'test',
        timestamp: '2024-01-01T00:00:00Z',
        userMessage: 'Test',
        assistantMessage: 'Done',
        archivePath: '/path',
        lineStart: 1,
        lineEnd: 2,
        toolCalls: [
          { toolName: 'Read', args: {} } as ToolCall,
          { toolName: 'Read', args: {} } as ToolCall,
          { toolName: 'Read', args: {} } as ToolCall,
          { toolName: 'Write', args: {} } as ToolCall,
          { toolName: 'Write', args: {} } as ToolCall,
          { toolName: 'Edit', args: {} } as ToolCall
        ]
      }
    ];

    const result = extractToolUsage(exchanges);

    expect(result[0].name).toBe('Read');
    expect(result[0].count).toBe(3);
    expect(result[1].name).toBe('Write');
    expect(result[1].count).toBe(2);
    expect(result[2].name).toBe('Edit');
    expect(result[2].count).toBe(1);
  });
});

describe('calculateDuration', () => {
  it('returns 0 for empty exchanges array', () => {
    const result = calculateDuration([]);
    expect(result).toBe(0);
  });

  it('returns 0 for single exchange', () => {
    const exchanges: ConversationExchange[] = [
      {
        id: '1',
        project: 'test',
        timestamp: '2024-01-01T00:00:00Z',
        userMessage: 'Hello',
        assistantMessage: 'Hi',
        archivePath: '/path',
        lineStart: 1,
        lineEnd: 2
      }
    ];

    const result = calculateDuration(exchanges);
    expect(result).toBe(0);
  });

  it('calculates duration in minutes correctly', () => {
    const exchanges: ConversationExchange[] = [
      {
        id: '1',
        project: 'test',
        timestamp: '2024-01-01T00:00:00Z',
        userMessage: 'Start',
        assistantMessage: 'Starting',
        archivePath: '/path',
        lineStart: 1,
        lineEnd: 2
      },
      {
        id: '2',
        project: 'test',
        timestamp: '2024-01-01T00:30:00Z',
        userMessage: 'End',
        assistantMessage: 'Ending',
        archivePath: '/path',
        lineStart: 3,
        lineEnd: 4
      }
    ];

    const result = calculateDuration(exchanges);
    expect(result).toBe(30);
  });

  it('rounds duration to nearest minute', () => {
    const exchanges: ConversationExchange[] = [
      {
        id: '1',
        project: 'test',
        timestamp: '2024-01-01T00:00:00Z',
        userMessage: 'Start',
        assistantMessage: 'Starting',
        archivePath: '/path',
        lineStart: 1,
        lineEnd: 2
      },
      {
        id: '2',
        project: 'test',
        timestamp: '2024-01-01T00:10:35Z',
        userMessage: 'End',
        assistantMessage: 'Ending',
        archivePath: '/path',
        lineStart: 3,
        lineEnd: 4
      }
    ];

    const result = calculateDuration(exchanges);
    expect(result).toBe(11); // 10 minutes 35 seconds rounds to 11
  });
});

describe('generateSessionSummary', () => {
  it('returns valid SessionSummary structure', async () => {
    const exchanges: ConversationExchange[] = [
      {
        id: '1',
        project: 'test-project',
        timestamp: '2024-01-01T00:00:00Z',
        userMessage: 'Help me implement a feature',
        assistantMessage: 'I will help you implement this feature.',
        archivePath: '/path',
        lineStart: 1,
        lineEnd: 2
      }
    ];

    const result = await generateSessionSummary('session-1', 'test-project', exchanges);

    // Verify structure
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('sessionId', 'session-1');
    expect(result).toHaveProperty('project', 'test-project');
    expect(result).toHaveProperty('timestamp');
    expect(result).toHaveProperty('durationMinutes');
    expect(result).toHaveProperty('summary');
    expect(result.summary).toHaveProperty('oneLiner');
    expect(result.summary).toHaveProperty('detailed');
    expect(result).toHaveProperty('decisions');
    expect(result).toHaveProperty('filesModified');
    expect(result).toHaveProperty('workItems');
    expect(result).toHaveProperty('toolsUsed');
    expect(result).toHaveProperty('outcomes');
    expect(result).toHaveProperty('nextSteps');
    expect(result).toHaveProperty('tags');

    // Verify arrays
    expect(Array.isArray(result.decisions)).toBe(true);
    expect(Array.isArray(result.filesModified)).toBe(true);
    expect(Array.isArray(result.workItems)).toBe(true);
    expect(Array.isArray(result.toolsUsed)).toBe(true);
    expect(Array.isArray(result.outcomes)).toBe(true);
    expect(Array.isArray(result.nextSteps)).toBe(true);
    expect(Array.isArray(result.tags)).toBe(true);
  });

  it('includes tool usage from exchanges', async () => {
    const exchanges: ConversationExchange[] = [
      {
        id: '1',
        project: 'test-project',
        timestamp: '2024-01-01T00:00:00Z',
        userMessage: 'Read files',
        assistantMessage: 'Done',
        archivePath: '/path',
        lineStart: 1,
        lineEnd: 2,
        toolCalls: [
          { toolName: 'Read', args: {} } as ToolCall,
          { toolName: 'Read', args: {} } as ToolCall,
          { toolName: 'Write', args: {} } as ToolCall
        ]
      }
    ];

    const result = await generateSessionSummary('session-1', 'test-project', exchanges);

    expect(result.toolsUsed).toContainEqual({ name: 'Read', count: 2 });
    expect(result.toolsUsed).toContainEqual({ name: 'Write', count: 1 });
  });

  it('handles empty exchanges array', async () => {
    const result = await generateSessionSummary('session-1', 'test-project', []);

    expect(result.durationMinutes).toBe(0);
    expect(result.toolsUsed).toEqual([]);
    expect(result.summary.oneLiner).toBeDefined();
  });

  it('generates unique id for each summary', async () => {
    const exchanges: ConversationExchange[] = [
      {
        id: '1',
        project: 'test',
        timestamp: '2024-01-01T00:00:00Z',
        userMessage: 'Test',
        assistantMessage: 'Test',
        archivePath: '/path',
        lineStart: 1,
        lineEnd: 2
      }
    ];

    const result1 = await generateSessionSummary('session-1', 'test', exchanges);
    const result2 = await generateSessionSummary('session-2', 'test', exchanges);

    expect(result1.id).not.toBe(result2.id);
  });

  it('sets timestamp to current time', async () => {
    const before = new Date().toISOString();

    const result = await generateSessionSummary('session-1', 'test', []);

    const after = new Date().toISOString();

    expect(result.timestamp >= before).toBe(true);
    expect(result.timestamp <= after).toBe(true);
  });
});
