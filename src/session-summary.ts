/**
 * Session Summary Generation
 *
 * Generates structured, searchable summaries from conversation exchanges.
 * Summaries include decisions, files modified, work items, outcomes, and tags.
 */

import { ConversationExchange } from './types.js';
import {
  SessionSummary,
  Decision,
  FileModification,
  WorkItem,
  ToolUsage,
  Outcome,
  NextStep
} from './session-summary-types.js';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { formatConversationText } from './summarizer.js';
import crypto from 'crypto';

const SUMMARY_PROMPT = `Analyze this Claude Code session and generate a structured summary in JSON format.

Output ONLY valid JSON with this exact structure:
{
  "oneLiner": "One sentence summary of what was accomplished",
  "detailed": "2-4 sentences with more detail",
  "decisions": [{"description": "what was decided", "rationale": "why"}],
  "filesModified": [{"path": "/path/to/file.ts", "action": "created|modified|deleted"}],
  "workItems": [{"id": "feat-XXX or bug-XXX", "action": "started|progressed|completed"}],
  "outcomes": [{"description": "what happened", "status": "success|partial|blocked"}],
  "nextSteps": [{"description": "what should be done next", "priority": "high|medium|low"}],
  "tags": ["tag1", "tag2"]
}

Rules:
- Be specific and factual
- Extract actual file paths from tool calls (Read, Write, Edit)
- Look for feat-XXX, bug-XXX, spike-XXX patterns in messages
- Identify decisions from user confirmations and choices
- Tags should be technology/domain keywords for search

Conversation:
`;

/**
 * Extract tool usage counts from conversation exchanges
 */
export function extractToolUsage(exchanges: ConversationExchange[]): ToolUsage[] {
  const toolCounts = new Map<string, number>();

  for (const exchange of exchanges) {
    if (exchange.toolCalls) {
      for (const call of exchange.toolCalls) {
        const count = toolCounts.get(call.toolName) || 0;
        toolCounts.set(call.toolName, count + 1);
      }
    }
  }

  return Array.from(toolCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Calculate session duration in minutes from first to last exchange
 */
export function calculateDuration(exchanges: ConversationExchange[]): number {
  if (exchanges.length < 2) return 0;

  const first = new Date(exchanges[0].timestamp).getTime();
  const last = new Date(exchanges[exchanges.length - 1].timestamp).getTime();

  return Math.round((last - first) / 60000); // minutes
}

/**
 * Generate a structured session summary from conversation exchanges
 */
export async function generateSessionSummary(
  sessionId: string,
  project: string,
  exchanges: ConversationExchange[]
): Promise<SessionSummary> {
  const toolsUsed = extractToolUsage(exchanges);
  const durationMinutes = calculateDuration(exchanges);

  // Default parsed values in case Claude call fails
  let parsed: any = {
    oneLiner: 'Session summary unavailable',
    detailed: '',
    decisions: [],
    filesModified: [],
    workItems: [],
    outcomes: [],
    nextSteps: [],
    tags: []
  };

  // Only call Claude if we have exchanges
  if (exchanges.length > 0) {
    try {
      // Truncate conversation for prompt if too long
      const maxExchanges = 30;
      const truncatedExchanges = exchanges.length > maxExchanges
        ? [...exchanges.slice(0, 10), ...exchanges.slice(-20)]
        : exchanges;

      const conversationText = formatConversationText(truncatedExchanges);
      const prompt = SUMMARY_PROMPT + conversationText;

      for await (const message of query({
        prompt,
        options: {
          model: 'haiku',
          max_tokens: 2048,
          systemPrompt: 'You are a JSON generator. Output ONLY valid JSON, no markdown, no explanation.'
        } as any
      })) {
        if (message && typeof message === 'object' && 'type' in message && message.type === 'result') {
          const result = (message as any).result;
          // Extract JSON from response (handle potential markdown wrapping)
          const jsonMatch = result.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              parsed = JSON.parse(jsonMatch[0]);
            } catch (parseError) {
              console.error('Failed to parse JSON from Claude response:', parseError);
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to generate summary:', error);
    }
  }

  return {
    id: crypto.randomUUID(),
    sessionId,
    project,
    timestamp: new Date().toISOString(),
    durationMinutes,
    summary: {
      oneLiner: parsed.oneLiner || 'Session summary unavailable',
      detailed: parsed.detailed || ''
    },
    decisions: parsed.decisions || [],
    filesModified: parsed.filesModified || [],
    workItems: parsed.workItems || [],
    toolsUsed,
    outcomes: parsed.outcomes || [],
    nextSteps: parsed.nextSteps || [],
    tags: parsed.tags || []
  };
}
