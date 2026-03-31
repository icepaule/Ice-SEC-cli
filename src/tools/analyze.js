import { exec } from 'child_process';
import { promisify } from 'util';
import { resolve, isAbsolute } from 'path';
import { existsSync } from 'fs';

const execAsync = promisify(exec);

export class AnalyzeCodeTool {
  constructor(imageName) {
    this.imageName = imageName || 'ollama-cli-analysis';
    this.imageChecked = false;
  }

  get description() {
    return {
      name: 'analyze_code',
      description: 'Run automated security analysis on code using Docker containers (bandit, semgrep, pip-audit, detect-secrets)',
      arguments: {
        path: 'string - path to file or directory to analyze',
        type: 'string - analysis type: bandit, secrets, deps, full (default: full)',
      },
    };
  }

  async ensureImage() {
    if (this.imageChecked) return;
    try {
      await execAsync(`docker image inspect ${this.imageName} > /dev/null 2>&1`);
      this.imageChecked = true;
    } catch {
      try {
        await execAsync(`docker build -t ${this.imageName} ./docker/analysis`, {
          timeout: 300000,
        });
        this.imageChecked = true;
      } catch (buildErr) {
        throw new Error(`Failed to build analysis image: ${buildErr.message}`);
      }
    }
  }

  async execute({ path, type = 'full' }) {
    if (!path) return JSON.stringify({ error: 'No path provided' });

    const targetPath = isAbsolute(path) ? path : resolve(process.cwd(), path);
    if (!existsSync(targetPath)) {
      return JSON.stringify({ error: `Path does not exist: ${targetPath}` });
    }

    const scriptMap = {
      bandit: 'analyze_code.py',
      secrets: 'detect_secrets.py',
      deps: 'scan_deps.py',
      full: 'full_scan.py',
    };

    const script = scriptMap[type];
    if (!script) {
      return JSON.stringify({
        error: `Unknown analysis type: ${type}`,
        available: Object.keys(scriptMap),
      });
    }

    try {
      await this.ensureImage();

      const cmd = [
        'docker', 'run', '--rm',
        '-v', `${targetPath}:/workspace:ro`,
        this.imageName,
        `/opt/scripts/${script}`,
        '/workspace',
      ].join(' ');

      const { stdout, stderr } = await execAsync(cmd, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 300000,
      });

      // Try to parse JSON output
      try {
        const data = JSON.parse(stdout);
        return JSON.stringify(data, null, 2);
      } catch {
        return stdout || stderr;
      }
    } catch (error) {
      if (error.message.includes('docker')) {
        return JSON.stringify({
          error: 'Docker is not available or the analysis container failed',
          details: error.message.substring(0, 500),
          suggestion: 'Run: docker compose up -d && docker compose build analysis',
        });
      }
      return JSON.stringify({ error: error.message.substring(0, 500) });
    }
  }
}
