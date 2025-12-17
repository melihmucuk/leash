#!/usr/bin/env node

// packages/core/command-analyzer.ts
import { basename } from "path";

// packages/core/path-validator.ts
import { resolve, relative } from "path";
import { homedir } from "os";
import { realpathSync } from "fs";

// packages/core/constants.ts
var DANGEROUS_COMMANDS = /* @__PURE__ */ new Set([
  "rm",
  "rmdir",
  "unlink",
  "shred",
  "mv",
  "cp",
  "chmod",
  "chown",
  "chgrp",
  "truncate",
  "dd",
  "ln"
]);
var REDIRECT_PATTERN = />\s*([~\/][^\s;|&>]*)/g;
var DEVICE_PATHS = ["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr"];
var TEMP_PATHS = [
  "/tmp",
  "/var/tmp",
  "/private/tmp",
  "/private/var/tmp"
];
var SAFE_WRITE_PATHS = [...DEVICE_PATHS, ...TEMP_PATHS];

// packages/core/path-validator.ts
var PathValidator = class {
  constructor(workingDirectory) {
    this.workingDirectory = workingDirectory;
  }
  /** Expand ~ and environment variables in path */
  expand(path) {
    return path.replace(/^~(?=\/|$)/, homedir()).replace(/\$\{?(\w+)\}?/g, (_, name) => {
      if (name === "HOME") return homedir();
      if (name === "PWD") return this.workingDirectory;
      return process.env[name] || "";
    });
  }
  /** Resolve path following all symlinks (including parent directories) */
  resolveReal(path) {
    const expanded = this.expand(path);
    const resolved = resolve(this.workingDirectory, expanded);
    try {
      return realpathSync(resolved);
    } catch {
      return resolved;
    }
  }
  isWithinWorkingDir(path) {
    try {
      const realPath = this.resolveReal(path);
      const realWorkDir = realpathSync(this.workingDirectory);
      if (realPath === realWorkDir) {
        return true;
      }
      const rel = relative(realWorkDir, realPath);
      return !!rel && !rel.startsWith("..") && !rel.startsWith("/");
    } catch {
      return false;
    }
  }
  matchesAny(resolved, paths) {
    return paths.some((p) => resolved === p || resolved.startsWith(p + "/"));
  }
  isSafeForWrite(path) {
    const resolved = this.resolveReal(path);
    return this.matchesAny(resolved, SAFE_WRITE_PATHS);
  }
  isTempPath(path) {
    const resolved = this.resolveReal(path);
    return this.matchesAny(resolved, TEMP_PATHS);
  }
};

// packages/core/command-analyzer.ts
var CommandAnalyzer = class {
  constructor(workingDirectory) {
    this.workingDirectory = workingDirectory;
    this.pathValidator = new PathValidator(workingDirectory);
  }
  pathValidator;
  /** Extract potential paths from command string */
  extractPaths(command) {
    const paths = [];
    const quoted = command.match(/["']([^"']+)["']/g) || [];
    quoted.forEach((q) => paths.push(q.slice(1, -1)));
    const tokens = command.replace(/["'][^"']*["']/g, "").split(/\s+/).filter((t) => !t.startsWith("-"));
    tokens.forEach((t) => {
      if (t.includes("/") || t.startsWith("~") || t.startsWith(".") || t.startsWith("$")) {
        paths.push(t);
      }
    });
    return paths;
  }
  /** Get the base command name */
  getBaseCommand(command) {
    const firstWord = command.trim().split(/\s+/)[0] || "";
    return basename(firstWord);
  }
  /** Split command by chain operators while respecting quotes */
  splitCommands(command) {
    const commands = [];
    let current = "";
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let i = 0;
    while (i < command.length) {
      const char = command[i];
      const nextChar = command[i + 1];
      if (char === "\\" && !inSingleQuote) {
        current += char + (nextChar || "");
        i += 2;
        continue;
      }
      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
        current += char;
        i++;
        continue;
      }
      if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
        current += char;
        i++;
        continue;
      }
      if (!inSingleQuote && !inDoubleQuote) {
        if (char === "&" && nextChar === "&" || char === "|" && nextChar === "|") {
          if (current.trim()) commands.push(current.trim());
          current = "";
          i += 2;
          continue;
        }
        if (char === ";" || char === "|" && nextChar !== "|") {
          if (current.trim()) commands.push(current.trim());
          current = "";
          i++;
          continue;
        }
      }
      current += char;
      i++;
    }
    if (current.trim()) commands.push(current.trim());
    return commands;
  }
  checkRedirects(command) {
    const matches = command.matchAll(REDIRECT_PATTERN);
    for (const match of matches) {
      const path = match[1];
      if (path && !this.pathValidator.isSafeForWrite(path) && !this.pathValidator.isWithinWorkingDir(path)) {
        return {
          blocked: true,
          reason: `Redirect to path outside working directory: ${path}`
        };
      }
    }
    return { blocked: false };
  }
  /** Check if path is allowed for the operation */
  isPathAllowed(path, allowDevicePaths) {
    if (this.pathValidator.isWithinWorkingDir(path)) return true;
    return allowDevicePaths ? this.pathValidator.isSafeForWrite(path) : this.pathValidator.isTempPath(path);
  }
  /** Check dangerous commands for external paths */
  checkDangerousCommand(command) {
    const baseCmd = this.getBaseCommand(command);
    if (!DANGEROUS_COMMANDS.has(baseCmd)) {
      return { blocked: false };
    }
    const paths = this.extractPaths(command);
    if (baseCmd === "cp" && paths.length > 0) {
      const dest = paths[paths.length - 1];
      if (!this.isPathAllowed(dest, true)) {
        return {
          blocked: true,
          reason: `Command "${baseCmd}" targets path outside working directory: ${dest}`
        };
      }
      return { blocked: false };
    }
    const isWriteCommand = baseCmd === "truncate" || baseCmd === "dd";
    for (const path of paths) {
      if (!this.isPathAllowed(path, isWriteCommand)) {
        return {
          blocked: true,
          reason: `Command "${baseCmd}" targets path outside working directory: ${path}`
        };
      }
    }
    return { blocked: false };
  }
  /** Analyze command for dangerous operations */
  analyze(command) {
    const redirectResult = this.checkRedirects(command);
    if (redirectResult.blocked) return redirectResult;
    const commands = this.splitCommands(command);
    for (const cmd of commands) {
      const trimmed = cmd.trim();
      if (!trimmed) continue;
      const result = this.checkDangerousCommand(trimmed);
      if (result.blocked) return result;
    }
    return { blocked: false };
  }
  validatePath(path) {
    if (!path) return { blocked: false };
    if (!this.pathValidator.isSafeForWrite(path) && !this.pathValidator.isWithinWorkingDir(path)) {
      return {
        blocked: true,
        reason: `File operation targets path outside working directory: ${path}`
      };
    }
    return { blocked: false };
  }
};

// packages/factory/leash.ts
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}
async function main() {
  let input;
  try {
    const raw = await readStdin();
    input = JSON.parse(raw);
  } catch {
    console.error("Failed to parse input JSON");
    process.exit(1);
  }
  const { tool_name, tool_input } = input;
  const cwd = process.env.FACTORY_PROJECT_DIR || input.cwd || process.cwd();
  const analyzer = new CommandAnalyzer(cwd);
  if (tool_name === "Execute") {
    const command = tool_input.command || "";
    const result = analyzer.analyze(command);
    if (result.blocked) {
      console.error(
        `\u{1F6AB} Command blocked: ${command}
Reason: ${result.reason}
Working directory: ${cwd}
Action: Guide the user to run the command manually.`
      );
      process.exit(2);
    }
  }
  if (tool_name === "Write" || tool_name === "Edit") {
    const path = tool_input.file_path || "";
    const result = analyzer.validatePath(path);
    if (result.blocked) {
      console.error(
        `\u{1F6AB} File operation blocked: ${path}
Reason: ${result.reason}
Working directory: ${cwd}
Action: Guide the user to perform this operation manually.`
      );
      process.exit(2);
    }
  }
  process.exit(0);
}
main();
