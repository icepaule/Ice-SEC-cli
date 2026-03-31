#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import dotenv from 'dotenv';
import { OllamaClient } from './src/ollama.js';
import { ToolRegistry } from './src/tools/index.js';
import { Agent } from './src/agent.js';
import { CLI } from './src/cli.js';
import { UI } from './src/ui.js';
import { detectProject } from './src/context.js';

// --- Config loading ---
// Priority: env vars > ~/.config/ollama-cli/config.env > .env in package dir
const CONFIG_DIR = join(homedir(), '.config', 'ollama-cli');
const CONFIG_FILE = join(CONFIG_DIR, 'config.env');

// Suppress dotenv debug output
const quiet = { quiet: true };

// Load package-local .env as fallback
const pkgDir = new URL('.', import.meta.url).pathname;
dotenv.config({ path: join(pkgDir, '.env'), ...quiet });

// Override with global config if exists
if (existsSync(CONFIG_FILE)) {
  dotenv.config({ path: CONFIG_FILE, override: true, ...quiet });
}

const OLLAMA_URL = process.env.OLLAMA_API_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:14b';
const SEARXNG_URL = process.env.SEARXNG_URL || 'http://localhost:8888';
const ANALYSIS_IMAGE = process.env.ANALYSIS_IMAGE || 'ollama-cli-analysis';
const MAX_ITERATIONS = parseInt(process.env.MAX_AGENT_ITERATIONS || '15', 10);
const NUM_CTX = parseInt(process.env.NUM_CTX || '8192', 10);

function createStack(modelOverride) {
  const cwd = process.cwd();
  const projectInfo = detectProject(cwd);
  const ollama = new OllamaClient(OLLAMA_URL, modelOverride || OLLAMA_MODEL, { numCtx: NUM_CTX });
  const tools = new ToolRegistry({ searxngUrl: SEARXNG_URL, analysisImage: ANALYSIS_IMAGE });
  const ui = new UI();
  const agent = new Agent(ollama, tools, ui, { maxIterations: MAX_ITERATIONS, projectInfo });
  return { ollama, tools, ui, agent, projectInfo };
}

const program = new Command();

program
  .name('sec')
  .description('Ollama Security CLI - Sicherheitsanalyse & Entwicklung mit lokalem LLM')
  .version('2.0.0');

// Default: interactive mode
program
  .command('chat', { isDefault: true })
  .description('Interaktive Session starten (Standard)')
  .option('-m, --model <model>', 'Modell auswählen')
  .action(async (options) => {
    const { ollama, agent, ui, projectInfo } = createStack(options.model);
    const cli = new CLI(agent, ollama, ui, projectInfo);
    await cli.start();
  });

// One-shot ask
program
  .command('ask')
  .description('Einzelne Frage stellen')
  .argument('<prompt...>', 'Die Frage')
  .option('-m, --model <model>', 'Modell auswählen')
  .action(async (promptParts, options) => {
    const { agent } = createStack(options.model);
    await agent.run(promptParts.join(' '));
    process.exit(0);
  });

// Security scan
program
  .command('analyze')
  .description('Sicherheitsanalyse eines Verzeichnisses')
  .argument('[path]', 'Pfad zum Analysieren', '.')
  .option('-t, --type <type>', 'Analyse-Typ: bandit, secrets, deps, full', 'full')
  .option('-m, --model <model>', 'Modell auswählen')
  .action(async (targetPath, options) => {
    const { agent } = createStack(options.model);
    await agent.run(
      `Führe eine vollständige ${options.type} Sicherheitsanalyse durch für: ${targetPath}\n` +
      `Nutze analyze_code mit path="${targetPath}" und type="${options.type}". ` +
      `Analysiere die Ergebnisse gründlich und erstelle einen Bericht mit:\n` +
      `1. Zusammenfassung\n2. Findings mit Severity (CRITICAL/HIGH/MEDIUM/LOW)\n` +
      `3. CWE/CVE-Referenzen\n4. Konkrete Empfehlungen zur Behebung`
    );
    process.exit(0);
  });

// Web search
program
  .command('search')
  .description('Im Internet suchen')
  .argument('<query...>', 'Suchbegriff')
  .option('-m, --model <model>', 'Modell auswählen')
  .action(async (queryParts, options) => {
    const { agent } = createStack(options.model);
    await agent.run(`Suche im Internet nach: ${queryParts.join(' ')}\nNutze web_search und fasse zusammen. Bei Bedarf lies relevante Seiten mit fetch_url.`);
    process.exit(0);
  });

// List models
program
  .command('models')
  .description('Verfügbare Ollama-Modelle anzeigen')
  .action(async () => {
    const ollama = new OllamaClient(OLLAMA_URL, OLLAMA_MODEL);
    try {
      const models = await ollama.listModels();
      console.log('\nVerfügbare Modelle:\n');
      for (const model of models) {
        const sizeGb = (model.size / (1024 ** 3)).toFixed(1);
        const params = model.details?.parameter_size || '';
        console.log(`  ${model.name.padEnd(30)} ${sizeGb} GB  ${params}`);
      }
      console.log('');
    } catch (error) {
      console.error(`Fehler: ${error.message}`);
      console.error(`Ollama erreichbar? ${OLLAMA_URL}`);
    }
  });

// Setup global config
program
  .command('init')
  .description('Globale Konfiguration einrichten')
  .action(() => {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    if (!existsSync(CONFIG_FILE)) {
      const defaultConfig = `# Ollama Security CLI - Konfiguration
OLLAMA_API_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:14b
SEARXNG_URL=http://localhost:8888
ANALYSIS_IMAGE=ollama-cli-analysis
MAX_AGENT_ITERATIONS=15
NUM_CTX=8192
`;
      writeFileSync(CONFIG_FILE, defaultConfig);
      console.log(`\n  ✓ Konfiguration erstellt: ${CONFIG_FILE}`);
    } else {
      console.log(`\n  Konfiguration existiert bereits: ${CONFIG_FILE}`);
    }
    console.log(`  Bearbeiten mit: nano ${CONFIG_FILE}\n`);
  });

program.parse(process.argv);
