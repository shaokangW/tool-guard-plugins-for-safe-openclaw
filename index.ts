import { exec as execCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

type ToolGuardConfig = {
  enabledTools?: string[];
  blockedCommandSubstrings?: string[];
  blockedPathPrefixes?: string[];
  protectedPathTools?: string[];
  execTools?: string[];
  pathParamNames?: string[];
  logAllowedCalls?: boolean;
  blockedCommandPatterns?: string[];
  confirmCommandPatterns?: string[];
  sensitiveContentPatterns?: string[];
  blockMessageWrites?: boolean;
  blockMessageSending?: boolean;
  redactToolResults?: boolean;
  confirmTtlMs?: number;
  blockedCommandRulesFile?: string;
  confirmCommandRulesFile?: string;
  sensitiveContentRulesFile?: string;
  allowSelfModification?: boolean;
};

type HookToolEvent = { toolName: string; params: Record<string, unknown> };
type HookToolContext = { runId?: string; toolCallId?: string; sessionId?: string; sessionKey?: string };
type MessageContentPart = { type?: string; text?: string };
type AgentMessage = {
  role?: string;
  content?: Array<MessageContentPart | Record<string, unknown>>;
  [key: string]: unknown;
};
type PendingConfirmation = {
  token: string;
  createdAt: number;
  expiresAt: number;
  toolName: string;
  params: Record<string, unknown>;
  sessionId?: string;
  sessionKey?: string;
  runId?: string;
  reason: string;
};
type PendingConfirmationState = {
  pending: PendingConfirmation[];
};

const DEFAULT_EXEC_TOOLS = ["exec", "process"];
const DEFAULT_PROTECTED_PATH_TOOLS = ["write", "edit", "apply_patch", "read"];
const DEFAULT_MUTATING_PATH_TOOLS = ["write", "edit", "apply_patch"];
const DEFAULT_PATH_PARAM_NAMES = [
  "path",
  "paths",
  "file",
  "filePath",
  "filepath",
  "file_path",
  "target",
  "destination",
  "outputPath",
  "output_path",
  "inputPath",
  "input_path",
  "cwd",
  "workdir"
];
const DEFAULT_BLOCKED_COMMAND_SUBSTRINGS = [
  "rm -rf",
  "del /f /s /q",
  "remove-item -recurse -force",
  "remove-item -force -recurse",
  "format ",
  "shutdown ",
  "reboot ",
  "mkfs",
  "diskpart",
  "bcdedit",
  "reg delete ",
  "curl http://",
  "curl https://",
  "wget http://",
  "wget https://",
  "invoke-webrequest ",
  "irm ",
  "iex ",
  "invoke-expression"
];
const DEFAULT_BLOCKED_COMMAND_PATTERNS = [
  "rm.*-rf.*/$",
  "rm.*-rf.*/boot",
  "rm.*-rf.*/sys",
  "rm.*-rf.*/proc",
  "rm.*-rf.*/dev",
  "mkfs",
  "dd.*if=",
  "shred",
  "chmod.*-R.*777.*/etc",
  "chmod.*u\\+s",
  "remove-item.*-recurse.*-force",
  "remove-item.*-force.*-recurse",
  "remove-item.*-recurse.*(c:\\\\windows|c:\\\\users\\\\[^\\\\]+\\\\desktop|/etc|/usr|/system)",
  "curl.*\\|.*bash",
  "wget.*\\|.*\\bsh\\b",
  "nc.*-e",
  "bash.*-i",
  "sudo.*su",
  ">.*/etc/passwd",
  ">.*/etc/shadow",
  "reboot",
  "shutdown"
];
const DEFAULT_CONFIRM_COMMAND_PATTERNS = [
  "rm.*-rf",
  "rm.*-r",
  "rmdir",
  "chmod.*777",
  "chown.*-R",
  "chmod.*-x",
  "chmod.*-w",
  "rm.*/var/log",
  "rm.*/usr/local",
  "rm.*/tmp",
  "rm.*~",
  "remove-item",
  "remove-item.*-recurse",
  "remove-item.*-force",
  "del\\s+",
  "erase\\s+",
  "rd\\s+",
  "rmdir\\s+/s",
  "kill.*-9",
  "killall",
  "pkill",
  "curl.*-o.*/tmp",
  "wget.*-O.*/tmp",
  "cat.*/etc/passwd",
  "cat.*/etc/shadow",
  "vi.*/etc/passwd",
  "vim.*/etc/passwd",
  "nano.*/etc/passwd",
  "sed.*-i.*/etc/",
  "tee.*/etc/",
  "userdel",
  "groupdel",
  "usermod",
  "groupmod"
];
const DEFAULT_SENSITIVE_CONTENT_PATTERNS = [
  "private_key:[a-fA-F0-9]{64}",
  "[1-9][0-9]{5}(18|19|20)[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[0-9]{3}[0-9Xx]",
  "(sk-|api-|key-)[a-zA-Z0-9]{20,}",
  "t-[a-zA-Z0-9]{10,}",
  "u-[a-zA-Z0-9]{10,}",
  "1[3-9][0-9]{9}",
  "[1-9][0-9]{15,18}",
  "https?://[^\\s]*webhook[^\\s]*"
];
const TOOL_RESULT_BLOCK_TEXT =
  "[tool-guard blocked sensitive tool output]\nThe original tool result was withheld by tool-guard.";
const MESSAGE_BLOCK_TEXT =
  "[tool-guard blocked sensitive message]\nThis response was replaced by tool-guard because it matched a sensitive-content rule.";
const DEFAULT_CONFIRM_TTL_MS = 10 * 60 * 1000;
const execAsync = promisify(execCallback);
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(PLUGIN_DIR, ".tool-guard-state.json");

type JsonCommandRules = {
  commands?: unknown;
};

type JsonSensitiveRules =
  | {
      patterns?: unknown;
      sensitivePatterns?: unknown;
      rules?: unknown;
    }
  | unknown[];

function toStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback.slice();
  }

  const items = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);

  return items.length > 0 ? items : fallback.slice();
}

function resolveConfigPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(PLUGIN_DIR, input);
}

function readJsonFile(filePath: string): unknown {
  try {
    const raw = fs.readFileSync(resolveConfigPath(filePath), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadCommandPatternsFromFile(filePath: string | undefined): string[] {
  if (!filePath) {
    return [];
  }

  const parsed = readJsonFile(filePath) as JsonCommandRules | null;
  if (!parsed || !Array.isArray(parsed.commands)) {
    return [];
  }

  return parsed.commands.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function loadSensitivePatternsFromFile(filePath: string | undefined): string[] {
  if (!filePath) {
    return [];
  }

  const parsed = readJsonFile(filePath) as JsonSensitiveRules | null;
  if (!parsed) {
    return [];
  }

  if (Array.isArray(parsed)) {
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }

  const candidates = [
    ...(Array.isArray(parsed.patterns) ? parsed.patterns : []),
    ...(Array.isArray(parsed.sensitivePatterns) ? parsed.sensitivePatterns : []),
    ...(Array.isArray(parsed.rules) ? parsed.rules : [])
  ];

  return candidates.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function compilePatterns(patterns: string[]): RegExp[] {
  const compiled: RegExp[] = [];
  for (const pattern of patterns) {
    try {
      compiled.push(new RegExp(pattern, "i"));
    } catch {
      continue;
    }
  }
  return compiled;
}

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value);
  const withTrailing = resolved.endsWith(path.sep) ? resolved : `${resolved}${path.sep}`;
  return process.platform === "win32" ? withTrailing.toLowerCase() : withTrailing;
}

function normalizePathValue(value: string): string | null {
  if (!value.trim()) {
    return null;
  }

  try {
    const resolved = path.resolve(value.trim());
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  } catch {
    return null;
  }
}

function looksLikePathKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return lowered.includes("path") || lowered.includes("file") || lowered.includes("dir");
}

function collectPathCandidates(
  params: Record<string, unknown>,
  pathParamNames: Set<string>
): Array<{ key: string; value: string }> {
  const matches: Array<{ key: string; value: string }> = [];

  for (const [key, rawValue] of Object.entries(params)) {
    if (!pathParamNames.has(key) && !looksLikePathKey(key)) {
      continue;
    }

    if (typeof rawValue === "string") {
      matches.push({ key, value: rawValue });
      continue;
    }

    if (Array.isArray(rawValue)) {
      for (const item of rawValue) {
        if (typeof item === "string") {
          matches.push({ key, value: item });
        }
      }
    }
  }

  return matches;
}

function findBlockedCommand(command: string, blockedSubstrings: string[]): string | null {
  const lowered = command.toLowerCase();
  for (const fragment of blockedSubstrings) {
    const needle = fragment.toLowerCase();
    if (needle && lowered.includes(needle)) {
      return fragment;
    }
  }
  return null;
}

function findMatchedPattern(command: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    if (pattern.test(command)) {
      return pattern.source;
    }
  }
  return null;
}

function findBlockedPath(
  candidates: Array<{ key: string; value: string }>,
  blockedPrefixes: string[]
): { key: string; value: string; prefix: string } | null {
  const normalizedPrefixes = blockedPrefixes.map((prefix) => ({
    raw: prefix,
    value: normalizeForCompare(prefix)
  }));

  for (const candidate of candidates) {
    const normalized = normalizePathValue(candidate.value);
    if (!normalized) {
      continue;
    }

    const normalizedWithTrailing = normalized.endsWith(path.sep) ? normalized : `${normalized}${path.sep}`;
    for (const prefix of normalizedPrefixes) {
      if (
        normalized === prefix.value.slice(0, -1) ||
        normalizedWithTrailing.startsWith(prefix.value)
      ) {
        return { key: candidate.key, value: candidate.value, prefix: prefix.raw };
      }
    }
  }

  return null;
}

function collectMessageTexts(message: AgentMessage | undefined): string[] {
  if (!message || !Array.isArray(message.content)) {
    return [];
  }

  const texts: string[] = [];
  for (const item of message.content) {
    if (item && typeof item === "object" && typeof (item as MessageContentPart).text === "string") {
      texts.push((item as MessageContentPart).text ?? "");
    }
  }
  return texts;
}

function hasSensitiveText(texts: string[], patterns: RegExp[]): string | null {
  for (const text of texts) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return pattern.source;
      }
    }
  }
  return null;
}

function replaceMessageText(message: AgentMessage, replacement: string): AgentMessage {
  const nextContent = Array.isArray(message.content)
    ? message.content.map((item) => {
        if (item && typeof item === "object" && "text" in item) {
          return { ...(item as Record<string, unknown>), text: replacement };
        }
        return item;
      })
    : [{ type: "text", text: replacement }];

  return {
    ...message,
    content: nextContent
  };
}

function requiresCriticalDirConfirm(command: string): boolean {
  const lowered = command.toLowerCase();
  const criticalDirs = ["/etc", "/root", "/boot", "/sys", "/proc", "/dev"];
  const riskyOps = ["rm", "mkfs", "dd", "chmod", "chown", "tee", "touch", "mkdir"];
  return criticalDirs.some((dir) => lowered.includes(dir)) && riskyOps.some((op) => lowered.includes(op));
}

function readPendingState(): PendingConfirmationState {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return { pending: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as PendingConfirmationState;
    const now = Date.now();
    return {
      pending: Array.isArray(parsed.pending)
        ? parsed.pending.filter((entry) => typeof entry?.token === "string" && (entry.expiresAt ?? 0) > now)
        : []
    };
  } catch {
    return { pending: [] };
  }
}

function writePendingState(state: PendingConfirmationState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function savePendingConfirmation(entry: PendingConfirmation): void {
  const state = readPendingState();
  state.pending = state.pending.filter((item) => item.token !== entry.token);
  state.pending.push(entry);
  writePendingState(state);
}

function takePendingConfirmation(token: string): PendingConfirmation | null {
  const state = readPendingState();
  const index = state.pending.findIndex((entry) => entry.token === token);
  if (index === -1) {
    return null;
  }
  const [entry] = state.pending.splice(index, 1);
  writePendingState(state);
  return entry ?? null;
}

function dropPendingConfirmation(token: string): PendingConfirmation | null {
  return takePendingConfirmation(token);
}

function formatConfirmationPrompt(token: string, reason: string, command: string): string {
  return (
    `Blocked by tool-guard: ${reason}\n\n` +
    `Pending command:\n${command}\n\n` +
    `If you want to run it anyway, send:\n` +
    `/toolguard-confirm ${token}\n\n` +
    `To cancel it, send:\n` +
    `/toolguard-deny ${token}`
  );
}

async function executeApprovedCommand(entry: PendingConfirmation): Promise<string> {
  if (entry.toolName === "exec" || entry.toolName === "process") {
    const command = typeof entry.params.command === "string" ? entry.params.command : "";
    if (!command) {
      return "Pending command is missing its shell command text.";
    }

    const cwdCandidate =
      typeof entry.params.cwd === "string"
        ? entry.params.cwd
        : typeof entry.params.workdir === "string"
          ? entry.params.workdir
          : undefined;
    const timeoutCandidate =
      typeof entry.params.timeout_ms === "number"
        ? entry.params.timeout_ms
        : typeof entry.params.timeoutMs === "number"
          ? entry.params.timeoutMs
          : typeof entry.params.timeout === "number"
            ? entry.params.timeout
            : undefined;

    const { stdout, stderr } = await execAsync(command, {
      cwd: cwdCandidate,
      timeout: timeoutCandidate,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });

    const output = [stdout, stderr].filter((part) => typeof part === "string" && part.length > 0).join("").trim();
    return output || "(no output)";
  }

  const pathCandidate =
    typeof entry.params.path === "string"
      ? entry.params.path
      : typeof entry.params.filePath === "string"
        ? entry.params.filePath
        : typeof entry.params.file_path === "string"
          ? entry.params.file_path
          : typeof entry.params.file === "string"
            ? entry.params.file
            : "";

  if (!pathCandidate) {
    return "Pending action is missing a target path.";
  }

  if (entry.toolName === "write") {
    const content =
      typeof entry.params.content === "string"
        ? entry.params.content
        : typeof entry.params.newText === "string"
          ? entry.params.newText
          : typeof entry.params.new_string === "string"
            ? entry.params.new_string
            : "";
    fs.writeFileSync(pathCandidate, content, "utf8");
    return `Wrote ${content.length} bytes to ${pathCandidate}`;
  }

  if (entry.toolName === "edit") {
    const oldText =
      typeof entry.params.oldText === "string"
        ? entry.params.oldText
        : typeof entry.params.old_string === "string"
          ? entry.params.old_string
          : "";
    const newText =
      typeof entry.params.newText === "string"
        ? entry.params.newText
        : typeof entry.params.new_string === "string"
          ? entry.params.new_string
          : "";
    const content = fs.readFileSync(pathCandidate, "utf8");
    if (!oldText || !content.includes(oldText)) {
      throw new Error(`Old text not found in ${pathCandidate}`);
    }
    fs.writeFileSync(pathCandidate, content.replace(oldText, newText), "utf8");
    return `Edited ${pathCandidate}`;
  }

  return `Confirmation acknowledged, but replay for tool "${entry.toolName}" is not implemented.`;
}

export default function register(api: {
  pluginConfig?: Record<string, unknown>;
  logger: {
    info: (message: string, extra?: Record<string, unknown>) => void;
    warn: (message: string, extra?: Record<string, unknown>) => void;
  };
  registerCommand: (command: {
    name: string;
    description: string;
    acceptsArgs?: boolean;
    requireAuth?: boolean;
    handler: (ctx: { args?: string; channel: string; senderId?: string }) => Promise<{ text: string }> | { text: string };
  }) => void;
  on: {
    (hookName: "before_tool_call", handler: (event: HookToolEvent, ctx: HookToolContext) => { block?: boolean; blockReason?: string } | void, opts?: { priority?: number }): void;
    (hookName: "tool_result_persist", handler: (event: { toolName?: string; toolCallId?: string; message: AgentMessage }, ctx: { toolName?: string; toolCallId?: string }) => { message?: AgentMessage } | void, opts?: { priority?: number }): void;
    (hookName: "before_message_write", handler: (event: { message: AgentMessage }, ctx: { agentId?: string; sessionKey?: string }) => { block?: boolean; message?: AgentMessage } | void, opts?: { priority?: number }): void;
    (hookName: "message_sending", handler: (event: { to: string; content: string }, ctx: { channelId: string; accountId?: string; conversationId?: string }) => { cancel?: boolean; content?: string } | void, opts?: { priority?: number }): void;
  };
}) {
  const pluginConfig = (api.pluginConfig ?? {}) as ToolGuardConfig;
  const execTools = new Set(toStringList(pluginConfig.execTools, DEFAULT_EXEC_TOOLS));
  const protectedPathTools = new Set(
    toStringList(pluginConfig.protectedPathTools, DEFAULT_PROTECTED_PATH_TOOLS)
  );
  const mutatingPathTools = new Set(DEFAULT_MUTATING_PATH_TOOLS);
  const enabledTools = new Set(toStringList(pluginConfig.enabledTools, []));
  const blockedCommandSubstrings = toStringList(
    pluginConfig.blockedCommandSubstrings,
    DEFAULT_BLOCKED_COMMAND_SUBSTRINGS
  );
  const blockedCommandPatterns = compilePatterns(
    [
      ...DEFAULT_BLOCKED_COMMAND_PATTERNS,
      ...loadCommandPatternsFromFile(pluginConfig.blockedCommandRulesFile),
      ...toStringList(pluginConfig.blockedCommandPatterns, [])
    ]
  );
  const confirmCommandPatterns = compilePatterns(
    [
      ...DEFAULT_CONFIRM_COMMAND_PATTERNS,
      ...loadCommandPatternsFromFile(pluginConfig.confirmCommandRulesFile),
      ...toStringList(pluginConfig.confirmCommandPatterns, [])
    ]
  );
  const sensitiveContentPatterns = compilePatterns(
    [
      ...DEFAULT_SENSITIVE_CONTENT_PATTERNS,
      ...loadSensitivePatternsFromFile(pluginConfig.sensitiveContentRulesFile),
      ...toStringList(pluginConfig.sensitiveContentPatterns, [])
    ]
  );
  const blockedPathPrefixes = toStringList(pluginConfig.blockedPathPrefixes, []);
  const pathParamNames = new Set(
    toStringList(pluginConfig.pathParamNames, DEFAULT_PATH_PARAM_NAMES)
  );
  const shouldLogAllowedCalls = pluginConfig.logAllowedCalls === true;
  const blockMessageWrites = pluginConfig.blockMessageWrites !== false;
  const blockMessageSending = pluginConfig.blockMessageSending !== false;
  const redactToolResults = pluginConfig.redactToolResults !== false;
  const confirmTtlMs =
    typeof pluginConfig.confirmTtlMs === "number" && pluginConfig.confirmTtlMs > 0
      ? pluginConfig.confirmTtlMs
      : DEFAULT_CONFIRM_TTL_MS;
  const allowSelfModification = pluginConfig.allowSelfModification === true;
  const selfProtectedPrefixes = [PLUGIN_DIR];

  api.registerCommand({
    name: "toolguard-confirm",
    description: "Confirm and execute a pending tool-guard command by token.",
    acceptsArgs: true,
    handler: async (ctx) => {
      const token = ctx.args?.trim() ?? "";
      if (!token) {
        return { text: "Usage: /toolguard-confirm <token>" };
      }

      const entry = takePendingConfirmation(token);
      if (!entry) {
        return { text: "Pending confirmation not found or already expired." };
      }

      try {
        const output = await executeApprovedCommand(entry);
        return {
          text:
            `Confirmed and executed pending command:\n${String(entry.params.command ?? "")}\n\n` +
            `Output:\n${output}`
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          text:
            `Confirmed command failed:\n${String(entry.params.command ?? "")}\n\n` +
            `Error:\n${message}`
        };
      }
    }
  });

  api.registerCommand({
    name: "toolguard-deny",
    description: "Discard a pending tool-guard command by token.",
    acceptsArgs: true,
    handler: (ctx) => {
      const token = ctx.args?.trim() ?? "";
      if (!token) {
        return { text: "Usage: /toolguard-deny <token>" };
      }

      const entry = dropPendingConfirmation(token);
      if (!entry) {
        return { text: "Pending confirmation not found or already expired." };
      }

      return {
        text: `Cancelled pending command:\n${String(entry.params.command ?? "")}`
      };
    }
  });

  api.on(
    "before_tool_call",
    (event, ctx) => {
      const { toolName, params } = event;

      if (enabledTools.size > 0 && !enabledTools.has(toolName)) {
        return;
      }

      if (execTools.has(toolName)) {
        const command = typeof params.command === "string" ? params.command : "";
        const sensitiveCommandMatch = hasSensitiveText([command], sensitiveContentPatterns);
        if (sensitiveCommandMatch) {
          api.logger.warn("Blocked exec tool call containing sensitive content", {
            toolName,
            sensitiveCommandMatch,
            runId: ctx.runId,
            toolCallId: ctx.toolCallId
          });
          return {
            block: true,
            blockReason: `Blocked by tool-guard: command content matched sensitive rule "${sensitiveCommandMatch}".`
          };
        }

        const blockedFragment = findBlockedCommand(command, blockedCommandSubstrings);
        const blockedPattern = findMatchedPattern(command, blockedCommandPatterns);
        if (blockedFragment || blockedPattern) {
          api.logger.warn("Blocked dangerous exec tool call", {
            toolName,
            blockedFragment,
            blockedPattern,
            runId: ctx.runId,
            toolCallId: ctx.toolCallId
          });
          return {
            block: true,
            blockReason: `Blocked by tool-guard: command matched dangerous rule "${blockedFragment ?? blockedPattern}".`
          };
        }

        const confirmPattern = findMatchedPattern(command, confirmCommandPatterns);
        if (confirmPattern || requiresCriticalDirConfirm(command)) {
          const token = randomUUID().replace(/-/g, "").slice(0, 12);
          const reason = `command requires explicit user confirmation before execution. Matched rule "${confirmPattern ?? "critical-dir-check"}".`;
          savePendingConfirmation({
            token,
            createdAt: Date.now(),
            expiresAt: Date.now() + confirmTtlMs,
            toolName,
            params,
            sessionId: ctx.sessionId,
            sessionKey: ctx.sessionKey,
            runId: ctx.runId,
            reason
          });
          api.logger.warn("Confirmation-required exec tool call blocked", {
            toolName,
            confirmPattern,
            token,
            runId: ctx.runId,
            toolCallId: ctx.toolCallId
          });
          return {
            block: true,
            blockReason: formatConfirmationPrompt(token, reason, command)
          };
        }
      }

      if (protectedPathTools.has(toolName)) {
        const pathCandidates = collectPathCandidates(params, pathParamNames);
        const selfProtectedPath = !allowSelfModification && mutatingPathTools.has(toolName)
          ? findBlockedPath(pathCandidates, selfProtectedPrefixes)
          : null;
        if (selfProtectedPath) {
          const token = randomUUID().replace(/-/g, "").slice(0, 12);
          const targetPath = normalizePathValue(selfProtectedPath.value) ?? selfProtectedPath.value;
          const reason = `modifying tool-guard files requires explicit user confirmation. Target "${targetPath}".`;
          savePendingConfirmation({
            token,
            createdAt: Date.now(),
            expiresAt: Date.now() + confirmTtlMs,
            toolName,
            params,
            sessionId: ctx.sessionId,
            sessionKey: ctx.sessionKey,
            runId: ctx.runId,
            reason
          });
          api.logger.warn("Blocked self-protected plugin modification", {
            toolName,
            param: selfProtectedPath.key,
            value: selfProtectedPath.value,
            token,
            runId: ctx.runId,
            toolCallId: ctx.toolCallId
          });
          return {
            block: true,
            blockReason: formatConfirmationPrompt(token, reason, selfProtectedPath.value)
          };
        }

        const blockedPath = findBlockedPath(pathCandidates, blockedPathPrefixes);
        if (blockedPath) {
          api.logger.warn("Blocked protected path access", {
            toolName,
            param: blockedPath.key,
            value: blockedPath.value,
            prefix: blockedPath.prefix,
            runId: ctx.runId,
            toolCallId: ctx.toolCallId
          });
          return {
            block: true,
            blockReason: `Blocked by tool-guard: parameter "${blockedPath.key}" targets protected path "${blockedPath.prefix}".`
          };
        }
      }

      if (shouldLogAllowedCalls) {
        api.logger.info("Allowed tool call", {
          toolName,
          runId: ctx.runId,
          toolCallId: ctx.toolCallId
        });
      }
    },
    { priority: 100 }
  );

  api.on(
    "tool_result_persist",
    (event) => {
      if (!redactToolResults) {
        return;
      }

      const texts = collectMessageTexts(event.message);
      const matched = hasSensitiveText(texts, sensitiveContentPatterns);
      if (!matched) {
        return;
      }

      api.logger.warn("Redacted sensitive tool result", {
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        matched
      });

      return {
        message: replaceMessageText(event.message, TOOL_RESULT_BLOCK_TEXT)
      };
    },
    { priority: 100 }
  );

  api.on(
    "before_message_write",
    (event) => {
      if (!blockMessageWrites) {
        return;
      }

      const texts = collectMessageTexts(event.message);
      const matched = hasSensitiveText(texts, sensitiveContentPatterns);
      if (!matched) {
        return;
      }

      api.logger.warn("Blocked sensitive message write", {
        role: event.message.role,
        matched
      });

      return {
        message: replaceMessageText(event.message, MESSAGE_BLOCK_TEXT)
      };
    },
    { priority: 100 }
  );

  api.on(
    "message_sending",
    (event, ctx) => {
      if (!blockMessageSending) {
        return;
      }

      const matched = hasSensitiveText([event.content], sensitiveContentPatterns);
      if (!matched) {
        return;
      }

      api.logger.warn("Blocked sensitive outbound message", {
        to: event.to,
        channelId: ctx.channelId,
        matched
      });

      return {
        content: MESSAGE_BLOCK_TEXT
      };
    },
    { priority: 100 }
  );
}
