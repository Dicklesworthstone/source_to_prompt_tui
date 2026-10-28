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
err()  { printf '\033[0;31m✗\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

usage() {
  cat <<'EOFU'
Usage: install.sh [--version vX.Y.Z] [--dest DIR] [--system] [--from-source] [--quiet] [--verify]

Options:
  --version vX.Y.Z   Install specific version (default: latest release)
  --dest DIR         Install directory (default: ~/.local/bin)
  --system           Install to /usr/local/bin (may require sudo)
  --from-source      Build the requested release ref instead of downloading a binary
  --quiet, -q        Suppress output
  --verify           Require a release checksum comparison (no source fallback)

Environment overrides:
  VERSION         Tag to install (defaults to latest release)
  OWNER           GitHub owner (default: Dicklesworthstone)
  REPO            GitHub repo  (default: source_to_prompt_tui)
  DEST            Install dir  (default: ~/.local/bin or /usr/local/bin with --system)
  BINARY          Installed name (default: s2p)
  CHECKSUM_URL    Override checksum location (makes checksum verification required)
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

download_file() {
  # Only a completed HTTP 404/410 response means an optional artifact is absent.
  # A timeout, interrupted body, TLS error, or server error must never enable fallback.
  local url="$1" output="$2" http_status="" curl_status=0
  if http_status=$(curl --fail --location --silent --show-error \
    --connect-timeout 15 --max-time 300 \
    --user-agent 's2p-installer (+https://github.com/Dicklesworthstone/source_to_prompt_tui)' \
    --output "$output" --write-out '%{http_code}' "$url"); then
    return 0
  else
    curl_status=$?
  fi
  if [ "$curl_status" -eq 22 ] && { [ "$http_status" = 404 ] || [ "$http_status" = 410 ]; }; then
    return 44
  fi
  err "Download failed for $url (curl exit $curl_status; HTTP ${http_status:-unknown})"
  return 1
}

encode_release_ref() {
  # A tag is one URL path segment even when it contains slashes, plus signs, or
  # percent signs. Do not let curl reinterpret it as a different release URL.
  local value="$1" encoded="" char code i LC_ALL=C
  case "$value" in .|..) die "Invalid release ref: $value" ;; esac
  for ((i=0; i<${#value}; i++)); do
    char="${value:i:1}"
    case "$char" in
      [a-zA-Z0-9._~-]) encoded+="$char" ;;
      *) printf -v code '%%%02X' "'$char"; encoded+="$code" ;;
    esac
  done
  printf '%s' "$encoded"
}

resolve_version() {
  if [ -n "$VERSION" ]; then return 0; fi
  local latest_url="https://api.github.com/repos/${OWNER}/${REPO}/releases/latest"
  local tag=""
  info "Resolving latest version..."
  if ! download_file "$latest_url" "$TMP/latest.json"; then
    die "Could not resolve the latest release; retry or select an explicit --version"
  fi
  tag=$(grep -o '"tag_name": *"[^"]*"' "$TMP/latest.json" | head -n 1 | sed -E 's/.*"([^"]*)"$/\1/') || tag=""
  case "$tag" in v[0-9]*|[0-9]*) ;; *) tag="" ;; esac
  if [ -n "$tag" ]; then
    VERSION="$tag"
    info "Resolved latest: $VERSION"
  else
    die "Could not resolve the latest release; select an explicit --version"
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
  if [ -n "${TMP:-}" ]; then rm -rf "$TMP"; fi
  if [ "${LOCKED:-0}" -eq 1 ]; then rm -rf "$LOCK_DIR"; fi
}

verify_checksum() {
  local artifact="$1" checksum_target="${CHECKSUM_URL:-${2}.sha256}"
  local status expected actual hash_output filename record rest
  if download_file "$checksum_target" "$TMP/checksum.sha256"; then
    :
  else
    status=$?
    if [ "$status" -eq 44 ] && [ "$VERIFY" -eq 0 ] && [ -z "$CHECKSUM_URL" ]; then
      warn "Checksum not available; proceeding without verification"
      return 0
    fi
    die "Checksum required but could not be downloaded from $checksum_target"
  fi

  # Accept exactly one record: a SHA256 digest and, optionally, the matching
  # release asset name. Empty, truncated, ambiguous, or unrelated metadata fails
  # even when a missing default sidecar would have been optional.
  if LC_ALL=C grep -aq '[^[:print:][:space:]]' "$TMP/checksum.sha256"; then
    die "Malformed checksum file: invalid control characters"
  fi
  record=""
  while IFS= read -r rest || [ -n "$rest" ]; do
    rest="${rest%$'\r'}"
    case "$rest" in *[![:space:]]*) ;; *) continue ;; esac
    [ -z "$record" ] || die "Malformed checksum file: expected a single SHA256 record"
    record="$rest"
  done < "$TMP/checksum.sha256"
  expected=""; filename=""; rest=""
  IFS=$' \t' read -r expected filename rest <<< "$record" || true
  [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || die "Malformed checksum file: expected a SHA256 hash"
  [ -z "$rest" ] || die "Malformed checksum file: unexpected fields"
  if [ -n "$filename" ]; then
    filename="${filename#\*}"
    [ "$filename" = "$ASSET" ] || die "Checksum filename does not match $ASSET"
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    hash_output=$(sha256sum < "$artifact") || die "SHA256 computation failed"
  elif command -v shasum >/dev/null 2>&1; then
    hash_output=$(shasum -a 256 < "$artifact") || die "SHA256 computation failed"
  else
    die "No SHA256 utility found; install sha256sum or shasum to verify the artifact"
  fi
  actual="${hash_output%% *}"
  [[ "$actual" =~ ^[0-9a-fA-F]{64}$ ]] || die "SHA256 utility did not return a valid hash"
  expected=$(printf '%s' "$expected" | tr 'A-F' 'a-f')
  actual=$(printf '%s' "$actual" | tr 'A-F' 'a-f')
  [ "$actual" = "$expected" ] || die "Checksum mismatch for $ASSET"
  ok "Checksum verified"
}

install_artifact() {
  local artifact="$1"
  [ -s "$artifact" ] || die "Artifact is empty or missing: $artifact"
  chmod 0755 "$artifact" || die "Could not make the artifact executable"
  # Never replace a working install with a binary that cannot run here.
  if [ "${OS:-}" != "windows" ] && ! "$artifact" --version >/dev/null 2>&1; then
    die "Artifact does not run on this machine; ${DEST}/${INSTALL_NAME} left unchanged"
  fi
  [ ! -d "$DEST/$INSTALL_NAME" ] || die "Install destination is a directory: $DEST/$INSTALL_NAME"
  install -m 0755 "$artifact" "$DEST/$INSTALL_NAME" || die "Could not install $INSTALL_NAME to $DEST"
}

download_binary() {
  local encoded_version url status
  encoded_version=$(encode_release_ref "$VERSION") || die "Invalid release ref: $VERSION"
  url="https://github.com/${OWNER}/${REPO}/releases/download/${encoded_version}/${ASSET}"
  info "Downloading ${url}"
  if download_file "$url" "$TMP/$ASSET"; then
    :
  else
    status=$?
    if [ "$status" -eq 44 ] && [ "$VERIFY" -eq 0 ] && [ -z "$CHECKSUM_URL" ]; then
      warn "Release artifact unavailable; building the requested release $VERSION from source"
      FROM_SOURCE=1
      return 0
    fi
    if [ "$status" -eq 44 ]; then
      die "Release artifact unavailable; required checksum verification cannot use a source build"
    fi
    die "Release download failed; installation aborted"
  fi

  verify_checksum "$TMP/$ASSET" "$url"
  install_artifact "$TMP/$ASSET"
  ok "Installed ${INSTALL_NAME} to $DEST (release $VERSION)"
}

build_from_source() {
  info "Building release $VERSION from source (requires git + bun)"
  command -v git >/dev/null 2>&1 || { err "git is required"; exit 1; }
  command -v bun >/dev/null 2>&1 || { err "bun is required"; exit 1; }

  local source_ref="refs/tags/$VERSION" source_commit
  if [[ "$VERSION" =~ ^[0-9a-fA-F]{40}$ ]]; then
    source_ref="$VERSION"
  else
    git check-ref-format "$source_ref" >/dev/null || die "Invalid release ref: $VERSION"
  fi
  git init -q "$TMP/src" || die "Could not create source workspace"
  git -C "$TMP/src" remote add origin "https://github.com/${OWNER}/${REPO}.git" || die "Could not configure source repository"
  git -C "$TMP/src" fetch --depth 1 origin "$source_ref" || die "Could not fetch release ref $VERSION"
  git -C "$TMP/src" checkout --detach FETCH_HEAD || die "Could not check out release ref $VERSION"
  source_commit=$(git -C "$TMP/src" rev-parse --verify 'HEAD^{commit}') || die "Could not identify source commit"
  info "Source provenance: $VERSION at $source_commit (locally built; not a release checksum verification)"
  if ! (
    cd "$TMP/src" || exit 1
    bun install --frozen-lockfile || exit 1
    bun run build:bin || exit 1
  ); then
    die "Source build failed for $VERSION at $source_commit"
  fi

  local built_base="s2p"
  local bin_path="$TMP/src/dist/${built_base}"
  if [ ! -f "$bin_path" ] && [ -f "$TMP/src/dist/${built_base}.exe" ]; then
    bin_path="$TMP/src/dist/${built_base}.exe"
  fi
  [ -f "$bin_path" ] || { err "Build failed; binary not found"; exit 1; }
  install_artifact "$bin_path"
  ok "Installed ${INSTALL_NAME} to $DEST (built from $VERSION at $source_commit)"
}

lock
TMP=""
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
TMP=$(mktemp -d) || die "Could not create temporary workspace"
resolve_version
detect_target
compute_install_name
if [ "$FROM_SOURCE" -eq 1 ] && { [ "$VERIFY" -eq 1 ] || [ -n "$CHECKSUM_URL" ]; }; then
  die "Release checksum verification requires a prebuilt artifact; cannot combine it with a source build"
fi
mkdir -p "$DEST" || die "Could not create install directory: $DEST"

STEP_TOTAL=6
STEP_IDX=1
log_step() {
  info "[$STEP_IDX/$STEP_TOTAL] $*"
  STEP_IDX=$((STEP_IDX+1))
}

log_step "Resolved version ${VERSION:-latest}"
log_step "Detected platform ${OS:-unknown}/${ARCH:-unknown}"

if [ "$FROM_SOURCE" -eq 0 ]; then
  log_step "Downloading release artifact"
  download_binary
else
  log_step "Skipping download (build from source requested)"
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
