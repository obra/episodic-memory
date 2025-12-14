import { ConversationExchange } from './types.js';
import { query } from '@anthropic-ai/claude-agent-sdk';

export function formatConversationText(exchanges: ConversationExchange[]): string {
  return exchanges.map(ex => {
    return `User: ${ex.userMessage}\n\nAgent: ${ex.assistantMessage}`;
  }).join('\n\n---\n\n');
}

function extractSummary(text: string): string {
  const match = text.match(/<summary>(.*?)<\/summary>/s);
  if (match) {
    return match[1].trim();
  }
  // Fallback if no tags found
  return text.trim();
}

async function callClaude(prompt: string, sessionId?: string, useSonnet = false): Promise<string> {
  const model = useSonnet ? 'sonnet' : 'haiku';

  for await (const message of query({
    prompt,
    options: {
      model,
      max_tokens: 4096,
      resume: sessionId,
      // Don't override systemPrompt when resuming - it uses the original session's prompt
      // Instead, the prompt itself should provide clear instructions
      ...(sessionId ? {} : {
        systemPrompt: 'Write concise, factual summaries. Output ONLY the summary - no preamble, no "Here is", no "I will". Your output will be indexed directly.'
      })
    } as any
  })) {
    if (message && typeof message === 'object' && 'type' in message && message.type === 'result') {
      const result = (message as any).result;

      // Check if result is an API error (SDK returns errors as result strings)
      if (typeof result === 'string' && result.includes('API Error') && result.includes('thinking.budget_tokens')) {
        if (!useSonnet) {
          console.log(`    Haiku hit thinking budget error, retrying with Sonnet`);
          return await callClaude(prompt, sessionId, true);
        }
        // If Sonnet also fails, return error message
        return result;
      }

      return result;
    }
  }
  return '';
}

function chunkExchanges(exchanges: ConversationExchange[], chunkSize: number): ConversationExchange[][] {
  const chunks: ConversationExchange[][] = [];
  for (let i = 0; i < exchanges.length; i += chunkSize) {
    chunks.push(exchanges.slice(i, i + chunkSize));
  }
  return chunks;
}

export async function summarizeConversation(exchanges: ConversationExchange[], sessionId?: string): Promise<string> {
  // Handle trivial conversations
  if (exchanges.length === 0) {
    return 'Trivial conversation with no substantive content.';
  }

  if (exchanges.length === 1) {
    const text = formatConversationText(exchanges);
    if (text.length < 100 || exchanges[0].userMessage.trim() === '/exit') {
      return 'Trivial conversation with no substantive content.';
    }
  }

  // For short conversations (≤15 exchanges), summarize directly
  if (exchanges.length <= 15) {
    const conversationText = sessionId
      ? '' // When resuming, no need to include conversation text - it's already in context
      : formatConversationText(exchanges);

    const prompt = `Context: This summary will be shown in a list to help users and Claude choose which conversations are relevant.

Please write a concise, factual summary of this conversation. Output ONLY the summary - no preamble. Claude will see this summary when searching previous conversations for useful memories and information.

Summarize what happened in 2-4 sentences. Be factual and specific. Output in <summary></summary> tags.

Include:
- What was built/changed/discussed (be specific)
- Key technical decisions or approaches
- Problems solved or current state

Exclude:
- Apologies, meta-commentary, or your questions
- Raw logs or debug output
- Generic descriptions - focus on what makes THIS conversation unique

Good:
<summary>Built JWT authentication for React app with refresh tokens and protected routes. Fixed token expiration bug by implementing refresh-during-request logic.</summary>

Bad:
<summary>I apologize. The conversation discussed authentication and various approaches were considered...</summary>

${conversationText}`;

    const result = await callClaude(prompt, sessionId);
    return extractSummary(result);
  }

  // For long conversations, use hierarchical summarization
  console.log(`  Long conversation (${exchanges.length} exchanges) - using hierarchical summarization`);

  // Note: Hierarchical summarization doesn't support resume mode (needs fresh session for each chunk)
  // This is fine since we only use resume for the main session-end hook

  // Chunk into groups of 8 exchanges
  const chunks = chunkExchanges(exchanges, 8);
  console.log(`  Split into ${chunks.length} chunks`);

  // Summarize each chunk
  const chunkSummaries: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkText = formatConversationText(chunks[i]);
    const prompt = `Context: This summary will be shown in a list to help users and Claude choose which conversations are relevant.

Please write a concise summary of this part of a conversation in 2-3 sentences. What happened, what was built/discussed. Use <summary></summary> tags.

${chunkText}

Example: <summary>Implemented HID keyboard functionality for ESP32. Hit Bluetooth controller initialization error, fixed by adjusting memory allocation.</summary>`;

    try {
      const summary = await callClaude(prompt); // No sessionId for chunks
      const extracted = extractSummary(summary);
      chunkSummaries.push(extracted);
      console.log(`  Chunk ${i + 1}/${chunks.length}: ${extracted.split(/\s+/).length} words`);
    } catch (error) {
      console.log(`  Chunk ${i + 1} failed, skipping`);
    }
  }

  if (chunkSummaries.length === 0) {
    return 'Error: Unable to summarize conversation.';
  }

  // Synthesize chunks into final summary
  const synthesisPrompt = `Context: This summary will be shown in a list to help users and Claude choose which conversations are relevant.

Please write a concise, factual summary that synthesizes these part-summaries into one cohesive paragraph. Focus on what was accomplished and any notable technical decisions or challenges. Output in <summary></summary> tags. Claude will see this summary when searching previous conversations for useful memories and information.

Part summaries:
${chunkSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Good:
<summary>Built conversation search system with JavaScript, sqlite-vec, and local embeddings. Implemented hierarchical summarization for long conversations. System archives conversations permanently and provides semantic search via CLI.</summary>

Bad:
<summary>This conversation synthesizes several topics discussed across multiple parts...</summary>

Your summary (max 200 words):`;

  console.log(`  Synthesizing final summary...`);
  try {
    const result = await callClaude(synthesisPrompt); // No sessionId for synthesis
    return extractSummary(result);
  } catch (error) {
    console.log(`  Synthesis failed, using chunk summaries`);
    return chunkSummaries.join(' ');
  }
}
