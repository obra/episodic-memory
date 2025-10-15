#!/usr/bin/env node
/**
 * MCP Server for Episodic Memory.
 *
 * This server provides tools to search and explore indexed Claude Code conversations
 * using semantic search, text search, and conversation display capabilities.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  searchConversations,
  searchMultipleConcepts,
  formatResults,
  formatMultiConceptResults,
  SearchOptions,
} from './search.js';
import { formatConversationAsMarkdown } from './show.js';
import fs from 'fs';

// Zod Schemas for Input Validation

const SearchModeEnum = z.enum(['vector', 'text', 'both']);
const ResponseFormatEnum = z.enum(['markdown', 'json']);

const SearchInputSchema = z
  .object({
    query: z
      .union([
        z.string().min(2, 'Query must be at least 2 characters'),
        z
          .array(z.string().min(2))
          .min(2, 'Must provide at least 2 concepts for multi-concept search')
          .max(5, 'Cannot search more than 5 concepts at once'),
      ])
      .describe(
        'Search query - string for single concept, array of strings for multi-concept AND search'
      ),
    mode: SearchModeEnum.default('both').describe(
      'Search mode: "vector" for semantic similarity, "text" for exact matching, "both" for combined (default: "both"). Only used for single-concept searches.'
    ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe('Maximum number of results to return (default: 10)'),
    after: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
      .optional()
      .describe('Only return conversations after this date (YYYY-MM-DD format)'),
    before: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
      .optional()
      .describe('Only return conversations before this date (YYYY-MM-DD format)'),
    response_format: ResponseFormatEnum.default('markdown').describe(
      'Output format: "markdown" for human-readable or "json" for machine-readable (default: "markdown")'
    ),
  })
  .strict();

type SearchInput = z.infer<typeof SearchInputSchema>;

const ShowConversationInputSchema = z
  .object({
    path: z
      .string()
      .min(1, 'Path is required')
      .describe('Absolute path to the JSONL conversation file to display'),
  })
  .strict();

type ShowConversationInput = z.infer<typeof ShowConversationInputSchema>;

// Error Handling Utility

function handleError(error: unknown): string {
  if (error instanceof Error) {
    return `Error: ${error.message}`;
  }
  return `Error: ${String(error)}`;
}

// Create MCP Server

const server = new Server(
  {
    name: 'episodic-memory',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register Tools

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'episodic_memory_search',
        description: `Search indexed Claude Code conversations using semantic similarity or exact text matching.

This tool searches through all indexed conversation exchanges, finding relevant discussions based on your query.

**Single-concept search**: Pass a string as query parameter. Supports three search modes:
- "vector" (semantic): Finds conceptually similar conversations even if exact words don't match
- "text" (exact): Finds conversations containing the exact query string
- "both" (default): Combines both methods for best results

**Multi-concept AND search**: Pass an array of strings as query parameter. Finds conversations that semantically match ALL provided concepts (2-5 concepts). Mode parameter is ignored for multi-concept searches.

The tool can filter by date range and returns conversation snippets with metadata including:
- Project name and timestamp
- Similarity score (for semantic search)
- Snippet of the user's question
- Tools used during the conversation
- File path and line numbers for the full conversation

Args:
  - query (string | string[]): Single string for regular search, or array of 2-5 strings for multi-concept AND search
  - mode ('vector' | 'text' | 'both'): Search mode for single-concept searches (default: 'both'). Ignored for multi-concept.
  - limit (number): Max results to return, 1-50 (default: 10)
  - after (string, optional): Only show conversations after YYYY-MM-DD
  - before (string, optional): Only show conversations before YYYY-MM-DD
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For single-concept JSON format:
  {
    "results": [
      {
        "exchange": { "id": string, "project": string, "timestamp": string, ... },
        "similarity": number (0-1, only for vector search),
        "snippet": string (first 200 chars of userMessage)
      }
    ],
    "count": number,
    "mode": string
  }

  For multi-concept JSON format:
  {
    "results": [
      {
        "exchange": { ... },
        "snippet": string,
        "conceptSimilarities": number[], // Similarity for each concept (0-1)
        "averageSimilarity": number // Average across all concepts (0-1)
      }
    ],
    "count": number,
    "concepts": string[]
  }

Examples:
  - Single-concept: query="React Router authentication", mode="vector"
  - Exact match: query="ECONNREFUSED", mode="text"
  - Multi-concept: query=["React Router", "authentication", "JWT"]

Error Handling:
  - Returns clear error if invalid date format provided
  - Returns "No results found" if search returns empty
  - Handles database errors gracefully`,
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              oneOf: [
                { type: 'string', minLength: 2 },
                { type: 'array', items: { type: 'string', minLength: 2 }, minItems: 2, maxItems: 5 },
              ],
            },
            mode: { type: 'string', enum: ['vector', 'text', 'both'], default: 'both' },
            limit: { type: 'number', minimum: 1, maximum: 50, default: 10 },
            after: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            before: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            response_format: { type: 'string', enum: ['markdown', 'json'], default: 'markdown' },
          },
          required: ['query'],
          additionalProperties: false,
        },
        annotations: {
          title: 'Search Episodic Memory',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      {
        name: 'episodic_memory_show',
        description: `Display a full conversation in a readable markdown format.

This tool takes the path to a JSONL conversation file and formats it as readable markdown, including:
- Metadata (project, timestamp, session info)
- Full exchange history (user messages and assistant responses)
- Tool calls with parameters and results
- Sidechain conversations (subagent calls)
- Token usage statistics

Useful for reading the full context of a conversation after finding it via search.

Args:
  - path (string): Absolute file path to the JSONL conversation file

Returns:
  A markdown-formatted string with the complete conversation, including all messages, tool calls, and metadata.

Examples:
  - Use when: After finding a conversation via search, use the archivePath to display it
  - Use when: "Show me the full conversation from /path/to/conversation.jsonl"
  - Don't use when: You just need to search (use episodic_memory_search instead)

Error Handling:
  - Returns error if file doesn't exist
  - Returns error if file is not a valid JSONL conversation
  - Handles malformed JSONL gracefully`,
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', minLength: 1 },
          },
          required: ['path'],
          additionalProperties: false,
        },
        annotations: {
          title: 'Show Full Conversation',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
    ],
  };
});

// Handle Tool Calls

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    if (name === 'episodic_memory_search') {
      const params = SearchInputSchema.parse(args);
      let resultText: string;

      // Check if query is array (multi-concept) or string (single-concept)
      if (Array.isArray(params.query)) {
        // Multi-concept search
        const options = {
          limit: params.limit,
          after: params.after,
          before: params.before,
        };

        const results = await searchMultipleConcepts(params.query, options);

        if (params.response_format === 'json') {
          resultText = JSON.stringify(
            {
              results: results,
              count: results.length,
              concepts: params.query,
            },
            null,
            2
          );
        } else {
          resultText = formatMultiConceptResults(results, params.query);
        }
      } else {
        // Single-concept search
        const options: SearchOptions = {
          mode: params.mode,
          limit: params.limit,
          after: params.after,
          before: params.before,
        };

        const results = await searchConversations(params.query, options);

        if (params.response_format === 'json') {
          resultText = JSON.stringify(
            {
              results: results.map((r) => ({
                exchange: r.exchange,
                similarity: r.similarity,
                snippet: r.snippet,
              })),
              count: results.length,
              mode: params.mode,
            },
            null,
            2
          );
        } else {
          resultText = formatResults(results);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: resultText,
          },
        ],
      };
    }

    if (name === 'episodic_memory_show') {
      const params = ShowConversationInputSchema.parse(args);

      // Verify file exists
      if (!fs.existsSync(params.path)) {
        throw new Error(`File not found: ${params.path}`);
      }

      // Read and format conversation
      const jsonlContent = fs.readFileSync(params.path, 'utf-8');
      const markdownContent = formatConversationAsMarkdown(jsonlContent);

      return {
        content: [
          {
            type: 'text',
            text: markdownContent,
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    // Return errors within the result (not as protocol errors)
    return {
      content: [
        {
          type: 'text',
          text: handleError(error),
        },
      ],
      isError: true,
    };
  }
});

// Main Function

async function main() {
  console.error('Episodic Memory MCP server running via stdio');

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Run the Server

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
