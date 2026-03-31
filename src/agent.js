import { buildContextSummary } from './context.js';

const MAX_TOOL_RESULT_CHARS = 6000;

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
9. Erfinde keine Daten.`;
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

  /**
   * Truncate a tool result to prevent context overflow.
   */
  truncateResult(result) {
    if (result.length <= MAX_TOOL_RESULT_CHARS) return result;

    // Try to parse as JSON and truncate content fields
    try {
      const data = JSON.parse(result);
      if (data.content && typeof data.content === 'string' && data.content.length > MAX_TOOL_RESULT_CHARS - 500) {
        data.content = data.content.substring(0, MAX_TOOL_RESULT_CHARS - 500) + '\n... [TRUNCATED - use offset/limit for more]';
        data.truncated = true;
        return JSON.stringify(data, null, 2);
      }
    } catch { /* not JSON */ }

    return result.substring(0, MAX_TOOL_RESULT_CHARS) + '\n... [TRUNCATED]';
  }

  /**
   * Parse tool calls from text content (fallback when native tool calling doesn't trigger).
   */
  parseToolCallsFromText(text) {
    const calls = [];
    if (!text) return calls;

    // Pattern 1: <tool_call> XML tags
    const xmlRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
    let match;
    while ((match = xmlRegex.exec(text)) !== null) {
      const parsed = this._tryParseToolJson(match[1]);
      if (parsed) calls.push(parsed);
    }
    if (calls.length > 0) return calls;

    // Pattern 2: JSON code blocks
    const codeBlockRegex = /```(?:json)?\s*\n?\s*(\{[\s\S]*?\})\s*\n?\s*```/g;
    while ((match = codeBlockRegex.exec(text)) !== null) {
      const parsed = this._tryParseToolJson(match[1]);
      if (parsed && this.toolNames.has(parsed.name)) calls.push(parsed);
    }
    if (calls.length > 0) return calls;

    // Pattern 3: Bare JSON with known tool name
    for (const toolName of this.toolNames) {
      const pattern = new RegExp(
        `\\{[^{}]*"name"\\s*:\\s*"${toolName}"[^{}]*"arguments"\\s*:\\s*\\{[^{}]*\\}[^{}]*\\}`,
        'g'
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
      let jsonStr = str.trim();
      jsonStr = jsonStr.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
      const parsed = JSON.parse(jsonStr);
      if (parsed.name && this.toolNames.has(parsed.name)) {
        return {
          name: parsed.name,
          arguments: parsed.arguments || parsed.args || {},
        };
      }
    } catch {
      const nameMatch = str.match(/"name"\s*:\s*"([^"]+)"/);
      if (nameMatch && this.toolNames.has(nameMatch[1])) {
        const argsMatch = str.match(/"arguments"\s*:\s*(\{[^}]*\})/);
        try {
          return {
            name: nameMatch[1],
            arguments: argsMatch ? JSON.parse(argsMatch[1]) : {},
          };
        } catch { /* skip */ }
      }
    }
    return null;
  }

  /**
   * Extract tool calls from an Ollama response - native format first, then text parsing.
   */
  extractToolCalls(message) {
    if (message.tool_calls && message.tool_calls.length > 0) {
      return message.tool_calls.map((tc) => {
        const fn = tc.function;
        let args = fn.arguments;
        if (typeof args === 'string') {
          try { args = JSON.parse(args); } catch { args = {}; }
        }
        return { name: fn.name, arguments: args || {} };
      });
    }
    return this.parseToolCallsFromText(message.content);
  }

  async run(userMessage) {
    this.messages.push({ role: 'user', content: userMessage });

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      const allMessages = [
        { role: 'system', content: this.systemPrompt },
        ...this.messages,
      ];

      this.ui.showThinking();

      let response;
      try {
        response = await this.ollama.chat(allMessages, { tools: this.ollamaTools });
      } catch (error) {
        this.ui.stopThinking();
        this.ui.showError(`LLM: ${error.message}`);
        return;
      }

      this.ui.stopThinking();

      const message = response.message;
      if (!message) {
        this.ui.showError('Keine Antwort vom Modell.');
        return;
      }

      const toolCalls = this.extractToolCalls(message);

      if (toolCalls.length === 0) {
        // Final answer - no tool calls
        if (message.content) {
          console.log('');
          console.log(message.content);
          console.log('');
        }
        this.messages.push({ role: 'assistant', content: message.content || '' });
        return;
      }

      // Show reasoning text (cleaned)
      if (message.content) {
        let displayText = message.content;
        displayText = displayText.replace(/```(?:json)?\s*\n?\s*\{[\s\S]*?"name"[\s\S]*?\}\s*\n?\s*```/g, '');
        displayText = displayText.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
        displayText = displayText.trim();
        if (displayText) {
          console.log('');
          console.log(displayText);
        }
      }

      // Store assistant message
      this.messages.push(message.tool_calls ? message : { role: 'assistant', content: message.content || '' });

      // Execute tool calls
      for (const call of toolCalls) {
        this.ui.showToolExecution(call.name, call.arguments);

        let result;
        try {
          result = await this.tools.execute(call.name, call.arguments);
        } catch (error) {
          result = JSON.stringify({ error: error.message });
          this.ui.showToolError(call.name, error.message);
        }

        this.ui.showToolResult(call.name, result);

        // Truncate before sending to model
        const truncatedResult = this.truncateResult(result);

        if (message.tool_calls) {
          this.messages.push({ role: 'tool', content: truncatedResult });
        } else {
          this.messages.push({
            role: 'user',
            content: `Tool-Ergebnis (${call.name}):\n${truncatedResult}\n\nFühre den nächsten Schritt aus.`,
          });
        }
      }
    }

    // Max iterations
    this.ui.showInfo('Maximale Iterationen erreicht.');
    this.messages.push({
      role: 'user',
      content: 'Fasse jetzt alle Ergebnisse zusammen. Keine weiteren Tools.',
    });

    const finalResp = await this.ollama.chat([
      { role: 'system', content: this.systemPrompt },
      ...this.messages,
    ]);

    if (finalResp.message?.content) {
      console.log('');
      console.log(finalResp.message.content);
      console.log('');
    }
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
