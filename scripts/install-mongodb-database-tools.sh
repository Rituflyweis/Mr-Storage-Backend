#!/usr/bin/env bash
# Install mongodump on Linux (Render cron / CI). No-op if mongodump already exists.
set -euo pipefail

if command -v mongodump >/dev/null 2>&1; then
  echo "[mongodb-tools] mongodump already on PATH"
  exit 0
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "[mongodb-tools] skip install (non-Linux — install MongoDB Database Tools locally)"
  exit 0
fi

TOOLS_VERSION="${MONGODB_TOOLS_VERSION:-100.10.0}"
ARCH="${MONGODB_TOOLS_ARCH:-x86_64}"
TARBALL="mongodb-database-tools-ubuntu2204-${ARCH}-${TOOLS_VERSION}.tgz"
URL="https://fastdl.mongodb.org/tools/db/${TARBALL}"
INSTALL_DIR="${MONGODB_TOOLS_DIR:-/opt/mongodb-database-tools}"

echo "[mongodb-tools] downloading ${URL}"
mkdir -p "${INSTALL_DIR}"
curl -fsSL "${URL}" -o "/tmp/${TARBALL}"
tar -xzf "/tmp/${TARBALL}" -C "${INSTALL_DIR}" --strip-components=1
rm -f "/tmp/${TARBALL}"

if [[ -f "${INSTALL_DIR}/bin/mongodump" ]]; then
  echo "[mongodb-tools] installed to ${INSTALL_DIR}/bin"
  echo "export PATH=\"${INSTALL_DIR}/bin:\$PATH\"" >> "${HOME}/.bashrc" 2>/dev/null || true
  export PATH="${INSTALL_DIR}/bin:${PATH}"
else
  echo "[mongodb-tools] install failed — mongodump not found after extract" >&2
  exit 1
fi
