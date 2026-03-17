# Tool Guard

`tool-guard` is an OpenClaw plugin for execution validation, confirmation gating,
protected-path blocking, and sensitive-content protection.

It is designed to be published as a standalone project and installed with a
single command on Windows, macOS, or Linux.

## What It Does

- Blocks dangerous shell commands before execution
- Blocks medium-risk commands and turns them into explicit confirmation actions
- Blocks reads and writes against protected paths
- Blocks commands that directly contain sensitive content
- Redacts sensitive tool output before it is persisted
- Blocks sensitive assistant messages from being written or sent outward

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
          "blockedPathPrefixes": [
            "/home/USERNAME/.ssh",
            "/home/USERNAME/.openclaw",
            "/etc",
            ".git"
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

## Configuration Reference

- `blockedCommandSubstrings`: simple case-insensitive fragments
- `blockedCommandPatterns`: regex rules merged with defaults and external file rules
- `confirmCommandPatterns`: regex rules that require confirmation
- `blockedCommandRulesFile`: external JSON for hard-block rules
- `confirmCommandRulesFile`: external JSON for confirmation rules
- `sensitiveContentPatterns`: regex rules for sensitive content
- `sensitiveContentRulesFile`: external JSON for sensitive-content rules
- `blockedPathPrefixes`: protected paths
- `protectedPathTools`: tools that should receive path checks
- `execTools`: tools treated as command-execution tools
- `pathParamNames`: parameter names that should be treated as paths
- `blockMessageWrites`: block sensitive content from being written to sessions
- `blockMessageSending`: block sensitive outbound content
- `redactToolResults`: redact sensitive tool output
- `confirmTtlMs`: confirmation token TTL in milliseconds

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
