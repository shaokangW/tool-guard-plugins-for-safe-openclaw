<h1 align="center">Tool Guard for Safe OpenClaw</h1>

<p align="center">
  Mechanism-level security guardrails for OpenClaw tool execution and content handling.
</p>

<p align="center">
  <a href="https://github.com/shaokangW/tool-guard-plugins-for-safe-openclaw">Repository</a>
  ·
  <a href="./docs/PUBLISHING.md">Publishing</a>
  ·
  <a href="#one-click-install">Install</a>
  ·
  <a href="#configuration-reference">Config</a>
</p>

<p align="center">
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-222222?style=for-the-badge">
  <img alt="openclaw" src="https://img.shields.io/badge/OpenClaw-Plugin-e11d48?style=for-the-badge">
  <img alt="security" src="https://img.shields.io/badge/security-tool%20guardrails-0f766e?style=for-the-badge">
  <img alt="filtering" src="https://img.shields.io/badge/filtering-exec%20%26%20content-1d4ed8?style=for-the-badge">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-2563eb?style=for-the-badge">
</p>

<p align="center">
  <strong>Block dangerous tool calls. Gate risky actions. Filter sensitive content.</strong>
</p>

`tool-guard` is an OpenClaw plugin that adds a hard security layer to the OpenClaw execution pipeline. Instead of relying only on prompts or skills, it hooks into tool-call and message-processing stages to enforce configurable rules for execution filtering, confirmation gating, output redaction, and outbound content moderation.

It is designed to be published as a standalone project and installed with a single command on Windows, macOS, or Linux.

## Repository Intro

### 中文版

`tool-guard` 是一个面向 OpenClaw 的安全防护插件，重点不是依赖模型“自觉遵守规则”，而是从 OpenClaw 的机制层直接接入工具调用与消息处理链路，在执行前、结果落盘前、消息发送前提供可配置的安全控制。

它适合用来为 OpenClaw 增加一层稳定、可审计、可外部发布的安全能力，包括高风险工具调用拦截、需要确认的命令门控、敏感内容检测、工具输出脱敏，以及对回复内容的审查过滤。相比仅通过 prompt 或 skill 约束 agent 行为，`tool-guard` 更适合承担硬约束角色，尤其是在 subagent、多工具协作和自动化运行场景下，能够提供更一致的安全边界。

### English

`tool-guard` is a security plugin for OpenClaw that focuses on mechanism-level enforcement rather than prompt-only behavior shaping. It hooks directly into the OpenClaw tool and message pipeline to add configurable security controls before execution, before persistence, and before outbound delivery.

It is designed for teams that want a durable, auditable safety layer for OpenClaw deployments, including high-risk tool-call blocking, confirmation gates for sensitive actions, flexible execution filtering, sensitive-content detection, tool-result redaction, and response/content moderation. Compared with relying on prompts or skills alone, `tool-guard` is meant to serve as a hard guardrail layer, especially in subagent, multi-tool, and automated execution workflows.

## What It Does

- Blocks dangerous shell commands before execution
- Blocks medium-risk commands and turns them into explicit confirmation actions
- Blocks commands that directly contain sensitive content
- Redacts sensitive tool output before it is persisted
- Blocks sensitive assistant messages from being written or sent outward
- Protects the plugin's own files from silent modification

## Hooks Used

- `before_tool_call`
- `tool_result_persist`
- `before_message_write`
- `message_sending`

## Project Layout

```text
tool-guard/
  index.ts
  openclaw.plugin.json
  package.json
  LICENSE
  README.md
  examples/
    tool-guard.config.example.json
    rules/
      dangerous-commands.json
      warning-commands.json
      sensitive-content.json
  scripts/
    install.ps1
    install.sh
    uninstall.ps1
    uninstall.sh
```

## One-Click Install

From inside the project directory:

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

macOS / Linux:

```bash
chmod +x ./scripts/install.sh
./scripts/install.sh
```

What the installer does:

- installs the plugin via `openclaw plugins install -l`
- updates `~\.openclaw\openclaw.json`
- points the plugin config at the bundled rule JSON files
- enables the plugin
- validates OpenClaw config
- restarts the local gateway

## Uninstall

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
```

macOS / Linux:

```bash
chmod +x ./scripts/uninstall.sh
./scripts/uninstall.sh
```

## Manual Install

```bash
openclaw plugins install -l /path/to/tool-guard
openclaw plugins enable tool-guard
```

Then add config like this:

```json
{
  "plugins": {
    "allow": ["tool-guard"],
    "load": {
      "paths": ["/path/to/tool-guard"]
    },
    "entries": {
      "tool-guard": {
        "enabled": true,
        "config": {
          "blockedCommandRulesFile": "/path/to/tool-guard/examples/rules/dangerous-commands.json",
          "confirmCommandRulesFile": "/path/to/tool-guard/examples/rules/warning-commands.json",
          "sensitiveContentRulesFile": "/path/to/tool-guard/examples/rules/sensitive-content.json",
          "blockedCommandSubstrings": [
            "rm -rf",
            "del /f /s /q",
            "remove-item -recurse -force"
          ],
          "blockMessageWrites": true,
          "blockMessageSending": true,
          "redactToolResults": true,
          "confirmTtlMs": 600000
        }
      }
    }
  }
}
```

## External JSON Rules

The plugin can load rules from external JSON files.

Supported file shapes:

- `blockedCommandRulesFile`
  Reads `{ "commands": ["regex1", "regex2"] }`
- `confirmCommandRulesFile`
  Reads `{ "commands": ["regex1", "regex2"] }`
- `sensitiveContentRulesFile`
  Reads either:
  - `{ "patterns": ["regex1", "regex2"] }`
  - `["regex1", "regex2"]`

Bundled examples:

- [dangerous-commands.json](./examples/rules/dangerous-commands.json)
- [warning-commands.json](./examples/rules/warning-commands.json)
- [sensitive-content.json](./examples/rules/sensitive-content.json)

## Confirmation Flow

When a command matches a confirmation rule, `tool-guard` blocks execution and
returns a tokenized confirmation prompt.

Example:

```text
/toolguard-confirm <token>
/toolguard-deny <token>
```

Notes:

- These are plugin commands for OpenClaw chat/native command surfaces
- They are not exposed through `openclaw agent --message ...`
- Tokens expire after `confirmTtlMs`
- By default, edits to the `tool-guard` project itself also require confirmation

## Configuration Reference

- `blockedCommandSubstrings`: simple case-insensitive fragments
- `blockedCommandPatterns`: regex rules merged with defaults and external file rules
- `confirmCommandPatterns`: regex rules that require confirmation
- `blockedCommandRulesFile`: external JSON for hard-block rules
- `confirmCommandRulesFile`: external JSON for confirmation rules
- `sensitiveContentPatterns`: regex rules for sensitive content
- `sensitiveContentRulesFile`: external JSON for sensitive-content rules
- `blockedPathPrefixes`: optional extra protected paths beyond the built-in plugin self-protection
- `protectedPathTools`: tools that should receive path checks
- `execTools`: tools treated as command-execution tools
- `pathParamNames`: parameter names that should be treated as paths
- `blockMessageWrites`: block sensitive content from being written to sessions
- `blockMessageSending`: block sensitive outbound content
- `redactToolResults`: redact sensitive tool output
- `confirmTtlMs`: confirmation token TTL in milliseconds
- `allowSelfModification`: disable the built-in self-protection layer for plugin files

## Publish Notes

This project is ready to be published as a package or shared as a repo.

Detailed release notes:

- [PUBLISHING.md](./docs/PUBLISHING.md)

Recommended release flow:

1. Commit the project as its own repository
2. Tag releases by version from `package.json`
3. Publish the repo or package
4. Tell users to clone/download the project
5. Run the platform installer from `scripts/`

If you later want npm-based distribution, keep `index.ts`, `openclaw.plugin.json`,
and the `openclaw.extensions` field in `package.json`.

## Local Verification

Useful commands:

```bash
openclaw config validate
openclaw plugins list
openclaw agent --to +8613800000000 --message "Use the exec tool to run exactly this command and report the tool result: rm -rf /tmp/demo" --thinking off --timeout 120 --json
```

## Known Limits

- Plugin commands are intended for real chat/native command surfaces, not the
  `openclaw agent --message ...` local test path
- Confirmation resume currently executes the saved command directly from the
  plugin command handler rather than restoring the original model turn
- Regex rule systems can still produce false positives or false negatives
