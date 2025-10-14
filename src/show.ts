import { marked } from 'marked';

interface ConversationMessage {
  uuid: string;
  parentUuid: string | null;
  timestamp: string;
  type: 'user' | 'assistant';
  isSidechain: boolean;
  sessionId?: string;
  gitBranch?: string;
  cwd?: string;
  version?: string;
  message: {
    role: string;
    content: string | Array<{ type: string; text?: string; id?: string; name?: string; input?: any }>;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  toolUseResult?: Array<{ type: string; text: string }> | string;
}

export function formatConversationAsMarkdown(jsonl: string): string {
  const lines = jsonl.trim().split('\n').filter(line => line.trim());
  const allMessages: ConversationMessage[] = lines.map(line => JSON.parse(line));

  // Filter out system messages and messages with no content
  const messages = allMessages.filter(msg => {
    if (msg.type !== 'user' && msg.type !== 'assistant') return false;
    if (!msg.timestamp) return false;
    if (!msg.message || !msg.message.content) {
      if (msg.type === 'assistant' && msg.message?.usage) return true;
      return false;
    }
    if (Array.isArray(msg.message.content) && msg.message.content.length === 0) {
      if (msg.type === 'assistant' && msg.message?.usage) return true;
      return false;
    }
    return true;
  });

  if (messages.length === 0) {
    return '';
  }

  const firstMessage = messages[0];
  let output = '# Conversation\n\n';

  // Add metadata
  output += '## Metadata\n\n';
  if (firstMessage.sessionId) {
    output += `**Session ID:** ${firstMessage.sessionId}\n\n`;
  }
  if (firstMessage.gitBranch) {
    output += `**Git Branch:** ${firstMessage.gitBranch}\n\n`;
  }
  if (firstMessage.cwd) {
    output += `**Working Directory:** ${firstMessage.cwd}\n\n`;
  }
  if (firstMessage.version) {
    output += `**Claude Code Version:** ${firstMessage.version}\n\n`;
  }

  output += '---\n\n';
  output += '## Messages\n\n';

  let inSidechain = false;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const timestamp = new Date(msg.timestamp).toLocaleString();
    const messageId = msg.uuid || `msg-${i}`;

    // Skip user messages that are just tool results
    if (msg.type === 'user' && Array.isArray(msg.message.content)) {
      const hasOnlyToolResults = msg.message.content.every(block => block.type === 'tool_result');
      if (hasOnlyToolResults) {
        continue;
      }
    }

    // Handle sidechain grouping
    if (msg.isSidechain && !inSidechain) {
      output += '\n---\n';
      output += '**🔀 SIDECHAIN START**\n';
      output += '---\n\n';
      inSidechain = true;
    } else if (!msg.isSidechain && inSidechain) {
      output += '\n---\n';
      output += '**🔀 SIDECHAIN END**\n';
      output += '---\n\n';
      inSidechain = false;
    }

    // Determine role label
    let roleLabel: string;
    if (msg.isSidechain) {
      roleLabel = msg.type === 'user' ? 'Agent' : 'Subagent';
    } else {
      roleLabel = msg.type === 'user' ? 'User' : 'Agent';
    }

    output += `### **${roleLabel}** (${timestamp}) {#${messageId}}\n\n`;

    if (msg.type === 'user') {
      // Handle tool results
      if (msg.toolUseResult) {
        output += '**Tool Result:**\n\n';
        if (typeof msg.toolUseResult === 'string') {
          output += `${msg.toolUseResult}\n\n`;
        } else if (Array.isArray(msg.toolUseResult)) {
          for (const result of msg.toolUseResult) {
            output += `${result.text || String(result)}\n\n`;
          }
        }
      } else if (typeof msg.message.content === 'string') {
        output += `${msg.message.content}\n\n`;
      } else if (Array.isArray(msg.message.content)) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) {
            output += `${block.text}\n\n`;
          }
        }
      }
    } else if (msg.type === 'assistant') {
      const content = msg.message.content;
      if (typeof content === 'string') {
        output += `${content}\n\n`;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            output += `${block.text}\n\n`;
          } else if (block.type === 'tool_use') {
            output += `**Tool Use:** \`${block.name}\`\n\n`;

            // Format tool input inline
            const input = block.input;
            if (input && typeof input === 'object') {
              for (const [key, value] of Object.entries(input)) {
                if (typeof value === 'string' && value.includes('\n')) {
                  output += `- **${key}:**\n\`\`\`\n${value}\n\`\`\`\n`;
                } else if (typeof value === 'string') {
                  output += `- **${key}:** ${value}\n`;
                } else {
                  output += `- **${key}:**\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
                }
              }
              output += '\n';
            }

            // Look for corresponding tool result
            const toolUseId = (block as any).id;
            if (toolUseId) {
              let foundResult = false;
              for (let j = i + 1; j < Math.min(i + 6, messages.length) && !foundResult; j++) {
                const laterMsg = messages[j];
                if (laterMsg.type === 'user' && Array.isArray(laterMsg.message.content)) {
                  for (const resultBlock of laterMsg.message.content) {
                    if (resultBlock.type === 'tool_result' && (resultBlock as any).tool_use_id === toolUseId) {
                      const content = (resultBlock as any).content;
                      output += '**Result:**\n';
                      if (typeof content === 'string') {
                        if (content.includes('\n') || content.length > 100) {
                          output += '```\n';
                          output += content;
                          output += '\n```\n\n';
                        } else {
                          output += `${content}\n\n`;
                        }
                      } else if (Array.isArray(content)) {
                        output += '```json\n';
                        output += JSON.stringify(content, null, 2);
                        output += '\n```\n\n';
                      }
                      foundResult = true;
                      break;
                    }
                  }
                }
              }
            }
          }
        }
      }

      // Add token usage if present
      if (msg.message.usage) {
        const usage = msg.message.usage;
        output += `_in: ${(usage.input_tokens || 0).toLocaleString()}`;
        if (usage.cache_read_input_tokens) {
          output += ` | cache read: ${usage.cache_read_input_tokens.toLocaleString()}`;
        }
        if (usage.cache_creation_input_tokens) {
          output += ` | cache create: ${usage.cache_creation_input_tokens.toLocaleString()}`;
        }
        output += ` | out: ${(usage.output_tokens || 0).toLocaleString()}_\n\n`;
      }
    }
  }

  // Close sidechain if still open
  if (inSidechain) {
    output += '\n---\n';
    output += '**🔀 SIDECHAIN END**\n';
    output += '---\n\n';
  }

  return output;
}

export function formatConversationAsHTML(jsonl: string): string {
  const lines = jsonl.trim().split('\n').filter(line => line.trim());
  const allMessages: ConversationMessage[] = lines.map(line => JSON.parse(line));

  // Filter out system messages and messages with no content
  const messages = allMessages.filter(msg => {
    // Skip file-history-snapshot and other non-conversation messages
    if (msg.type !== 'user' && msg.type !== 'assistant') return false;

    // Skip messages with null timestamps
    if (!msg.timestamp) return false;

    // Skip messages with no content (but keep if they have usage stats)
    if (!msg.message || !msg.message.content) {
      // Keep assistant messages that only have token usage
      if (msg.type === 'assistant' && msg.message?.usage) return true;
      return false;
    }
    if (Array.isArray(msg.message.content) && msg.message.content.length === 0) {
      // Keep assistant messages that only have token usage
      if (msg.type === 'assistant' && msg.message?.usage) return true;
      return false;
    }

    return true;
  });

  if (messages.length === 0) {
    return '';
  }

  const firstMessage = messages[0];
  let bodyContent = '';

  // Add header with metadata
  bodyContent += '<div class="header">';
  bodyContent += '<h1>Conversation</h1>';
  bodyContent += '<table class="metadata">';
  if (firstMessage.sessionId) {
    bodyContent += `<tr><th>Session ID</th><td>${escapeHtml(firstMessage.sessionId)}</td></tr>`;
  }
  if (firstMessage.gitBranch) {
    bodyContent += `<tr><th>Git Branch</th><td>${escapeHtml(firstMessage.gitBranch)}</td></tr>`;
  }
  if (firstMessage.cwd) {
    bodyContent += `<tr><th>Working Directory</th><td>${escapeHtml(firstMessage.cwd)}</td></tr>`;
  }
  if (firstMessage.version) {
    bodyContent += `<tr><th>Claude Code Version</th><td>${escapeHtml(firstMessage.version)}</td></tr>`;
  }
  bodyContent += '</table></div>';

  // Render messages
  bodyContent += '<div class="messages">';

  // Build message index for tool results
  const toolUseMap = new Map<string, any>();
  for (const msg of messages) {
    if (msg.type === 'assistant' && Array.isArray(msg.message.content)) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_use' && (block as any).id) {
          toolUseMap.set((block as any).id, { msg, block });
        }
      }
    }
  }

  let inSidechain = false;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const timestamp = new Date(msg.timestamp).toLocaleString();
    const messageId = `msg-${msg.uuid || i}`;

    // Skip user messages that are just tool results - they'll be rendered with their tool use
    if (msg.type === 'user' && Array.isArray(msg.message.content)) {
      const hasOnlyToolResults = msg.message.content.every(block => block.type === 'tool_result');
      if (hasOnlyToolResults) {
        continue;
      }
    }

    // Handle sidechain grouping
    if (msg.isSidechain && !inSidechain) {
      // Starting a sidechain group
      bodyContent += '<div class="sidechain-group">';
      inSidechain = true;
    } else if (!msg.isSidechain && inSidechain) {
      // Ending a sidechain group
      bodyContent += '</div>';
      inSidechain = false;
    }

    const messageClass = msg.type === 'user' ? 'message user-message' : 'message assistant-message';

    // Determine role label based on context
    let roleLabel: string;
    if (msg.isSidechain) {
      roleLabel = msg.type === 'user' ? 'Agent' : 'Subagent';
    } else {
      roleLabel = msg.type === 'user' ? 'User' : 'Agent';
    }

    bodyContent += `<div class="${messageClass}" id="${messageId}">`;
    bodyContent += `<div class="message-header">`;
    bodyContent += `<span class="role">${roleLabel}</span>`;
    bodyContent += `<a href="#${messageId}" class="timestamp">${escapeHtml(timestamp)}</a>`;
    bodyContent += `</div>`;
    bodyContent += `<div class="message-content">`;

    if (msg.type === 'user') {
      // Handle tool results
      if (msg.toolUseResult) {
        bodyContent += '<div class="tool-result">';
        bodyContent += '<strong>Tool Result:</strong>';
        if (typeof msg.toolUseResult === 'string') {
          bodyContent += `<p>${escapeHtml(msg.toolUseResult)}</p>`;
        } else if (Array.isArray(msg.toolUseResult)) {
          for (const result of msg.toolUseResult) {
            bodyContent += `<p>${escapeHtml(result.text || String(result))}</p>`;
          }
        }
        bodyContent += '</div>';
      } else if (typeof msg.message.content === 'string') {
        bodyContent += `<p>${escapeHtml(msg.message.content)}</p>`;
      } else if (Array.isArray(msg.message.content)) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) {
            bodyContent += `<p>${escapeHtml(block.text)}</p>`;
          } else if (block.type === 'tool_result') {
            bodyContent += '<div class="tool-result">';
            bodyContent += '<strong>Tool Result:</strong> ';
            bodyContent += `<code>${escapeHtml(String((block as any).content || ''))}</code>`;
            bodyContent += '</div>';
          }
        }
      }
    } else if (msg.type === 'assistant') {
      const content = msg.message.content;
      if (typeof content === 'string') {
        bodyContent += `<p>${escapeHtml(content)}</p>`;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            // Check if text looks like markdown and render accordingly
            if (isMarkdown(block.text)) {
              bodyContent += '<div class="markdown-content">';
              bodyContent += renderMarkdownSafely(block.text);
              bodyContent += '</div>';
            } else {
              // Plain text - preserve whitespace
              bodyContent += `<div class="plain-content">${escapeHtml(block.text)}</div>`;
            }
          } else if (block.type === 'tool_use') {
            bodyContent += '<div class="tool-use">';
            bodyContent += `<div class="tool-name"><strong>Tool Use:</strong> <code>${escapeHtml(block.name || '')}</code></div>`;

            // Format tool input inline
            const input = block.input;
            if (input && typeof input === 'object') {
              bodyContent += '<div class="tool-params">';
              for (const [key, value] of Object.entries(input)) {
                bodyContent += `<div class="tool-param">`;
                bodyContent += `<strong>${escapeHtml(key)}:</strong> `;
                if (typeof value === 'string') {
                  // Check if value has newlines or is long - format as code block
                  if (value.includes('\n') || value.length > 100) {
                    bodyContent += '<pre>';
                    bodyContent += escapeHtml(value);
                    bodyContent += '</pre>';
                  } else {
                    bodyContent += escapeHtml(value);
                  }
                } else {
                  // Format objects/arrays as JSON
                  bodyContent += '<pre>';
                  bodyContent += escapeHtml(JSON.stringify(value, null, 2));
                  bodyContent += '</pre>';
                }
                bodyContent += '</div>';
              }
              bodyContent += '</div>';
            }

            // Look for corresponding tool result in subsequent messages (not just next)
            const toolUseId = (block as any).id;
            if (toolUseId) {
              // Search forward up to 5 messages for the result
              let foundResult = false;
              for (let j = i + 1; j < Math.min(i + 6, messages.length) && !foundResult; j++) {
                const laterMsg = messages[j];
                if (laterMsg.type === 'user' && Array.isArray(laterMsg.message.content)) {
                  for (const resultBlock of laterMsg.message.content) {
                    if (resultBlock.type === 'tool_result' && (resultBlock as any).tool_use_id === toolUseId) {
                      bodyContent += '<div class="tool-result">';
                      bodyContent += '<strong>Result:</strong> ';
                      const content = (resultBlock as any).content;
                      if (typeof content === 'string') {
                        // If content has newlines or is long, format as pre
                        if (content.includes('\n') || content.length > 100) {
                          bodyContent += '<pre>';
                          bodyContent += escapeHtml(content);
                          bodyContent += '</pre>';
                        } else {
                          bodyContent += escapeHtml(content);
                        }
                      } else if (Array.isArray(content)) {
                        bodyContent += '<pre>';
                        bodyContent += escapeHtml(JSON.stringify(content, null, 2));
                        bodyContent += '</pre>';
                      }
                      bodyContent += '</div>';
                      foundResult = true;
                      break;
                    }
                  }
                }
              }
            }
            bodyContent += '</div>';
          }
        }
      }

      // Add token usage if present
      if (msg.message.usage) {
        const usage = msg.message.usage;
        bodyContent += '<div class="token-usage">';
        bodyContent += `in: ${(usage.input_tokens || 0).toLocaleString()}`;
        if (usage.cache_read_input_tokens) {
          bodyContent += ` | cache read: ${usage.cache_read_input_tokens.toLocaleString()}`;
        }
        if (usage.cache_creation_input_tokens) {
          bodyContent += ` | cache create: ${usage.cache_creation_input_tokens.toLocaleString()}`;
        }
        bodyContent += ` | out: ${(usage.output_tokens || 0).toLocaleString()}`;
        bodyContent += '</div>';
      }
    }

    bodyContent += '</div></div>';
  }

  // Close sidechain group if still open
  if (inSidechain) {
    bodyContent += '</div>';
  }

  bodyContent += '</div>';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Conversation</title>
  <style>
    * {
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
      max-width: 900px;
      margin: 0 auto;
      padding: 24px;
      line-height: 1.5;
      color: #1d1d1f;
      background: #f5f5f7;
    }
    .header {
      margin-bottom: 32px;
      padding: 24px;
      background: #ffffff;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .header h1 {
      margin: 0 0 20px 0;
      font-size: 28px;
      font-weight: 600;
      color: #1d1d1f;
    }
    .metadata {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .metadata th {
      text-align: left;
      padding: 10px 0;
      color: #86868b;
      font-weight: 500;
      width: 180px;
      border-bottom: 1px solid #f5f5f7;
    }
    .metadata td {
      padding: 10px 0;
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 12px;
      color: #1d1d1f;
      border-bottom: 1px solid #f5f5f7;
    }
    .messages {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .message {
      padding: 20px 24px;
      background: #ffffff;
    }
    .user-message {
      border-left: 3px solid #007aff;
    }
    .assistant-message {
      border-left: 3px solid #34c759;
    }
    .message-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 12px;
    }
    .role {
      font-weight: 600;
      font-size: 14px;
      letter-spacing: -0.01em;
    }
    .user-message .role {
      color: #007aff;
    }
    .assistant-message .role {
      color: #34c759;
    }
    .plain-content {
      white-space: pre-wrap;
      word-wrap: break-word;
      color: #1d1d1f;
      font-size: 14px;
      line-height: 1.6;
    }
    .markdown-content {
      color: #1d1d1f;
      font-size: 14px;
      line-height: 1.6;
    }
    .markdown-content p {
      margin: 0 0 12px 0;
    }
    .markdown-content p:last-child {
      margin-bottom: 0;
    }
    .markdown-content h1, .markdown-content h2, .markdown-content h3 {
      margin: 20px 0 12px 0;
      font-weight: 600;
      color: #1d1d1f;
    }
    .markdown-content h1 {
      font-size: 20px;
      border-bottom: 1px solid #e5e5e7;
      padding-bottom: 8px;
    }
    .markdown-content h2 {
      font-size: 18px;
    }
    .markdown-content h3 {
      font-size: 16px;
    }
    .markdown-content ul, .markdown-content ol {
      margin: 12px 0;
      padding-left: 24px;
    }
    .markdown-content li {
      margin: 4px 0;
    }
    .markdown-content code {
      background: #f5f5f7;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 13px;
      color: #5e5ce6;
    }
    .markdown-content pre {
      margin: 12px 0;
      background: #1d1d1f;
      color: #f5f5f7;
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      line-height: 1.5;
    }
    .markdown-content pre code {
      background: none;
      color: #f5f5f7;
      padding: 0;
      font-size: 12px;
    }
    .markdown-content blockquote {
      margin: 12px 0;
      padding-left: 16px;
      border-left: 3px solid #e5e5e7;
      color: #6e6e73;
    }
    .markdown-content strong {
      font-weight: 600;
      color: #1d1d1f;
    }
    .markdown-content a {
      color: #007aff;
      text-decoration: none;
    }
    .markdown-content a:hover {
      text-decoration: underline;
    }
    .timestamp {
      font-size: 11px;
      color: #86868b;
      font-weight: 400;
      text-decoration: none;
    }
    .timestamp:hover {
      color: #007aff;
      text-decoration: underline;
    }
    .tool-use {
      margin: 16px 0;
      background: #f5f5f7;
      border-radius: 8px;
      padding: 16px;
      border: 1px solid #e5e5e7;
    }
    .tool-name {
      margin-bottom: 12px;
      font-size: 12px;
      font-weight: 600;
      color: #8e8e93;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .tool-name code {
      color: #5e5ce6;
      background: none;
      padding: 0;
      font-weight: 600;
    }
    .tool-params {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 8px;
    }
    .tool-param {
      font-size: 12px;
      font-family: 'SF Mono', Consolas, monospace;
      line-height: 1.6;
    }
    .tool-param strong {
      color: #5e5ce6;
      font-weight: 600;
    }
    .tool-param pre {
      margin: 6px 0 0 0;
      padding: 8px 12px;
      background: #ffffff;
      border: 1px solid #e5e5e7;
      border-radius: 6px;
      font-size: 11px;
      white-space: pre-wrap;
      word-wrap: break-word;
      color: #1d1d1f;
      font-family: 'SF Mono', Consolas, monospace;
      line-height: 1.5;
      overflow-x: auto;
    }
    .tool-result {
      margin-top: 8px;
      font-size: 12px;
      font-family: 'SF Mono', Consolas, monospace;
      line-height: 1.6;
    }
    .tool-result strong {
      color: #5e5ce6;
      font-weight: 600;
    }
    .tool-result pre {
      margin: 6px 0 0 0;
      padding: 8px 12px;
      background: #ffffff;
      border: 1px solid #e5e5e7;
      border-radius: 6px;
      font-size: 11px;
      white-space: pre-wrap;
      word-wrap: break-word;
      color: #1d1d1f;
      font-family: 'SF Mono', Consolas, monospace;
      line-height: 1.5;
      overflow-x: auto;
    }
    .token-usage {
      margin-top: 12px;
      font-size: 10px;
      color: #86868b;
      font-family: 'SF Mono', Consolas, monospace;
    }
    .sidechain-group {
      background: #fffbf0;
      border-left: 3px solid #ffcc00;
      border-radius: 8px;
      padding: 2px;
      margin: 8px 0;
    }
    .sidechain-group .message {
      background: #ffffff;
    }
    @media (max-width: 768px) {
      body {
        padding: 12px;
      }
      .header {
        padding: 16px;
      }
      .message {
        padding: 16px;
      }
    }
  </style>
</head>
<body>
${bodyContent}
</body>
</html>`;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

function isMarkdown(text: string): boolean {
  // Detect common markdown patterns
  const markdownPatterns = [
    /^#{1,6}\s/m,           // Headers
    /\*\*[^*]+\*\*/,        // Bold
    /\*[^*]+\*/,            // Italic
    /`[^`]+`/,              // Inline code
    /```/,                  // Code blocks
    /^\s*[-*+]\s/m,         // Unordered lists
    /^\s*\d+\.\s/m,         // Ordered lists
    /^\s*>\s/m,             // Blockquotes
    /\[.+\]\(.+\)/,         // Links
  ];

  // If text has at least 2 markdown patterns, consider it markdown
  const matchCount = markdownPatterns.filter(pattern => pattern.test(text)).length;
  return matchCount >= 2;
}

function renderMarkdownSafely(text: string): string {
  try {
    return marked.parse(text, { async: false }) as string;
  } catch (error) {
    // Fallback to escaped HTML if markdown parsing fails
    return `<pre>${escapeHtml(text)}</pre>`;
  }
}
