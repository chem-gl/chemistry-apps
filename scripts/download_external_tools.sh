#!/usr/bin/env bash
set -euo pipefail

# Resolve repo root and base tools directory
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
TOOLS_DIR="$ROOT_DIR/tools/external"

# Subfolders (already exist in repo structure)
AMBIT_DIR="$TOOLS_DIR/ambitSA"
TEST_DIR="$TOOLS_DIR/test"

# URLs requested by user
AMBIT_SYNTH_URL="http://web.uni-plovdiv.bg/nick/ambit-tools/SyntheticAccessibilityCli.jar"
TEST_ZIP_URL="https://github.com/CesarGuzmanLopez/test-app-epa/releases/download/master/script.zip"

# Target filenames
AMBIT_SYNTH_JAR="$AMBIT_DIR/SyntheticAccessibilityCli.jar"
TEST_ZIP="$TEST_DIR/script.zip"

mkdir -p "$AMBIT_DIR" "$TEST_DIR"

fetch() {
  local url="$1" dest="$2"
  if [[ -f "$dest" ]]; then
    echo "Already present: $dest (skip)"
    return 0
  fi
  echo "Downloading: $url -> $dest"
  curl -L --fail --retry 3 --connect-timeout 15 -o "$dest" "$url"
}

validate_jar() {
  local jar_path="$1"
  if command -v jar >/dev/null 2>&1; then
    if ! jar tf "$jar_path" >/dev/null 2>&1; then
      echo "ERROR: $jar_path appears to be corrupt. Delete it and re-run." >&2
      return 1
    fi
  else
    # If JDK tools aren't available, do a minimal ZIP header check
    if ! head -c 4 "$jar_path" | grep -q $'PK\x03\x04'; then
      echo "WARNING: Could not fully validate $jar_path (no 'jar' command)." >&2
    fi
  fi
}

echo "=== AMBIT SyntheticAccessibility CLI ==="
echo "Target: $AMBIT_SYNTH_JAR"
# Note: This JAR can be committed to the repo (lightweight). We still fetch if missing.
fetch "$AMBIT_SYNTH_URL" "$AMBIT_SYNTH_JAR" || true
if [[ -f "$AMBIT_SYNTH_JAR" ]]; then
  validate_jar "$AMBIT_SYNTH_JAR"
  echo "✅ AMBIT SyntheticAccessibilityCli ready"
else
  echo "ℹ️ Skipped AMBIT SyntheticAccessibilityCli download (will use repo copy if present)."
fi

echo "=== EPA WebTEST ==="
echo "Target: $TEST_ZIP"
fetch "$TEST_ZIP_URL" "$TEST_ZIP"

# Descomprimir el archivo ZIP
if [[ -f "$TEST_ZIP" ]]; then
  echo "Extracting $TEST_ZIP to $TEST_DIR..."
  unzip -q -o "$TEST_ZIP" -d "$TEST_DIR"
  echo "✅ EPA WebTEST extracted successfully"
  
  # Verificar que el JAR principal existe después de la extracción
  if [[ -f "$TEST_DIR/WebTEST.jar" ]]; then
    validate_jar "$TEST_DIR/WebTEST.jar"
    echo "✅ EPA WebTEST WebTEST.jar validated"
  else
    echo "⚠️ Warning: WebTEST.jar not found after extraction"
  fi
else
  echo "❌ Failed to download TEST ZIP"
fi

echo
echo "External tools ready under: $TOOLS_DIR"
ls -lh "$AMBIT_SYNTH_JAR" "$TEST_DIR"/ 2>/dev/null || true

