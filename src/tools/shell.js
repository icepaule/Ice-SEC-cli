import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class ExecCommandTool {
  get description() {
    return {
      name: 'exec_command',
      description: 'Execute a shell command and return its output',
      arguments: { command: 'string - the shell command to execute' },
    };
  }

  async execute({ command }) {
    if (!command) return JSON.stringify({ error: 'No command provided' });

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 60000,
        maxBuffer: 5 * 1024 * 1024,
        cwd: process.cwd(),
        env: { ...process.env, TERM: 'dumb' },
      });

      const result = {
        command,
        exit_code: 0,
        stdout: stdout.substring(0, 10000),
        stderr: stderr.substring(0, 2000),
      };

      if (stdout.length > 10000) result.stdout_truncated = true;
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return JSON.stringify({
        command,
        exit_code: error.code || 1,
        stdout: (error.stdout || '').substring(0, 5000),
        stderr: (error.stderr || error.message || '').substring(0, 2000),
      }, null, 2);
    }
  }
}
