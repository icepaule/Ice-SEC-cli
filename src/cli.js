import readline from 'readline';
import chalk from 'chalk';

export class CLI {
  constructor(agent, ollama, ui, projectInfo) {
    this.agent = agent;
    this.ollama = ollama;
    this.ui = ui;
    this.projectInfo = projectInfo;
    this.rl = null;
  }

  async start() {
    this.ui.showBanner(this.projectInfo);

    // Check Ollama connectivity
    const reachable = await this.ollama.isReachable();
    if (!reachable) {
      this.ui.showError(`Ollama nicht erreichbar: ${this.ollama.baseUrl}`);
      console.log(chalk.yellow('  Prüfe ob Ollama läuft und die URL in der Konfiguration stimmt.'));
      console.log(chalk.yellow(`  Config: ~/.config/ollama-cli/config.env`));
      console.log('');
    } else {
      console.log(
        chalk.green('  ✓ ') +
        chalk.gray('Ollama: ') + chalk.white(this.ollama.baseUrl) +
        chalk.gray(' | Model: ') + chalk.white(this.ollama.model)
      );
      console.log('');
    }

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.ui.getPrompt(),
      terminal: true,
    });

    this.rl.prompt();

    this.rl.on('line', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        this.rl.prompt();
        return;
      }

      this.rl.pause();

      try {
        if (trimmed.startsWith('/')) {
          await this.handleCommand(trimmed);
        } else {
          await this.agent.run(trimmed);
        }
      } catch (error) {
        this.ui.showError(error.message);
      }

      this.rl.resume();
      this.rl.prompt();
    });

    this.rl.on('close', () => {
      console.log(chalk.gray('\nBis bald!\n'));
      process.exit(0);
    });

    let sigintCount = 0;
    process.on('SIGINT', () => {
      sigintCount++;
      if (sigintCount >= 2) process.exit(0);
      console.log(chalk.gray('\n  Ctrl+C nochmal zum Beenden, oder /exit\n'));
      this.rl.prompt();
      setTimeout(() => { sigintCount = 0; }, 2000);
    });
  }

  async handleCommand(input) {
    const parts = input.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case '/exit':
      case '/quit':
      case '/q':
        console.log(chalk.gray('\nBis bald!\n'));
        process.exit(0);
        break;

      case '/clear':
        this.agent.clearHistory();
        this.ui.showInfo('Gesprächsverlauf gelöscht.');
        break;

      case '/help':
        this.ui.showHelp();
        break;

      case '/model':
        if (args[0]) {
          this.agent.setModel(args[0]);
          this.ui.showSuccess(`Modell gewechselt: ${args[0]}`);
        } else {
          this.ui.showInfo(`Aktuelles Modell: ${this.ollama.model}`);
          console.log(chalk.gray('  Nutzung: /model <modellname>'));
        }
        break;

      case '/models':
        await this.listModels();
        break;

      case '/analyze':
        if (args.length === 0) {
          // Analyze current directory
          await this.agent.run(
            `Führe eine vollständige Sicherheitsanalyse des aktuellen Verzeichnisses durch (${this.projectInfo.cwd}). ` +
            `Liste zuerst die Dateien, dann nutze analyze_code für einen Full-Scan, lies dann die kritischsten Dateien und gib einen detaillierten Bericht.`
          );
        } else {
          const path = args[0];
          const type = args[1] || 'full';
          await this.agent.run(
            `Führe eine ${type} Sicherheitsanalyse durch für: ${path}\n` +
            `Nutze analyze_code mit path="${path}" und type="${type}". ` +
            `Analysiere die Ergebnisse und erstelle einen detaillierten Sicherheitsbericht mit Findings, Severity und Empfehlungen.`
          );
        }
        break;

      case '/search':
        if (args.length === 0) {
          this.ui.showInfo('Nutzung: /search <suchbegriff>');
        } else {
          await this.agent.run(
            `Suche im Internet nach: ${args.join(' ')}\nNutze web_search und fasse die Ergebnisse zusammen. Lies bei Bedarf relevante Seiten mit fetch_url.`
          );
        }
        break;

      case '/history':
        this.ui.showInfo(`Gesprächsverlauf: ${this.agent.getHistoryLength()} Nachrichten`);
        break;

      case '/cwd':
        this.ui.showInfo(`Arbeitsverzeichnis: ${process.cwd()}`);
        break;

      default:
        this.ui.showError(`Unbekannter Befehl: ${cmd}`);
        console.log(chalk.gray('  /help für verfügbare Befehle'));
        break;
    }
  }

  async listModels() {
    try {
      const models = await this.ollama.listModels();
      if (models.length === 0) {
        this.ui.showInfo('Keine Modelle auf dem Ollama-Server gefunden.');
        return;
      }
      console.log('');
      console.log(chalk.bold('  Verfügbare Modelle:'));
      console.log('');
      for (const model of models) {
        const sizeGb = (model.size / (1024 ** 3)).toFixed(1);
        const current = model.name === this.ollama.model ? chalk.green(' ← aktiv') : '';
        const params = model.details?.parameter_size || '';
        console.log(
          `  ${chalk.cyan(model.name.padEnd(30))} ` +
          chalk.gray(`${sizeGb} GB  ${params}`) +
          current
        );
      }
      console.log('');
      console.log(chalk.gray('  Wechseln mit: /model <name>'));
      console.log('');
    } catch (error) {
      this.ui.showError(`Modelle laden fehlgeschlagen: ${error.message}`);
    }
  }
}
