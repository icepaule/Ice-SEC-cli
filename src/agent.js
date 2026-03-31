import { buildContextSummary } from './context.js';

const MAX_TOOL_RESULT_CHARS = 3000;

function buildSystemPrompt(projectInfo) {
  const context = buildContextSummary(projectInfo);

  return `Du bist ein Security-Analyst und Entwickler mit direktem Systemzugriff.

KONTEXT:
${context}

SYSTEME:
- Lokal: ${projectInfo.hostname} (alle file/exec Tools)
- Remote: Konfigurierte Hosts (remote_exec per SSH)
- Internet: web_search, fetch_url

REGELN - STRIKT BEFOLGEN:
1. DU HANDELST SOFORT. Kein Planen, kein Beschreiben, kein "ich würde". Tool aufrufen.
2. Ein Tool pro Antwort. Nach dem Ergebnis den nächsten Schritt.
3. Für große Dateien: ERST search_files um Stellen zu finden, DANN read_file mit offset/limit.
4. Zum Ändern von Code: edit_file (suchen+ersetzen). Nur write_file für neue Dateien.
5. Zum Testen: exec_command nutzen.
6. Zum Prüfen von Ports: exec_command mit ss, netstat, oder nc.
7. NIEMALS Code in der Antwort schreiben den du nicht ausführst. Nutze die Tools.
8. Antworte in der Sprache des Nutzers.
9. Erfinde keine Daten.
10. Halte Antworten kurz und präzise. Keine langen Erklärungen wenn nicht nötig.`;
}

export class Agent {
  constructor(ollamaClient, toolRegistry, ui, options = {}) {
    this.ollama = ollamaClient;
    this.tools = toolRegistry;
    this.ui = ui;
    this.maxIterations = options.maxIterations || 15;
    this.projectInfo = options.projectInfo || {};
    this.messages = [];
    this.systemPrompt = buildSystemPrompt(this.projectInfo);
    this.ollamaTools = this.tools.getOllamaToolDefinitions();
    this.toolNames = new Set(this.tools.getToolNames());
  }

  truncateResult(result) {
    if (result.length <= MAX_TOOL_RESULT_CHARS) return result;
    try {
      const data = JSON.parse(result);
      if (data.content && typeof data.content === 'string' && data.content.length > MAX_TOOL_RESULT_CHARS - 500) {
        data.content = data.content.substring(0, MAX_TOOL_RESULT_CHARS - 500) + '\n... [TRUNCATED - use offset/limit for more]';
        data.truncated = true;
        return JSON.stringify(data);
      }
    } catch { /* not JSON */ }
    return result.substring(0, MAX_TOOL_RESULT_CHARS) + '\n... [TRUNCATED]';
  }

  parseToolCallsFromText(text) {
    const calls = [];
    if (!text) return calls;
    let match;

    const xmlRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
    while ((match = xmlRegex.exec(text)) !== null) {
      const parsed = this._tryParseToolJson(match[1]);
      if (parsed) calls.push(parsed);
    }
    if (calls.length > 0) return calls;

    const codeBlockRegex = /```(?:json)?\s*\n?\s*(\{[\s\S]*?\})\s*\n?\s*```/g;
    while ((match = codeBlockRegex.exec(text)) !== null) {
      const parsed = this._tryParseToolJson(match[1]);
      if (parsed && this.toolNames.has(parsed.name)) calls.push(parsed);
    }
    if (calls.length > 0) return calls;

    for (const toolName of this.toolNames) {
      const pattern = new RegExp(
        `\\{[^{}]*"name"\\s*:\\s*"${toolName}"[^{}]*"arguments"\\s*:\\s*\\{[^{}]*\\}[^{}]*\\}`, 'g'
      );
      while ((match = pattern.exec(text)) !== null) {
        const parsed = this._tryParseToolJson(match[0]);
        if (parsed) calls.push(parsed);
      }
    }
    return calls;
  }

  _tryParseToolJson(str) {
    try {
      let jsonStr = str.trim().replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
      const parsed = JSON.parse(jsonStr);
      if (parsed.name && this.toolNames.has(parsed.name)) {
        return { name: parsed.name, arguments: parsed.arguments || parsed.args || {} };
      }
    } catch {
      const nameMatch = str.match(/"name"\s*:\s*"([^"]+)"/);
      if (nameMatch && this.toolNames.has(nameMatch[1])) {
        const argsMatch = str.match(/"arguments"\s*:\s*(\{[^}]*\})/);
        try {
          return { name: nameMatch[1], arguments: argsMatch ? JSON.parse(argsMatch[1]) : {} };
        } catch { /* skip */ }
      }
    }
    return null;
  }

  /**
   * Stream a response from the LLM, displaying text in real-time.
   * Returns: { content, toolCalls }
   */
  async streamResponse(messages, useTool = true) {
    let content = '';
    let toolCalls = [];
    let firstToken = true;

    this.ui.showThinking();

    try {
      for await (const chunk of this.ollama.chatStream(messages, {
        tools: useTool ? this.ollamaTools : undefined,
      })) {
        // Display text content as it streams
        if (chunk.message?.content) {
          if (firstToken) {
            this.ui.stopThinking();
            console.log('');
            firstToken = false;
          }
          process.stdout.write(chunk.message.content);
          content += chunk.message.content;
        }

        // Collect tool calls (come in final chunk)
        if (chunk.message?.tool_calls) {
          toolCalls = chunk.message.tool_calls.map((tc) => {
            const fn = tc.function;
            let args = fn.arguments;
            if (typeof args === 'string') {
              try { args = JSON.parse(args); } catch { args = {}; }
            }
            return { name: fn.name, arguments: args || {} };
          });
        }

        if (chunk.done) break;
      }
    } catch (error) {
      this.ui.stopThinking();
      throw error;
    }

    this.ui.stopThinking();
    if (!firstToken) console.log(''); // newline after streamed text

    // Fallback: parse tool calls from text if native didn't find any
    if (toolCalls.length === 0 && content) {
      toolCalls = this.parseToolCallsFromText(content);
    }

    return { content, toolCalls };
  }

  async run(userMessage) {
    this.messages.push({ role: 'user', content: userMessage });

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      const allMessages = [
        { role: 'system', content: this.systemPrompt },
        ...this.messages,
      ];

      let result;
      try {
        result = await this.streamResponse(allMessages, true);
      } catch (error) {
        this.ui.showError(`LLM: ${error.message}`);
        return;
      }

      const { content, toolCalls } = result;

      if (toolCalls.length === 0) {
        // Final answer
        this.messages.push({ role: 'assistant', content: content || '' });
        if (!content) console.log('');
        return;
      }

      // Store assistant message
      if (content) {
        // Clean display artifacts from tool calls in text
        let displayText = content
          .replace(/```(?:json)?\s*\n?\s*\{[\s\S]*?"name"[\s\S]*?\}\s*\n?\s*```/g, '')
          .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
          .trim();
        // Already streamed to screen, just store
      }

      // For native tool calls, store the message with tool_calls
      const assistantMsg = toolCalls.length > 0 && !content
        ? { role: 'assistant', content: '', tool_calls: toolCalls.map(tc => ({ function: { name: tc.name, arguments: tc.arguments } })) }
        : { role: 'assistant', content: content || '' };
      this.messages.push(assistantMsg);

      // Execute tool calls
      for (const call of toolCalls) {
        this.ui.showToolExecution(call.name, call.arguments);

        let toolResult;
        try {
          toolResult = await this.tools.execute(call.name, call.arguments);
        } catch (error) {
          toolResult = JSON.stringify({ error: error.message });
          this.ui.showToolError(call.name, error.message);
        }

        this.ui.showToolResult(call.name, toolResult);
        const truncated = this.truncateResult(toolResult);

        this.messages.push({ role: 'tool', content: truncated });
      }
    }

    // Max iterations
    this.ui.showInfo('Maximale Iterationen erreicht.');
  }

  clearHistory() {
    this.messages = [];
  }

  getHistoryLength() {
    return this.messages.length;
  }

  setModel(name) {
    this.ollama.setModel(name);
  }
}
