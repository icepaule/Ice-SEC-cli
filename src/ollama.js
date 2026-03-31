import fetch from 'node-fetch';

export class OllamaClient {
  constructor(baseUrl, model, options = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.model = model;
    this.numCtx = options.numCtx || 8192;
  }

  async chat(messages, options = {}) {
    const body = {
      model: options.model || this.model,
      messages,
      stream: false,
      options: {
        num_ctx: this.numCtx,
        temperature: options.temperature ?? 0.3,
      },
    };
    if (options.tools) body.tools = options.tools;

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${text}`);
    }

    return response.json();
  }

  async *chatStream(messages, options = {}) {
    const body = {
      model: options.model || this.model,
      messages,
      stream: true,
      options: {
        num_ctx: this.numCtx,
        temperature: options.temperature ?? 0.3,
      },
    };
    if (options.tools) body.tools = options.tools;

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${text}`);
    }

    let buffer = '';
    for await (const chunk of response.body) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          yield data;
        } catch { /* skip malformed */ }
      }
    }

    if (buffer.trim()) {
      try {
        yield JSON.parse(buffer);
      } catch { /* ignore */ }
    }
  }

  async listModels() {
    const response = await fetch(`${this.baseUrl}/api/tags`);
    if (!response.ok) throw new Error(`Failed to list models: ${response.status}`);
    const data = await response.json();
    return data.models || [];
  }

  async isReachable() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  setModel(name) {
    this.model = name;
  }
}
