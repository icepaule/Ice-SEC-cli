import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class RemoteExecTool {
  get description() {
    return {
      name: 'remote_exec',
      description: 'Execute a command on a remote host via SSH. Use this to search files, inspect systems, read logs, or run commands on remote machines',
      arguments: {
        host: 'string - hostname or IP (e.g. 192.168.1.100)',
        command: 'string - the shell command to execute remotely',
        user: 'string (optional) - SSH user, defaults to root',
      },
    };
  }

  async execute({ host, command, user }) {
    if (!host) return JSON.stringify({ error: 'No host provided' });
    if (!command) return JSON.stringify({ error: 'No command provided' });

    const sshUser = user || 'root';
    const sshOpts = '-o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes';

    try {
      const sshCmd = `ssh ${sshOpts} ${sshUser}@${host} ${JSON.stringify(command)}`;
      const { stdout, stderr } = await execAsync(sshCmd, {
        timeout: 30000,
        maxBuffer: 5 * 1024 * 1024,
      });

      return JSON.stringify({
        host,
        user: sshUser,
        command,
        exit_code: 0,
        stdout: stdout.substring(0, 10000),
        stderr: stderr.substring(0, 2000),
        truncated: stdout.length > 10000,
      }, null, 2);
    } catch (error) {
      return JSON.stringify({
        host,
        user: sshUser,
        command,
        exit_code: error.code || 1,
        stdout: (error.stdout || '').substring(0, 5000),
        stderr: (error.stderr || error.message || '').substring(0, 2000),
      }, null, 2);
    }
  }
}
