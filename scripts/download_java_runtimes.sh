#!/usr/bin/env bash
set -euo pipefail

# Download portable JRE 8, JRE 17 and JRE 21 for Linux x64 into tools/java/
# You can adapt URLs for other platforms if needed.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JAVA_DIR="$ROOT_DIR/tools/java"
JRE8_DIR="$JAVA_DIR/jre8"
JRE17_DIR="$JAVA_DIR/jre17"
JRE21_DIR="$JAVA_DIR/jre21"

JRE8_URL="https://github.com/adoptium/temurin8-binaries/releases/download/jdk8u402-b06/OpenJDK8U-jre_x64_linux_hotspot_8u402b06.tar.gz"
JRE17_URL="https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.10+7/OpenJDK17U-jre_x64_linux_hotspot_17.0.10_7.tar.gz"
JRE21_URL="https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.2+13/OpenJDK21U-jre_x64_linux_hotspot_21.0.2_13.tar.gz"

mkdir -p "$JAVA_DIR"

fetch_and_extract() {
  local url="$1" dest_dir="$2" name="$3" expected_version="$4"
  local tarball="$JAVA_DIR/${name}.tar.gz"
  
  # Check if already exists and verify version
  if [[ -d "$dest_dir" && -x "$dest_dir/bin/java" ]]; then
    local current_version
    current_version=$("$dest_dir/bin/java" -version 2>&1 | head -n1 | grep -oP '"\K[^"]+' || echo "unknown")
    if [[ "$current_version" == *"$expected_version"* ]]; then
      echo "✓ $name already present and verified: $dest_dir ($current_version)"
      return 0
    else
      echo "⚠ $name exists but version mismatch (expected $expected_version, found $current_version). Re-downloading..."
      rm -rf "$dest_dir"
    fi
  fi
  
  echo "Downloading $name from $url ..."
  curl -L --fail --retry 3 --connect-timeout 15 -o "$tarball" "$url" || {
    echo "ERROR: Failed to download $name" >&2
    return 1
  }
  
  # Verify download
  if [[ ! -f "$tarball" || ! -s "$tarball" ]]; then
    echo "ERROR: Downloaded file is empty or missing" >&2
    return 1
  fi
  
  echo "Extracting $name ..."
  rm -rf "$dest_dir"
  mkdir -p "$JAVA_DIR"
  
  # Extract and get the top-level directory name
  local extracted_dir
  extracted_dir=$(tar -tzf "$tarball" 2>/dev/null | head -1 | cut -f1 -d"/")
  
  if [[ -z "$extracted_dir" ]]; then
    echo "ERROR: Could not determine extracted directory name" >&2
    rm -f "$tarball"
    return 1
  fi
  
  tar -xzf "$tarball" -C "$JAVA_DIR" || {
    echo "ERROR: Failed to extract $tarball" >&2
    rm -f "$tarball"
    return 1
  }
  
  # Move extracted directory to destination
  if [[ -d "$JAVA_DIR/$extracted_dir" ]]; then
    mv "$JAVA_DIR/$extracted_dir" "$dest_dir"
  else
    echo "ERROR: Extracted directory $JAVA_DIR/$extracted_dir not found" >&2
    rm -f "$tarball"
    return 1
  fi
  
  rm -f "$tarball"
  
  # Verify installation
  if [[ ! -x "$dest_dir/bin/java" ]]; then
    echo "ERROR: Java executable not found after extraction" >&2
    return 1
  fi
  
  local downloaded_version
  downloaded_version=$("$dest_dir/bin/java" -version 2>&1 | head -n1 | grep -oP '"\K[^"]+' || echo "unknown")
  echo "✓ $name ready at $dest_dir ($downloaded_version)"
}

fetch_and_extract "$JRE8_URL" "$JRE8_DIR" "jre8" "1.8.0" || echo "⚠ Failed to download/extract jre8"
fetch_and_extract "$JRE17_URL" "$JRE17_DIR" "jre17" "17.0" || echo "⚠ Failed to download/extract jre17"
fetch_and_extract "$JRE21_URL" "$JRE21_DIR" "jre21" "21.0" || echo "⚠ Failed to download/extract jre21"

echo ""
echo "=========================================="
echo "Portable JREs verification:"
echo "=========================================="

verify_java() {
  local java_bin="$1" name="$2"
  if [[ -x "$java_bin" ]]; then
    local version
    version=$("$java_bin" -version 2>&1 | head -n1)
    if [[ $? -eq 0 ]]; then
      echo "✓ $name: OK - $version"
      return 0
    else
      echo "✗ $name: FAILED - Executable exists but cannot run"
      return 1
    fi
  else
    echo "✗ $name: NOT FOUND at $(dirname $java_bin)"
    return 1
  fi
}

verify_java "$JRE8_DIR/bin/java" "JRE 8 "
verify_java "$JRE17_DIR/bin/java" "JRE 17"
verify_java "$JRE21_DIR/bin/java" "JRE 21"

echo "=========================================="
