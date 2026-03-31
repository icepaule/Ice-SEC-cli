---
layout: default
title: Ice-SEC-cli Documentation
---

# Ice-SEC-cli

**Security analysis CLI powered by local LLM** - like Claude Code, but self-hosted with Ollama.

An interactive command-line tool for security researchers, penetration testers, and developers. It connects to a local Ollama instance and autonomously uses tools to analyze code, search the web, execute commands, and access remote systems.

---

## Table of Contents

- [Installation Guide](#installation-guide)
- [Configuration](#configuration)
- [Usage](#usage)
- [Tools Reference](#tools-reference)
- [Docker Setup](#docker-setup)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting)

---

## Installation Guide

### Prerequisites

| Component | Version | Required | Purpose |
|-----------|---------|----------|---------|
| **Node.js** | >= 18.0 | Yes | CLI runtime |
| **npm** | >= 9.0 | Yes | Package manager |
| **Ollama** | latest | Yes | LLM backend |
| **Docker** | >= 20.0 | Optional | Code analysis & SearXNG |
| **SSH** | any | Optional | Remote host access |

### Step 1: Install Ollama

On the machine that will run the LLM (GPU recommended):

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Start Ollama (listen on all interfaces for remote access)
OLLAMA_HOST=0.0.0.0 ollama serve

# Or configure as systemd service
sudo systemctl edit ollama
# Add: Environment="OLLAMA_HOST=0.0.0.0"
sudo systemctl restart ollama
```

#### Pull a recommended model

```bash
# Best for tool calling (recommended)
ollama pull qwen2.5:14b

# For code-focused work
ollama pull qwen2.5-coder:14b

# Lightweight alternative
ollama pull llama3.1:8b
```

### Step 2: Install Ice-SEC-cli

On the machine where you want to run the CLI:

```bash
# Clone the repository
git clone https://github.com/icepaule/Ice-SEC-cli.git
cd Ice-SEC-cli

# Install Node.js dependencies
npm install

# Make CLI executable
chmod +x index.js
```

### Step 3: Configure

```bash
# Copy example configuration
cp .env.example .env

# Edit configuration
nano .env
```

Set at minimum the Ollama server URL:

```bash
# If Ollama runs on the same machine:
OLLAMA_API_URL=http://localhost:11434

# If Ollama runs on a remote GPU server:
OLLAMA_API_URL=http://192.168.1.100:11434
```

### Step 4: Install globally

```bash
# Link globally - makes 'sec' and 'ollama-cli' available everywhere
npm link

# Create global config (optional)
sec init
```

### Step 5: Verify

```bash
# Check available models
sec models

# Quick test
sec ask "Hello, what tools do you have access to?"
```

### Step 6: Docker Setup (Optional)

For code analysis and private web search:

```bash
# Start SearXNG (private search engine on port 8888)
docker compose up -d searxng

# Build analysis container (bandit, semgrep, pip-audit, detect-secrets)
docker compose build analysis

# Or run the automated setup script
OLLAMA_HOST=your-ollama-ip bash setup.sh
```

---

## Configuration

### Configuration Files

Ice-SEC-cli loads configuration in this priority order:

1. **Environment variables** (highest priority)
2. **`~/.config/ollama-cli/config.env`** (global user config)
3. **`.env`** in the Ice-SEC-cli directory (fallback)

Create the global config with:

```bash
sec init
# Creates: ~/.config/ollama-cli/config.env
```

### Configuration Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_API_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `qwen2.5:14b` | Default LLM model |
| `SEARXNG_URL` | `http://localhost:8888` | SearXNG search engine URL |
| `ANALYSIS_IMAGE` | `ollama-cli-analysis` | Docker image for code analysis |
| `MAX_AGENT_ITERATIONS` | `15` | Max tool call loops per query |
| `NUM_CTX` | `16384` | LLM context window (tokens) |

### Recommended Models

| Model | VRAM | Params | Best For |
|-------|------|--------|----------|
| `qwen2.5:14b` | ~9 GB | 14.8B | Tool calling, analysis |
| `qwen2.5-coder:14b` | ~9 GB | 14.8B | Code generation & review |
| `qwen2.5:7b` | ~5 GB | 7.6B | Lower VRAM systems |
| `dolphin-llama3:8b` | ~5 GB | 8B | Unrestricted research |
| `deepseek-r1:14b` | ~9 GB | 14.8B | Complex reasoning |
| `llama3.1:8b` | ~5 GB | 8B | Lightweight general use |
| `mistral-nemo:12b` | ~7 GB | 12.2B | Balanced performance |

> **Note:** Models with native tool-calling support (qwen2.5, llama3.1, mistral-nemo) work best. The CLI includes fallback text-parsing for other models.

### SSH Setup (for remote_exec)

To use the `remote_exec` tool for accessing remote hosts:

```bash
# Generate SSH key (if not exists)
ssh-keygen -t ed25519

# Copy public key to remote host
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@remote-host

# Test
ssh user@remote-host "hostname"
```

---

## Usage

### Interactive Mode

```bash
# Start from any directory
cd /path/to/your/code
sec

# With specific model
sec -m qwen2.5-coder:14b
```

The CLI auto-detects the project type and provides context to the LLM.

### Interactive Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands and examples |
| `/exit`, `/quit`, `/q` | Quit the CLI |
| `/clear` | Clear conversation history |
| `/model <name>` | Switch to a different model |
| `/models` | List available models on the server |
| `/analyze [path] [type]` | Run security scan (types: bandit, secrets, deps, full) |
| `/search <query>` | Search the web |
| `/history` | Show conversation message count |
| `/cwd` | Show current working directory |

### One-Shot Commands

```bash
# Ask a question
sec ask "Explain buffer overflow exploitation"

# Security scan (default: full)
sec analyze /path/to/code
sec analyze . --type secrets
sec analyze ./src --type bandit

# Web search
sec search "CVE-2024-3094 xz backdoor details"

# List models
sec models

# Create global config
sec init
```

### Natural Language Examples

The LLM understands natural language and calls tools autonomously:

```
sec> Analyze all Python files in this directory for security vulnerabilities
sec> Search the internet for the latest critical CVEs from this month
sec> Read the file server.py and find SQL injection risks
sec> Check which ports are open on the remote server
sec> Write a Python script that scans for open ports on a subnet
sec> Find all hardcoded passwords in the JavaScript files
sec> What does the function on line 42 do?
```

---

## Tools Reference

The LLM has access to 10 tools that it calls autonomously based on your requests.

### File Operations

#### `read_file`
Read file contents with optional pagination.

| Argument | Required | Description |
|----------|----------|-------------|
| `path` | Yes | File path (absolute or relative to CWD) |
| `offset` | No | Start line number (1-based), default: 1 |
| `limit` | No | Number of lines to read, default: 150 |

Returns line-numbered content with truncation hints for large files.

#### `edit_file`
Edit a file by replacing exact text matches.

| Argument | Required | Description |
|----------|----------|-------------|
| `path` | Yes | File path |
| `old_text` | Yes | Exact text to find |
| `new_text` | Yes | Replacement text |

Handles whitespace normalization. More efficient than rewriting entire files.

#### `write_file`
Create a new file or completely overwrite an existing one.

| Argument | Required | Description |
|----------|----------|-------------|
| `path` | Yes | File path |
| `content` | Yes | Complete file content |

#### `list_files`
List directory contents with optional glob filtering.

| Argument | Required | Description |
|----------|----------|-------------|
| `path` | Yes | Directory path |
| `pattern` | No | Glob pattern (e.g., `*.py`, `*.js`) |

#### `search_files`
Search for text patterns in files (like grep).

| Argument | Required | Description |
|----------|----------|-------------|
| `path` | Yes | Directory to search |
| `pattern` | Yes | Regex pattern |
| `glob` | No | File filter (e.g., `*.py`) |

Returns up to 50 matches with file path, line number, and context.

### Execution Tools

#### `exec_command`
Execute a shell command on the local system.

| Argument | Required | Description |
|----------|----------|-------------|
| `command` | Yes | Shell command |

Timeout: 60 seconds. Output truncated to 10 KB.

#### `remote_exec`
Execute a command on a remote host via SSH.

| Argument | Required | Description |
|----------|----------|-------------|
| `host` | Yes | Hostname or IP address |
| `command` | Yes | Shell command to execute |
| `user` | No | SSH user (default: root) |

Requires SSH key-based authentication. Timeout: 30 seconds.

### Code Analysis

#### `analyze_code`
Run automated security analysis via Docker container.

| Argument | Required | Description |
|----------|----------|-------------|
| `path` | Yes | File or directory to analyze |
| `type` | No | Analysis type (default: `full`) |

**Analysis types:**

| Type | Tools Used | Description |
|------|-----------|-------------|
| `full` | All below | Comprehensive scan |
| `bandit` | Bandit + Semgrep + Pattern Scanner | Static code analysis |
| `secrets` | detect-secrets + custom patterns | Credential/secret detection |
| `deps` | pip-audit + npm audit | Dependency vulnerabilities |

**Detected patterns include:** Hardcoded secrets, SQL injection, command injection, path traversal, weak cryptography, insecure deserialization, SSRF, XSS, debug mode, and more.

### Web Tools

#### `web_search`
Search the internet for information.

| Argument | Required | Description |
|----------|----------|-------------|
| `query` | Yes | Search query |

Uses SearXNG (self-hosted, private) with DuckDuckGo as fallback.

#### `fetch_url`
Fetch and parse a web page or API endpoint.

| Argument | Required | Description |
|----------|----------|-------------|
| `url` | Yes | URL to fetch |
| `format` | No | `text` (default) or `json` |

Strips HTML tags, decodes entities, limits response to 15 KB.

---

## Docker Setup

### SearXNG (Private Search Engine)

```bash
# Start SearXNG on port 8888
docker compose up -d searxng

# Verify
curl http://localhost:8888/search?q=test&format=json
```

SearXNG aggregates results from Google, DuckDuckGo, GitHub, StackOverflow, Wikipedia, and NVD (CVE database).

### Analysis Container

The analysis container includes:

| Tool | Purpose |
|------|---------|
| **Bandit** | Python static security analysis |
| **Semgrep** | Multi-language pattern-based analysis |
| **pip-audit** | Python dependency vulnerability scanning |
| **detect-secrets** | Credential and secret detection |

```bash
# Build the analysis container
docker compose build analysis

# Or build manually
docker build -t ollama-cli-analysis ./docker/analysis/

# Test directly
docker run --rm -v /path/to/code:/workspace:ro ollama-cli-analysis /opt/scripts/full_scan.py /workspace
```

---

## Architecture

```
index.js                         CLI entry point, command routing
│
├── src/cli.js                   Interactive REPL with readline
│   ├── Command handling         /help, /analyze, /model, etc.
│   └── Agent delegation         Natural language → Agent.run()
│
├── src/agent.js                 Core agent loop
│   ├── System prompt            Context-aware (CWD, hostname, project)
│   ├── Tool call extraction     Native Ollama API + text fallback
│   ├── Tool execution           Via ToolRegistry
│   ├── Result truncation        Prevents context overflow (6 KB max)
│   └── Multi-turn loop          Up to 15 iterations
│
├── src/ollama.js                Ollama API client
│   ├── /api/chat                With native tool definitions
│   ├── /api/tags                Model listing
│   └── Streaming support        For real-time output
│
├── src/context.js               Project detection
│   ├── File type counting       By extension, 3 levels deep
│   ├── Project identification   package.json, requirements.txt, etc.
│   └── Language detection       Python, JS, Go, Rust, Java, etc.
│
├── src/ui.js                    Terminal UI
│   ├── chalk                    Colored output
│   └── ora                      Spinners
│
└── src/tools/                   Tool implementations
    ├── files.js                 read_file, edit_file, write_file, list_files, search_files
    ├── shell.js                 exec_command
    ├── remote.js                remote_exec (SSH)
    ├── analyze.js               analyze_code (Docker)
    ├── search.js                web_search (SearXNG/DDG)
    └── fetch.js                 fetch_url
```

### Agent Loop

1. User message is added to conversation history
2. System prompt + history sent to Ollama `/api/chat` with tool definitions
3. Ollama returns either text or tool calls
4. If tool calls: execute tools, add results to history, loop back to step 2
5. If text only: display response, done
6. Safety limit: max 15 iterations per query

### Tool Call Detection

The agent uses a fallback chain for maximum compatibility:

1. **Native Ollama tool calls** (structured `tool_calls` array)
2. **XML tags**: `<tool_call>{"name": "...", "arguments": {...}}</tool_call>`
3. **JSON code blocks**: `` ```json {"name": "...", "arguments": {...}} ``` ``
4. **Bare JSON** matching known tool names

---

## Troubleshooting

### Ollama not reachable

```bash
# Check if Ollama is running
curl http://your-ollama-host:11434/api/tags

# Start Ollama with network access
OLLAMA_HOST=0.0.0.0 ollama serve

# Check firewall
sudo ufw status
sudo iptables -L -n | grep 11434
```

### Model doesn't call tools

- Use `qwen2.5:14b` or `llama3.1:8b` - these have native tool calling
- Avoid custom models created with `ollama create` as they may lose tool calling
- The CLI has text-based fallback parsing, but native is more reliable

### Docker analysis fails

```bash
# Build the image manually
docker build -t ollama-cli-analysis ./docker/analysis/

# Test the image
docker run --rm ollama-cli-analysis --version

# Check Docker access
docker ps
```

### SSH remote_exec fails

```bash
# Test SSH manually
ssh -o BatchMode=yes user@host "echo OK"

# Copy your key
ssh-copy-id user@host

# Check key permissions
chmod 600 ~/.ssh/id_ed25519
chmod 700 ~/.ssh
```

### SearXNG not available

The CLI falls back to DuckDuckGo instant answers automatically. To set up SearXNG:

```bash
docker compose up -d searxng
# Wait ~30 seconds for startup
curl http://localhost:8888/search?q=test&format=json
```

---

## Extending

### Adding a New Tool

1. Create `src/tools/mytool.js`:

```javascript
export class MyTool {
  get description() {
    return {
      name: 'my_tool',
      description: 'What this tool does',
      arguments: {
        param1: 'string - description',
        param2: 'string (optional) - description',
      },
    };
  }

  async execute({ param1, param2 }) {
    // Implementation
    return JSON.stringify({ result: 'data' });
  }
}
```

2. Register in `src/tools/index.js`:

```javascript
import { MyTool } from './mytool.js';
// In constructor:
this.register(new MyTool());
```

### Adding Analysis Scripts

1. Create Python script in `docker/analysis/scripts/`
2. Accept target path as `sys.argv[1]`
3. Output JSON to stdout
4. Add to `scriptMap` in `src/tools/analyze.js`

---

*Built by [IceAgent](https://github.com/icepaule)*
