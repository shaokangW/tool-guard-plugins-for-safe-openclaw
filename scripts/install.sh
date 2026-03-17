#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_PATH="${HOME}/.openclaw/openclaw.json"
RULES_ROOT="${PROJECT_ROOT}/examples/rules"

if [[ ! -f "${CONFIG_PATH}" ]]; then
  echo "OpenClaw config not found at ${CONFIG_PATH}" >&2
  exit 1
fi

echo "Installing tool-guard plugin from ${PROJECT_ROOT}"
openclaw plugins install -l "${PROJECT_ROOT}"

PROJECT_ROOT="${PROJECT_ROOT}" RULES_ROOT="${RULES_ROOT}" CONFIG_PATH="${CONFIG_PATH}" node --input-type=module <<'EOF'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const projectRoot = process.env.PROJECT_ROOT;
const rulesRoot = process.env.RULES_ROOT;
const configPath = process.env.CONFIG_PATH;

const raw = fs.readFileSync(configPath, "utf8");
const config = JSON.parse(raw);

config.plugins ??= {};
config.plugins.allow = Array.isArray(config.plugins.allow) ? config.plugins.allow : [];
if (!config.plugins.allow.includes("tool-guard")) {
  config.plugins.allow.push("tool-guard");
}

config.plugins.load ??= {};
config.plugins.load.paths = Array.isArray(config.plugins.load.paths) ? config.plugins.load.paths : [];
if (!config.plugins.load.paths.includes(projectRoot)) {
  config.plugins.load.paths.push(projectRoot);
}

config.plugins.entries ??= {};
config.plugins.entries["tool-guard"] = {
  enabled: true,
  config: {
    blockedCommandRulesFile: path.join(rulesRoot, "dangerous-commands.json"),
    confirmCommandRulesFile: path.join(rulesRoot, "warning-commands.json"),
    sensitiveContentRulesFile: path.join(rulesRoot, "sensitive-content.json"),
    blockedCommandSubstrings: [
      "rm -rf",
      "del /f /s /q",
      "remove-item -recurse -force",
      "format ",
      "shutdown ",
      "invoke-webrequest ",
      "iex "
    ],
    blockedPathPrefixes: [
      path.join(os.homedir(), ".ssh"),
      path.join(os.homedir(), ".openclaw"),
      "/etc",
      "/usr",
      "/System",
      ".git"
    ],
    blockMessageWrites: true,
    blockMessageSending: true,
    redactToolResults: true,
    confirmTtlMs: 600000
  }
};

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
EOF

echo "Validating OpenClaw config"
openclaw config validate

echo "Restarting OpenClaw gateway"
mkdir -p "${HOME}/.openclaw/logs"
nohup openclaw gateway run --force > "${HOME}/.openclaw/logs/tool-guard-install.out.log" 2> "${HOME}/.openclaw/logs/tool-guard-install.err.log" &
sleep 6

echo "tool-guard installation complete."
echo "Rules directory: ${RULES_ROOT}"
echo "OpenClaw config: ${CONFIG_PATH}"
