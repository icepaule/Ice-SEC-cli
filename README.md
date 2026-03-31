# Ice-SEC-cli

**Security analysis CLI powered by local LLM** - like Claude Code, but self-hosted with [Ollama](https://ollama.com).

An interactive command-line tool for security researchers, penetration testers, and developers. It connects to a local Ollama instance and autonomously uses tools to analyze code, search the web, execute commands, and access remote systems - all driven by natural language.

**[Full Documentation (GitHub Pages)](https://icepaule.github.io/Ice-SEC-cli/)**

---

## Features

- **Interactive CLI** with streaming LLM responses and autonomous tool calling
- **10 integrated tools** the LLM calls autonomously:
  - `read_file`, `write_file`, `edit_file` - File operations with line-level precision
  - `list_files`, `search_files` - Directory listing and regex search (grep)
  - `exec_command` - Local shell execution
  - `remote_exec` - SSH command execution on remote hosts
  - `analyze_code` - Docker-based security scanning (Bandit, Semgrep, pip-audit, detect-secrets)
  - `web_search` - Internet search via SearXNG (private) or DuckDuckGo (fallback)
  - `fetch_url` - Fetch and parse web pages
- **Project-aware**: Auto-detects project type, languages, and structure
- **Multi-model support**: Switch between models at runtime
- **Docker-based analysis**: Isolated security scanning with industry-standard tools
- **Private web search**: Self-hosted SearXNG meta-search engine

## One-Command Install (Ubuntu/Debian)

```bash
# Basic install (Ollama on localhost)
curl -fsSL https://raw.githubusercontent.com/icepaule/Ice-SEC-cli/main/install.sh | bash

# With remote Ollama server
curl -fsSL https://raw.githubusercontent.com/icepaule/Ice-SEC-cli/main/install.sh | bash -s -- --ollama-host 10.10.0.210

# Full setup with Docker (SearXNG search + analysis containers)
curl -fsSL https://raw.githubusercontent.com/icepaule/Ice-SEC-cli/main/install.sh | bash -s -- --ollama-host 10.10.0.210 --with-docker
```

The installer handles everything: Node.js, git, dependencies, global `sec` command, and configuration.

After install, use from any directory:
```bash
cd /path/to/your/code
sec
```

### Manual Install

```bash
git clone https://github.com/icepaule/Ice-SEC-cli.git
cd Ice-SEC-cli
npm install
cp .env.example .env    # edit OLLAMA_API_URL
npm link                # installs 'sec' globally
sec init                # creates ~/.config/ollama-cli/config.env
```

## Usage

```bash
# Interactive mode (default)
sec

# One-shot question
sec ask "Explain SQL injection with examples"

# Security scan
sec analyze /path/to/code
sec analyze . --type secrets

# Web search
sec search "CVE-2024-3094 xz backdoor"

# List models
sec models
```

### Interactive Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/analyze [path]` | Run security scan |
| `/search <query>` | Web search |
| `/model <name>` | Switch LLM model |
| `/models` | List available models |
| `/clear` | Clear conversation history |
| `/exit` | Quit |

### Natural Language Examples

```
sec> Analyze the Python code in this directory for security issues
sec> Search the web for the latest critical CVEs
sec> Read config.py and find hardcoded credentials
sec> Run 'netstat -tlnp' on the remote server
sec> Write a Python script for port scanning
```

## Requirements

- **Node.js** >= 18
- **Ollama** server (local or remote) with a compatible model
- **Docker** (optional, for code analysis and SearXNG)
- **SSH** key-based auth (optional, for remote_exec)

## Recommended Models

| Model | Size | Use Case |
|-------|------|----------|
| `qwen2.5:14b` | 8.4 GB | Best for tool calling and code analysis |
| `qwen2.5-coder:14b` | 8.4 GB | Specialized for code |
| `dolphin-llama3:8b` | 4.3 GB | Unrestricted, faster |
| `deepseek-r1:14b` | 8.4 GB | Strong reasoning |
| `llama3.1:8b` | 4.6 GB | Lightweight general purpose |

> Models with native tool-calling support (qwen2.5, llama3.1, mistral-nemo) work best. The CLI includes fallback parsing for models that output tool calls as text.

## Architecture

```
sec (CLI Entry Point)
├── Interactive REPL (cli.js)
├── Agent Loop (agent.js)
│   ├── Ollama API Client (ollama.js)
│   │   └── Native tool calling via /api/chat
│   └── Tool Registry (tools/index.js)
│       ├── File Tools (read, write, edit, list, search)
│       ├── Shell Tools (exec_command, remote_exec)
│       ├── Analysis Tools (Docker: bandit, semgrep, ...)
│       └── Web Tools (web_search, fetch_url)
├── Project Detection (context.js)
└── UI Rendering (ui.js)
```

## Docker Setup (Optional)

```bash
# Start SearXNG (private search engine)
docker compose up -d searxng

# Build analysis container
docker compose build analysis

# Or run full setup
bash setup.sh
```

## Configuration

Configuration is loaded in this priority order:
1. Environment variables
2. `~/.config/ollama-cli/config.env` (global)
3. `.env` in the project directory

Run `sec init` to create the global config file.

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_API_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `qwen2.5:14b` | Default model |
| `SEARXNG_URL` | `http://localhost:8888` | SearXNG search URL |
| `ANALYSIS_IMAGE` | `ollama-cli-analysis` | Docker image for analysis |
| `MAX_AGENT_ITERATIONS` | `15` | Max tool call loops |
| `NUM_CTX` | `16384` | Context window size |

## License

ISC License

## Author

**IceAgent** ([@icepaule](https://github.com/icepaule))
