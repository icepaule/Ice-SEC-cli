#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

OLLAMA_HOST="${OLLAMA_HOST:-localhost}"
OLLAMA_PORT="${OLLAMA_PORT:-11434}"
OLLAMA_URL="http://${OLLAMA_HOST}:${OLLAMA_PORT}"

echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   Ollama Security CLI - Setup            ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

# 1. Check Ollama connectivity
echo -e "${YELLOW}[1/5] Checking Ollama server at ${OLLAMA_URL}...${NC}"
if curl -s --connect-timeout 5 "${OLLAMA_URL}/api/tags" > /dev/null 2>&1; then
    echo -e "${GREEN}  ✓ Ollama server is reachable${NC}"
    echo "  Available models:"
    curl -s "${OLLAMA_URL}/api/tags" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for m in data.get('models', []):
    size_gb = m.get('size', 0) / (1024**3)
    print(f\"    - {m['name']} ({size_gb:.1f} GB)\")
" 2>/dev/null || echo "    (could not list models)"
else
    echo -e "${RED}  ✗ Cannot reach Ollama at ${OLLAMA_URL}${NC}"
    echo "  Make sure Ollama is running: OLLAMA_HOST=0.0.0.0 ollama serve"
    echo "  Or set OLLAMA_HOST env var to the correct IP"
    exit 1
fi

# 2. Pull base model
echo ""
echo -e "${YELLOW}[2/5] Pulling base model (dolphin-llama3:8b)...${NC}"
echo "  This is an uncensored model suitable for security research."
echo "  RTX 3060 (12GB VRAM) compatible - ~4.7 GB download"
echo ""

PULL_RESPONSE=$(curl -s -X POST "${OLLAMA_URL}/api/pull" \
    -H "Content-Type: application/json" \
    -d '{"name": "dolphin-llama3:8b", "stream": false}' 2>&1)

if echo "$PULL_RESPONSE" | grep -q "success\|pulling\|already"; then
    echo -e "${GREEN}  ✓ Base model ready${NC}"
else
    echo "  Pulling with progress..."
    curl -X POST "${OLLAMA_URL}/api/pull" \
        -H "Content-Type: application/json" \
        -d '{"name": "dolphin-llama3:8b", "stream": true}' 2>/dev/null | \
        while IFS= read -r line; do
            status=$(echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null)
            if [ -n "$status" ]; then
                echo -ne "\r  ${status}                    "
            fi
        done
    echo ""
    echo -e "${GREEN}  ✓ Base model pulled${NC}"
fi

# 3. Create custom security model
echo ""
echo -e "${YELLOW}[3/5] Creating custom security model (securitybot)...${NC}"

MODELFILE_CONTENT=$(cat Modelfile)
CREATE_RESPONSE=$(curl -s -X POST "${OLLAMA_URL}/api/create" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c "
import json
with open('Modelfile') as f:
    content = f.read()
print(json.dumps({'name': 'securitybot', 'modelfile': content, 'stream': False}))
")" 2>&1)

echo -e "${GREEN}  ✓ Security model 'securitybot' created${NC}"

# 4. Build Docker containers
echo ""
echo -e "${YELLOW}[4/5] Building Docker containers...${NC}"

if command -v docker &> /dev/null; then
    echo "  Building analysis container (includes bandit, semgrep, pip-audit, detect-secrets)..."
    docker build -t ollama-cli-analysis ./docker/analysis/ 2>&1 | tail -1
    echo -e "${GREEN}  ✓ Analysis container built${NC}"

    echo "  Starting SearXNG search engine..."
    docker compose up -d searxng 2>&1 | tail -1
    echo -e "${GREEN}  ✓ SearXNG running on http://localhost:8888${NC}"
else
    echo -e "${RED}  ✗ Docker not found. Install Docker to use analysis and search features.${NC}"
    echo "  The CLI will still work for direct LLM interaction."
fi

# 5. Setup Node.js
echo ""
echo -e "${YELLOW}[5/5] Installing Node.js dependencies...${NC}"
npm install 2>&1 | tail -1

# Create .env if not exists
if [ ! -f .env ]; then
    cp .env.example .env
    sed -i "s/localhost/${OLLAMA_HOST}/" .env
    echo -e "${GREEN}  ✓ Created .env from .env.example${NC}"
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Setup complete!                        ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo "  Start the CLI:"
echo -e "    ${CYAN}node index.js${NC}              # Interactive mode"
echo -e "    ${CYAN}node index.js ask \"...\"${NC}    # One-shot query"
echo -e "    ${CYAN}node index.js analyze /path${NC} # Security scan"
echo ""
echo "  Models on ${OLLAMA_URL}:"
curl -s "${OLLAMA_URL}/api/tags" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for m in data.get('models', []):
    print(f\"    - {m['name']}\")
" 2>/dev/null || true
echo ""
