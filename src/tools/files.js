import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { resolve, isAbsolute, join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class ReadFileTool {
  get description() {
    return {
      name: 'read_file',
      description: 'Read contents of a file. For large files use offset/limit to read specific sections. Use search_files first to find relevant line numbers.',
      arguments: {
        path: 'string - path to the file',
        offset: 'string (optional) - start line number, 1-based',
        limit: 'string (optional) - number of lines to read, default 150',
      },
    };
  }

  async execute({ path, offset, limit }) {
    if (!path) return JSON.stringify({ error: 'No path provided' });
    const filePath = isAbsolute(path) ? path : resolve(process.cwd(), path);

    try {
      const content = readFileSync(filePath, 'utf-8');
      const allLines = content.split('\n');
      const totalLines = allLines.length;

      const startLine = Math.max(1, parseInt(offset) || 1);
      const maxLines = parseInt(limit) || 150;
      const endLine = Math.min(totalLines, startLine + maxLines - 1);

      const selectedLines = allLines.slice(startLine - 1, endLine);
      // Add line numbers for reference
      const numbered = selectedLines.map((line, i) => `${startLine + i}: ${line}`).join('\n');

      return JSON.stringify({
        path: filePath,
        total_lines: totalLines,
        showing: `${startLine}-${endLine}`,
        truncated: endLine < totalLines,
        content: numbered,
        hint: endLine < totalLines ? `File has ${totalLines} lines. Use offset=${endLine + 1} to read more.` : undefined,
      });
    } catch (error) {
      return JSON.stringify({ error: error.message });
    }
  }
}

export class EditFileTool {
  get description() {
    return {
      name: 'edit_file',
      description: 'Edit a file by replacing exact text with new text. Much more efficient than rewriting entire files. The old_text must match exactly.',
      arguments: {
        path: 'string - path to the file',
        old_text: 'string - exact text to find (must match exactly)',
        new_text: 'string - replacement text',
      },
    };
  }

  async execute({ path, old_text, new_text }) {
    if (!path) return JSON.stringify({ error: 'No path provided' });
    if (!old_text) return JSON.stringify({ error: 'No old_text provided' });
    if (new_text === undefined) return JSON.stringify({ error: 'No new_text provided' });

    const filePath = isAbsolute(path) ? path : resolve(process.cwd(), path);

    try {
      let content = readFileSync(filePath, 'utf-8');
      const count = content.split(old_text).length - 1;

      if (count === 0) {
        // Try with normalized whitespace
        const normalizedContent = content.replace(/\r\n/g, '\n');
        const normalizedOld = old_text.replace(/\r\n/g, '\n');
        const count2 = normalizedContent.split(normalizedOld).length - 1;

        if (count2 === 0) {
          return JSON.stringify({
            error: 'old_text not found in file',
            suggestion: 'Use read_file to check the exact content, including whitespace',
          });
        }
        content = normalizedContent.replace(normalizedOld, new_text);
      } else {
        content = content.replace(old_text, new_text);
      }

      writeFileSync(filePath, content, 'utf-8');
      return JSON.stringify({
        success: true,
        path: filePath,
        replacements: 1,
        bytes: Buffer.byteLength(content),
      });
    } catch (error) {
      return JSON.stringify({ error: error.message });
    }
  }
}

export class WriteFileTool {
  get description() {
    return {
      name: 'write_file',
      description: 'Create a new file or completely overwrite an existing file. For partial changes use edit_file instead.',
      arguments: {
        path: 'string - path to the file',
        content: 'string - complete file content to write',
      },
    };
  }

  async execute({ path, content }) {
    if (!path) return JSON.stringify({ error: 'No path provided' });
    if (content === undefined) return JSON.stringify({ error: 'No content provided' });

    const filePath = isAbsolute(path) ? path : resolve(process.cwd(), path);
    try {
      writeFileSync(filePath, content, 'utf-8');
      return JSON.stringify({ success: true, path: filePath, bytes: Buffer.byteLength(content) });
    } catch (error) {
      return JSON.stringify({ error: error.message });
    }
  }
}

export class ListFilesTool {
  get description() {
    return {
      name: 'list_files',
      description: 'List files in a directory',
      arguments: {
        path: 'string - directory path',
        pattern: 'string (optional) - glob pattern filter like *.py',
      },
    };
  }

  async execute({ path, pattern }) {
    const dirPath = isAbsolute(path) ? path : resolve(process.cwd(), path || '.');

    try {
      if (pattern) {
        const { stdout } = await execAsync(
          `find "${dirPath}" -maxdepth 3 -name "${pattern}" -type f 2>/dev/null | head -100`,
          { timeout: 10000 }
        );
        const files = stdout.trim().split('\n').filter(Boolean);
        return JSON.stringify({ path: dirPath, pattern, files, count: files.length });
      }

      const entries = readdirSync(dirPath, { withFileTypes: true });
      const result = entries.slice(0, 200).map((e) => {
        const fullPath = join(dirPath, e.name);
        const info = { name: e.name, type: e.isDirectory() ? 'dir' : 'file' };
        if (e.isFile()) {
          try {
            info.size = statSync(fullPath).size;
          } catch { /* ignore */ }
        }
        return info;
      });

      return JSON.stringify({ path: dirPath, entries: result, count: result.length });
    } catch (error) {
      return JSON.stringify({ error: error.message });
    }
  }
}

export class SearchFilesTool {
  get description() {
    return {
      name: 'search_files',
      description: 'Search for text patterns in files (grep). Use this FIRST to find relevant code before reading entire files.',
      arguments: {
        path: 'string - directory to search in',
        pattern: 'string - regex pattern to search for',
        glob: 'string (optional) - file filter like *.js',
      },
    };
  }

  async execute({ path, pattern, glob }) {
    if (!pattern) return JSON.stringify({ error: 'No pattern provided' });
    const searchPath = isAbsolute(path) ? path : resolve(process.cwd(), path || '.');

    try {
      const cmd = `grep -rn --include="${glob || '*'}" -E "${pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null | head -50`;
      const { stdout } = await execAsync(cmd, { timeout: 15000 });

      const matches = stdout.trim().split('\n').filter(Boolean).map((line) => {
        const parts = line.match(/^(.+?):(\d+):(.*)$/);
        if (parts) {
          return { file: parts[1], line: parseInt(parts[2]), content: parts[3].trim().substring(0, 200) };
        }
        return { raw: line.substring(0, 200) };
      });

      return JSON.stringify({
        path: searchPath,
        pattern,
        glob: glob || '*',
        matches,
        count: matches.length,
        truncated: matches.length >= 50,
      }, null, 2);
    } catch (error) {
      if (error.code === 1) {
        return JSON.stringify({ path: searchPath, pattern, matches: [], count: 0 });
      }
      return JSON.stringify({ error: error.message });
    }
  }
}
