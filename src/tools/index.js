import { WebSearchTool } from './search.js';
import { AnalyzeCodeTool } from './analyze.js';
import { ReadFileTool, EditFileTool, WriteFileTool, ListFilesTool, SearchFilesTool } from './files.js';
import { ExecCommandTool } from './shell.js';
import { RemoteExecTool } from './remote.js';
import { FetchUrlTool } from './fetch.js';

export class ToolRegistry {
  constructor(config = {}) {
    this.tools = new Map();

    this.register(new WebSearchTool(config.searxngUrl));
    this.register(new FetchUrlTool());
    this.register(new AnalyzeCodeTool(config.analysisImage));
    this.register(new ReadFileTool());
    this.register(new EditFileTool());
    this.register(new WriteFileTool());
    this.register(new ListFilesTool());
    this.register(new SearchFilesTool());
    this.register(new ExecCommandTool());
    this.register(new RemoteExecTool());
  }

  register(tool) {
    this.tools.set(tool.description.name, tool);
  }

  async execute(name, args) {
    const tool = this.tools.get(name);
    if (!tool) {
      return JSON.stringify({ error: `Unknown tool: ${name}`, available: this.getToolNames() });
    }
    return tool.execute(args);
  }

  getToolNames() {
    return Array.from(this.tools.keys());
  }

  getOllamaToolDefinitions() {
    return Array.from(this.tools.values()).map((t) => {
      const desc = t.description;
      const properties = {};
      const required = [];

      for (const [key, value] of Object.entries(desc.arguments)) {
        const isOptional = value.includes('optional');
        const cleanDesc = value.replace(/^string\s*[-–—]\s*/, '').replace(/\(optional\)\s*[-–—]?\s*/, '');

        properties[key] = {
          type: 'string',
          description: cleanDesc,
        };

        if (!isOptional) {
          required.push(key);
        }
      }

      return {
        type: 'function',
        function: {
          name: desc.name,
          description: desc.description,
          parameters: {
            type: 'object',
            properties,
            required,
          },
        },
      };
    });
  }
}
