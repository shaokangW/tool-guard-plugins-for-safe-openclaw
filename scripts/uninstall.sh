#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_PATH="${HOME}/.openclaw/openclaw.json"

if [[ ! -f "${CONFIG_PATH}" ]]; then
  echo "OpenClaw config not found at ${CONFIG_PATH}" >&2
  exit 1
fi

PROJECT_ROOT="${PROJECT_ROOT}" CONFIG_PATH="${CONFIG_PATH}" node --input-type=module <<'EOF'
import fs from "node:fs";

const projectRoot = process.env.PROJECT_ROOT;
const configPath = process.env.CONFIG_PATH;

const raw = fs.readFileSync(configPath, "utf8");
const config = JSON.parse(raw);

if (config.plugins) {
  if (Array.isArray(config.plugins.allow)) {
    config.plugins.allow = config.plugins.allow.filter((item) => item !== "tool-guard");
  }

  if (config.plugins.load && Array.isArray(config.plugins.load.paths)) {
    config.plugins.load.paths = config.plugins.load.paths.filter((item) => item !== projectRoot);
  }

  if (config.plugins.entries && typeof config.plugins.entries === "object") {
    delete config.plugins.entries["tool-guard"];
  }
}

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
EOF

echo "Updated OpenClaw config."
echo "Uninstalling plugin registration"
openclaw plugins uninstall tool-guard

echo "Validating OpenClaw config"
openclaw config validate

echo "tool-guard uninstall complete."
