import chalk from 'chalk';
import ora from 'ora';

export class UI {
  constructor() {
    this.spinner = null;
  }

  showBanner(projectInfo) {
    console.log('');
    console.log(chalk.cyan('╔══════════════════════════════════════════════════╗'));
    console.log(chalk.cyan('║') + chalk.bold.white('  Ollama Security CLI                             ') + chalk.cyan('║'));
    console.log(chalk.cyan('║') + chalk.gray('  Sicherheitsanalyse & Entwicklung mit lokalem LLM ') + chalk.cyan('║'));
    console.log(chalk.cyan('╚══════════════════════════════════════════════════╝'));
    console.log('');

    if (projectInfo) {
      console.log(chalk.gray('  Verzeichnis:  ') + chalk.white(projectInfo.cwd));

      if (projectInfo.type !== 'unknown') {
        console.log(chalk.gray('  Projekt:      ') + chalk.white(
          (projectInfo.projectName || projectInfo.type) +
          (projectInfo.languages.length ? ` (${projectInfo.languages.join(', ')})` : '')
        ));
      }

      if (projectInfo.files.total > 0) {
        console.log(chalk.gray('  Dateien:      ') + chalk.white(`${projectInfo.files.total}`));
      }
    }

    console.log('');
    console.log(chalk.gray('  Einfach natürlich schreiben oder Befehle nutzen:'));
    console.log(chalk.gray('  /help  /analyze <pfad>  /search <query>  /model  /exit'));
    console.log('');
  }

  getPrompt() {
    return chalk.green('sec> ');
  }

  showThinking() {
    this.spinner = ora({
      text: chalk.gray('Denke nach...'),
      spinner: 'dots',
    }).start();
  }

  stopThinking() {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }

  showToolExecution(toolName, args) {
    this.stopThinking();
    const icons = {
      web_search: '🔍',
      fetch_url: '🌐',
      analyze_code: '🛡️',
      read_file: '📄',
      write_file: '✏️',
      list_files: '📁',
      exec_command: '⚡',
      search_files: '🔎',
      remote_exec: '🖥️',
    };
    const icon = icons[toolName] || '🔧';

    let display = '';
    if (typeof args === 'object') {
      // Show the most relevant argument
      if (args.query) display = args.query;
      else if (args.url) display = args.url;
      else if (args.path) display = args.path + (args.pattern ? ` → ${args.pattern}` : '') + (args.type ? ` [${args.type}]` : '');
      else if (args.command) display = (args.host ? `${args.host}: ` : '') + args.command;
      else display = JSON.stringify(args);
    } else {
      display = String(args);
    }

    console.log(chalk.yellow(`\n  ${icon} ${toolName} `) + chalk.gray(display.substring(0, 120)));
  }

  showToolResult(toolName, result, truncate = true) {
    const maxLen = 500;
    let display = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    const totalLen = display.length;

    if (truncate && display.length > maxLen) {
      display = display.substring(0, maxLen);
    }

    const lines = display.split('\n').slice(0, 15);
    console.log(chalk.gray(`  ┌─ Ergebnis`) + (totalLen > maxLen ? chalk.gray(` (${totalLen} Zeichen, gekürzt)`) : ''));
    for (const line of lines) {
      console.log(chalk.gray('  │ ') + line);
    }
    if (display.split('\n').length > 15) {
      console.log(chalk.gray('  │ ...'));
    }
    console.log(chalk.gray('  └─'));
  }

  showToolError(toolName, error) {
    console.log(chalk.red(`  ✗ ${toolName}: ${error}`));
  }

  showError(message) {
    console.log(chalk.red(`\n  Fehler: ${message}\n`));
  }

  showInfo(message) {
    console.log(chalk.cyan(`\n  ${message}\n`));
  }

  showSuccess(message) {
    console.log(chalk.green(`\n  ${message}\n`));
  }

  showHelp() {
    console.log('');
    console.log(chalk.bold('  Befehle:'));
    console.log('');
    console.log(chalk.cyan('  /help') + '                 Hilfe anzeigen');
    console.log(chalk.cyan('  /exit, /quit, /q') + '      Beenden');
    console.log(chalk.cyan('  /clear') + '                Gesprächsverlauf löschen');
    console.log(chalk.cyan('  /model <name>') + '         Modell wechseln');
    console.log(chalk.cyan('  /models') + '               Verfügbare Modelle anzeigen');
    console.log(chalk.cyan('  /analyze <pfad>') + '       Sicherheits-Scan starten');
    console.log(chalk.cyan('  /search <query>') + '       Websuche');
    console.log(chalk.cyan('  /history') + '              Gesprächslänge anzeigen');
    console.log('');
    console.log(chalk.bold('  Natürliche Sprache (Beispiele):'));
    console.log('');
    console.log(chalk.gray('  "Analysiere den Code in diesem Verzeichnis"'));
    console.log(chalk.gray('  "Suche im Internet nach CVE-2024-3094"'));
    console.log(chalk.gray('  "Suche auf dem Remote-Server nach Python-Dateien"'));
    console.log(chalk.gray('  "Schreibe ein Python-Script das Port-Scanning macht"'));
    console.log(chalk.gray('  "Lies die Datei config.py und finde Sicherheitsprobleme"'));
    console.log(chalk.gray('  "Erkläre mir was die Funktion in Zeile 42 macht"'));
    console.log('');
    console.log(chalk.bold('  Analyse-Tools (via Docker):'));
    console.log(chalk.gray('  bandit, semgrep, pip-audit, detect-secrets'));
    console.log('');
  }
}
