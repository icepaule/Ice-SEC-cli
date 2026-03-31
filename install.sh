#!/bin/bash
# Ice-SEC-cli - One-Command Installer for Ubuntu/Debian
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/icepaule/Ice-SEC-cli/main/install.sh | bash
#   curl -fsSL ... | bash -s -- --ollama-host 10.10.0.210
#   curl -fsSL ... | bash -s -- --ollama-host 10.10.0.210 --model qwen2.5:14b --with-docker

set -e

# --- Defaults ---
OLLAMA_HOST="localhost"
OLLAMA_PORT="11434"
MODEL="qwen2.5:14b"
INSTALL_DIR="/opt/Ice-SEC-cli"
WITH_DOCKER=false

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[*]${NC} $1"; }
ok()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
fail()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# --- Parse arguments ---
while [[ $# -gt 0 ]]; do
  case $1 in
    --ollama-host) OLLAMA_HOST="$2"; shift 2 ;;
    --ollama-port) OLLAMA_PORT="$2"; shift 2 ;;
    --model)       MODEL="$2"; shift 2 ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --with-docker) WITH_DOCKER=true; shift ;;
    --help)
      echo "Usage: install.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --ollama-host HOST   Ollama server IP/hostname (default: localhost)"
      echo "  --ollama-port PORT   Ollama port (default: 11434)"
      echo "  --model MODEL        Default LLM model (default: qwen2.5:14b)"
      echo "  --install-dir DIR    Installation directory (default: /opt/Ice-SEC-cli)"
      echo "  --with-docker        Also set up SearXNG and analysis containers"
      echo ""
      echo "Examples:"
      echo "  # Local Ollama"
      echo "  curl -fsSL https://raw.githubusercontent.com/icepaule/Ice-SEC-cli/main/install.sh | bash"
      echo ""
      echo "  # Remote Ollama server"
      echo "  curl -fsSL ... | bash -s -- --ollama-host 10.10.0.210"
      echo ""
      echo "  # Full setup with Docker containers"
      echo "  curl -fsSL ... | bash -s -- --ollama-host 10.10.0.210 --with-docker"
      exit 0
      ;;
    *) warn "Unknown option: $1"; shift ;;
  esac
done

OLLAMA_URL="http://${OLLAMA_HOST}:${OLLAMA_PORT}"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  Ice-SEC-cli Installer                           ║${NC}"
echo -e "${CYAN}║  Security analysis CLI powered by local LLM      ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# --- 1. Check/Install Node.js ---
info "Checking Node.js..."
if command -v node &>/dev/null; then
  NODE_VER=$(node -v | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 18 ]; then
    ok "Node.js $NODE_VER found"
  else
    warn "Node.js $NODE_VER is too old (need >= 18), installing..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
    ok "Node.js $(node -v) installed"
  fi
else
  info "Installing Node.js 22.x..."
  sudo apt-get update -qq
  sudo apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ok "Node.js $(node -v) installed"
fi

# --- 2. Check/Install Git ---
if ! command -v git &>/dev/null; then
  info "Installing git..."
  sudo apt-get install -y git
fi

# --- 3. Clone or update repository ---
info "Setting up Ice-SEC-cli in ${INSTALL_DIR}..."
if [ -d "${INSTALL_DIR}/.git" ]; then
  info "Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull --ff-only origin main 2>/dev/null || true
  ok "Updated"
else
  sudo mkdir -p "$(dirname "$INSTALL_DIR")"
  sudo git clone https://github.com/icepaule/Ice-SEC-cli.git "$INSTALL_DIR"
  sudo chown -R "$(whoami)" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  ok "Cloned to ${INSTALL_DIR}"
fi

# --- 4. Install npm dependencies ---
info "Installing dependencies..."
npm install --production 2>&1 | tail -1
ok "Dependencies installed"

# --- 5. Create config ---
CONFIG_DIR="${HOME}/.config/ollama-cli"
CONFIG_FILE="${CONFIG_DIR}/config.env"
mkdir -p "$CONFIG_DIR"

if [ ! -f "$CONFIG_FILE" ]; then
  cat > "$CONFIG_FILE" << ENVEOF
# Ice-SEC-cli - Configuration
OLLAMA_API_URL=${OLLAMA_URL}
OLLAMA_MODEL=${MODEL}
SEARXNG_URL=http://localhost:8888
ANALYSIS_IMAGE=ollama-cli-analysis
MAX_AGENT_ITERATIONS=15
NUM_CTX=8192
ENVEOF
  ok "Config created: ${CONFIG_FILE}"
else
  # Update Ollama URL if a host was explicitly provided
  if [ "$OLLAMA_HOST" != "localhost" ]; then
    sed -i "s|OLLAMA_API_URL=.*|OLLAMA_API_URL=${OLLAMA_URL}|" "$CONFIG_FILE"
    ok "Config updated with Ollama host: ${OLLAMA_HOST}"
  else
    ok "Config exists: ${CONFIG_FILE}"
  fi
fi

# --- 6. Install globally ---
info "Installing 'sec' command globally..."
sudo npm link 2>&1 | tail -1
ok "'sec' and 'ollama-cli' commands available globally"

# --- 7. Check Ollama connectivity ---
info "Checking Ollama at ${OLLAMA_URL}..."
if curl -s --connect-timeout 5 "${OLLAMA_URL}/api/tags" >/dev/null 2>&1; then
  ok "Ollama is reachable"

  # Check if model is available
  MODEL_EXISTS=$(curl -s "${OLLAMA_URL}/api/tags" 2>/dev/null | grep -c "\"${MODEL}\"" || true)
  if [ "$MODEL_EXISTS" -gt 0 ]; then
    ok "Model '${MODEL}' is available"
  else
    warn "Model '${MODEL}' not found on server"
    info "Pull it with: ollama pull ${MODEL}"
    info "Or from this machine: curl -X POST ${OLLAMA_URL}/api/pull -d '{\"name\":\"${MODEL}\"}'"
  fi
else
  warn "Ollama not reachable at ${OLLAMA_URL}"
  echo "  Make sure Ollama is running: OLLAMA_HOST=0.0.0.0 ollama serve"
  echo "  Or change OLLAMA_API_URL in: ${CONFIG_FILE}"
fi

# --- 8. Docker setup (optional) ---
if [ "$WITH_DOCKER" = true ]; then
  info "Setting up Docker containers..."
  if command -v docker &>/dev/null; then
    cd "$INSTALL_DIR"
    docker compose build analysis 2>&1 | tail -3
    docker compose up -d searxng 2>&1 | tail -3
    ok "Docker containers running"
  else
    warn "Docker not found. Install Docker first:"
    echo "  curl -fsSL https://get.docker.com | sh"
    echo "  Then re-run with --with-docker"
  fi
fi

# --- Done ---
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Installation complete!                          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo "  Usage:"
echo -e "    ${CYAN}sec${NC}                        Interactive session"
echo -e "    ${CYAN}sec ask \"...\"${NC}              Single question"
echo -e "    ${CYAN}sec analyze /path/to/code${NC}  Security scan"
echo -e "    ${CYAN}sec search \"CVE-...\"${NC}       Web search"
echo -e "    ${CYAN}sec models${NC}                 List models"
echo ""
echo "  Config: ${CONFIG_FILE}"
echo "  Install: ${INSTALL_DIR}"
echo ""
