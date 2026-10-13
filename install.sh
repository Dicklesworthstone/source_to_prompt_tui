#!/usr/bin/env bash
set -euo pipefail
umask 022
shopt -s lastpipe 2>/dev/null || true

VERSION="${VERSION:-}"
OWNER="${OWNER:-Dicklesworthstone}"
REPO="${REPO:-source_to_prompt_tui}"
BINARY="${BINARY:-s2p}"
DEST_DEFAULT="$HOME/.local/bin"
DEST="${DEST:-$DEST_DEFAULT}"
QUIET=0
FROM_SOURCE=0
LOCK_FILE="/tmp/s2p-install.lock"
VERIFY=0
CHECKSUM_URL="${CHECKSUM_URL:-}"
INSTALL_NAME=""

log() { [ "$QUIET" -eq 1 ] && return 0; echo -e "$@"; }
info() { log "\033[0;34m→\033[0m $*"; }
ok()   { log "\033[0;32m✓\033[0m $*"; }
warn() { log "\033[1;33m⚠\033[0m $*"; }
err()  { log "\033[0;31m✗\033[0m $*"; }

usage() {
  cat <<'EOFU'
Usage: install.sh [--version vX.Y.Z] [--dest DIR] [--system] [--from-source] [--quiet] [--verify]

Options:
  --version vX.Y.Z   Install specific version (default: latest release)
  --dest DIR         Install directory (default: ~/.local/bin)
  --system           Install to /usr/local/bin (may require sudo)
  --from-source      Build from source instead of downloading binary
  --quiet, -q        Suppress output
  --verify           Require checksum verification (fail if unavailable)

Environment overrides:
  VERSION         Tag to install (defaults to latest release)
  OWNER           GitHub owner (default: Dicklesworthstone)
  REPO            GitHub repo  (default: source_to_prompt_tui)
  DEST            Install dir  (default: ~/.local/bin or /usr/local/bin with --system)
  BINARY          Installed name (default: s2p)
  CHECKSUM_URL    Override checksum location; --verify requires it
EOFU
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2;;
    --dest) DEST="$2"; shift 2;;
    --system) DEST="/usr/local/bin"; shift;;
    --from-source) FROM_SOURCE=1; shift;;
    --verify) VERIFY=1; shift;;
    --quiet|-q) QUIET=1; shift;;
    -h|--help) usage; exit 0;;
    *) shift;;
  esac
done

maybe_add_path() {
  case ":$PATH:" in
    *:"$DEST":*)
      ok "${DEST} is already in PATH"
      return 0
      ;;
    *)
      # Always try to update shell config files
      UPDATED=0
      UPDATED_FILES=""
      for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
        if [ -e "$rc" ] && [ -w "$rc" ]; then
          if ! grep -F "$DEST" "$rc" >/dev/null 2>&1; then
            echo "" >> "$rc"
            echo "# Added by s2p installer" >> "$rc"
            echo "export PATH=\"$DEST:\$PATH\"" >> "$rc"
            UPDATED=1
            UPDATED_FILES="${UPDATED_FILES} $(basename "$rc")"
          fi
        fi
      done
      if [ "$UPDATED" -eq 1 ]; then
        ok "PATH updated in:${UPDATED_FILES}"
        info "Restart your shell or run: source ~/.zshrc (or ~/.bashrc)"
      else
        warn "Could not update shell config. Add to PATH manually:"
        warn "  export PATH=\"$DEST:\$PATH\""
      fi
      ;;
  esac
}

resolve_version() {
  if [ -n "$VERSION" ]; then return 0; fi
  local latest_url="https://api.github.com/repos/${OWNER}/${REPO}/releases/latest"
  local tag=""
  info "Resolving latest version..."
  if ! tag=$(curl -fsSL -H "Accept: application/vnd.github.v3+json" "$latest_url" 2>/dev/null | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/'); then
    tag=""
  fi
  if [ -n "$tag" ]; then
    VERSION="$tag"
    info "Resolved latest: $VERSION"
  else
    VERSION=""
    warn "Could not resolve latest version; will use releases/latest URL"
  fi
}

detect_target() {
  OS=$(uname -s | tr 'A-Z' 'a-z')
  case "$OS" in
    mingw*|msys*|cygwin*) OS="windows" ;;
  esac
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64|amd64) ARCH="x86_64" ;;
    arm64|aarch64)
      if [ "$OS" = "darwin" ]; then
        ARCH="arm64"
      else
        ARCH="aarch64"
      fi
    ;;
  esac

  ASSET=""
  case "${OS}-${ARCH}" in
    linux-x86_64)
      ASSET="s2p-linux-x64"
      # Bun's x64 runtime needs AVX2; without it the binary dies with SIGILL
      # (exit 132) before printing anything.
      if [ -r /proc/cpuinfo ] && ! grep -qw avx2 /proc/cpuinfo; then
        ASSET="s2p-linux-x64-baseline"
        info "CPU lacks AVX2; using the baseline build"
      fi
      ;;
    linux-aarch64) ASSET="s2p-linux-arm64" ;;
    darwin-arm64) ASSET="s2p-macos-arm64" ;;
    darwin-x86_64) ASSET="s2p-macos-x64" ;;
    windows-x86_64) ASSET="s2p-windows-x64.exe" ;;
    *) warn "Unknown platform ${OS}/${ARCH}; will build from source (requires git + bun)"; FROM_SOURCE=1 ;;
  esac
}

compute_install_name() {
  INSTALL_NAME="$BINARY"
  if [ "${OS:-}" = "windows" ]; then
    case "$INSTALL_NAME" in
      *.exe) ;;
      *) INSTALL_NAME="${INSTALL_NAME}.exe" ;;
    esac
  fi
}

lock() {
  LOCK_DIR="${LOCK_FILE}.d"
  LOCKED=0
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    LOCKED=1
    echo $$ > "$LOCK_DIR/pid"
  else
    if [ -f "$LOCK_DIR/pid" ]; then
      OLD_PID=$(cat "$LOCK_DIR/pid" 2>/dev/null || echo "")
      if [ -n "$OLD_PID" ] && ! kill -0 "$OLD_PID" 2>/dev/null; then
        rm -rf "$LOCK_DIR"
        if mkdir "$LOCK_DIR" 2>/dev/null; then
          LOCKED=1
          echo $$ > "$LOCK_DIR/pid"
        fi
      fi
    fi
  fi
  if [ "$LOCKED" -eq 0 ]; then
    err "Another installer is running (lock $LOCK_DIR)"
    exit 1
  fi
}

cleanup() {
  rm -rf "$TMP"
  if [ "${LOCKED:-0}" -eq 1 ]; then rm -rf "$LOCK_DIR"; fi
}

download_binary() {
  local tag_path
  if [ -n "$VERSION" ]; then
    tag_path="download/${VERSION}"
  else
    tag_path="latest/download"
  fi
  local url="https://github.com/${OWNER}/${REPO}/releases/${tag_path}/${ASSET}"
  info "Downloading ${url}"
  if ! curl -fL "$url" -o "$TMP/${ASSET}"; then
    warn "Download failed; falling back to build from source (requires git + bun)"
    FROM_SOURCE=1
    return 1
  fi

  # Optional checksum verification
  local hash_cmd=""
  if command -v sha256sum >/dev/null 2>&1; then
    hash_cmd="sha256sum"
  elif command -v shasum >/dev/null 2>&1; then
    hash_cmd="shasum -a 256"
  fi

  if [ -n "$hash_cmd" ]; then
    local checksum_target="${CHECKSUM_URL:-${url}.sha256}"
    if curl -fL "$checksum_target" -o "$TMP/${ASSET}.sha256"; then
      local expected
      expected=$(awk '{print $1}' "$TMP/${ASSET}.sha256" | head -n1)
      if [ -n "$expected" ]; then
        # Verify checksum without eval
        if ! echo "${expected}  $TMP/${ASSET}" | $hash_cmd -c -; then
           err "Checksum verification failed"
           exit 1
        fi
        ok "Checksum verified"
      fi
    else
      if [ "$VERIFY" -eq 1 ]; then
        err "Checksum required but not available at ${checksum_target}"
        exit 1
      else
        warn "Checksum not available; proceeding without verification"
      fi
    fi
  else
    warn "No sha256 utility found; skipping checksum verification"
  fi

  # Never replace a working install with a binary that cannot run here.
  chmod 0755 "$TMP/${ASSET}"
  if [ "${OS:-}" != "windows" ] && ! "$TMP/${ASSET}" --version >/dev/null 2>&1; then
    err "Downloaded ${ASSET} does not run on this machine; ${DEST}/${INSTALL_NAME} left unchanged"
    exit 1
  fi

  install -m 0755 "$TMP/${ASSET}" "$DEST/${INSTALL_NAME}"
  ok "Installed ${INSTALL_NAME} to $DEST"
}

build_from_source() {
  info "Building from source (requires git + bun)"
  command -v git >/dev/null 2>&1 || { err "git is required"; exit 1; }
  command -v bun >/dev/null 2>&1 || { err "bun is required"; exit 1; }

  git clone --depth 1 "https://github.com/${OWNER}/${REPO}.git" "$TMP/src"
  (
    cd "$TMP/src"
    bun install --frozen-lockfile
    bun run build:bin
  )

  local built_base="s2p"
  local bin_path="$TMP/src/dist/${built_base}"
  if [ ! -f "$bin_path" ] && [ -f "$TMP/src/dist/${built_base}.exe" ]; then
    bin_path="$TMP/src/dist/${built_base}.exe"
  fi
  [ -f "$bin_path" ] || { err "Build failed; binary not found"; exit 1; }
  install -m 0755 "$bin_path" "$DEST/${INSTALL_NAME}"
  ok "Installed ${INSTALL_NAME} to $DEST (built from source)"
}

resolve_version
detect_target
compute_install_name
lock
TMP=$(mktemp -d)
trap cleanup EXIT
mkdir -p "$DEST"

STEP_TOTAL=6
STEP_IDX=1
log_step() {
  info "[$STEP_IDX/$STEP_TOTAL] $*"
  STEP_IDX=$((STEP_IDX+1))
}

log_step "Resolved version ${VERSION:-latest}"
log_step "Detected platform ${OS:-unknown}/${ARCH:-unknown}"

DOWNLOAD_OK=1
if [ "$FROM_SOURCE" -eq 0 ]; then
  log_step "Downloading release artifact"
  download_binary || DOWNLOAD_OK=0
else
  log_step "Skipping download (build from source requested)"
  DOWNLOAD_OK=0
fi

if [ "$FROM_SOURCE" -eq 0 ] && [ "$DOWNLOAD_OK" -eq 0 ]; then
  FROM_SOURCE=1
fi

if [ "$FROM_SOURCE" -eq 1 ]; then
  log_step "Building from source"
  build_from_source
else
  log_step "Build step skipped (binary already downloaded)"
fi

log_step "Ensuring ${DEST} is on PATH"
maybe_add_path
log_step "Finalizing"
ok "Done. Run: ${BINARY} (in any project directory)"
