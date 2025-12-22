#!/usr/bin/env node

// packages/core/command-analyzer.ts
import { basename, resolve as resolve2 } from "path";
import { homedir as homedir2 } from "os";

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
var DANGEROUS_PATTERNS = [
  { pattern: /\bfind\b.*\s-delete\b/, name: "find -delete" },
  { pattern: /\bfind\b.*-exec\s+(rm|mv|cp)\b/, name: "find -exec" },
  { pattern: /\bxargs\s+(-[^\s]+\s+)*(rm|mv|cp)\b/, name: "xargs" },
  { pattern: /\brsync\b.*--delete\b/, name: "rsync --delete" }
];
var REDIRECT_PATTERN = />{1,2}\s*(?:"([^"]+)"|'([^']+)'|([^\s;|&>]+))/g;
var DEVICE_PATHS = ["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr"];
var TEMP_PATHS = [
  "/tmp",
  "/var/tmp",
  "/private/tmp",
  "/private/var/tmp"
];
var SAFE_WRITE_PATHS = [...DEVICE_PATHS, ...TEMP_PATHS];
var DANGEROUS_GIT_PATTERNS = [
  { pattern: /\bgit\s+checkout\b.*\s--\s/, name: "git checkout --" },
  { pattern: /\bgit\s+restore\s+(?!--staged)/, name: "git restore" },
  { pattern: /\bgit\s+reset\s+.*--hard\b/, name: "git reset --hard" },
  { pattern: /\bgit\s+reset\s+.*--merge\b/, name: "git reset --merge" },
  {
    pattern: /\bgit\s+clean\s+.*(-[a-zA-Z]*f[a-zA-Z]*|--force)\b/,
    name: "git clean --force"
  },
  { pattern: /\bgit\s+push\s+.*(-f|--force)\b/, name: "git push --force" },
  { pattern: /\bgit\s+branch\s+.*-D\b/, name: "git branch -D" },
  { pattern: /\bgit\s+stash\s+drop\b/, name: "git stash drop" },
  { pattern: /\bgit\s+stash\s+clear\b/, name: "git stash clear" }
];

// packages/core/path-validator.ts
var PathValidator = class {
  constructor(workingDirectory) {
    this.workingDirectory = workingDirectory;
  }
  expand(path) {
    return path.replace(/^~(?=\/|$)/, homedir()).replace(/\$\{?(\w+)\}?/g, (_, name) => {
      if (name === "HOME") return homedir();
      if (name === "PWD") return this.workingDirectory;
      return process.env[name] || "";
    });
  }
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
  resolvePath(path, resolveBase) {
    const expanded = this.pathValidator.expand(path);
    return resolveBase ? resolve2(resolveBase, expanded) : expanded;
  }
  isPathAllowed(path, allowDevicePaths, resolveBase) {
    const resolved = this.resolvePath(path, resolveBase);
    if (this.pathValidator.isWithinWorkingDir(resolved)) return true;
    return allowDevicePaths ? this.pathValidator.isSafeForWrite(resolved) : this.pathValidator.isTempPath(resolved);
  }
  extractPaths(command) {
    const paths = [];
    const quoted = command.match(/["']([^"']+)["']/g) || [];
    quoted.forEach((q) => paths.push(q.slice(1, -1)));
    const tokens = command.replace(/["'][^"']*["']/g, "").split(/\s+/).filter((t) => !t.startsWith("-"));
    for (let i = 1; i < tokens.length; i++) {
      const value = tokens[i].includes("=") ? tokens[i].split("=").slice(1).join("=") : tokens[i];
      if (value) paths.push(value);
    }
    return paths;
  }
  getBaseCommand(command) {
    const tokens = command.trim().split(/\s+/);
    if (tokens.length === 0) return "";
    const first = tokens[0];
    let i = 0;
    if (first === "sudo" || first === "command") {
      i++;
      while (i < tokens.length) {
        const token = tokens[i];
        if (token === "--") {
          i++;
          break;
        }
        if (token.startsWith("-")) {
          i++;
          continue;
        }
        break;
      }
      return basename(tokens[i] || "");
    }
    if (first === "env") {
      const optsWithArgs = /* @__PURE__ */ new Set([
        "-u",
        "-C",
        "-S",
        "--unset",
        "--chdir",
        "--split-string"
      ]);
      i++;
      while (i < tokens.length) {
        const token = tokens[i];
        if (token === "--") {
          i++;
          break;
        }
        if (optsWithArgs.has(token)) {
          i += 2;
          continue;
        }
        if (token.startsWith("-") || token.includes("=")) {
          i++;
          continue;
        }
        break;
      }
      return basename(tokens[i] || "");
    }
    return basename(tokens[0] || "");
  }
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
      const path = match[1] || match[2] || match[3];
      if (!path || path.startsWith("&")) {
        continue;
      }
      if (!this.pathValidator.isSafeForWrite(path) && !this.pathValidator.isWithinWorkingDir(path)) {
        return {
          blocked: true,
          reason: `Redirect to path outside working directory: ${path}`
        };
      }
    }
    return { blocked: false };
  }
  isCdCommand(command) {
    return this.getBaseCommand(command) === "cd";
  }
  extractCdTarget(command) {
    const trimmed = command.trim();
    const quotedMatch = trimmed.match(/^cd\s+["']([^"']+)["']/);
    if (quotedMatch) return quotedMatch[1];
    const tokens = trimmed.split(/\s+/);
    if (tokens[0] !== "cd") return null;
    if (tokens.length === 1) return homedir2();
    let i = 1;
    while (i < tokens.length && tokens[i].startsWith("-")) {
      i++;
    }
    return tokens[i] || null;
  }
  checkDangerousGitCommands(command) {
    for (const { pattern, name } of DANGEROUS_GIT_PATTERNS) {
      if (pattern.test(command)) {
        return {
          blocked: true,
          reason: `Dangerous git command blocked: ${name}`
        };
      }
    }
    return { blocked: false };
  }
  checkDangerousPatterns(command) {
    for (const { pattern, name } of DANGEROUS_PATTERNS) {
      if (!pattern.test(command)) continue;
      const paths = this.extractPaths(command);
      for (const path of paths) {
        if (!this.pathValidator.isWithinWorkingDir(path) && !this.pathValidator.isTempPath(path)) {
          return {
            blocked: true,
            reason: `Command "${name}" targets path outside working directory: ${path}`
          };
        }
      }
    }
    return { blocked: false };
  }
  checkDangerousCommand(command, resolveBase) {
    const baseCmd = this.getBaseCommand(command);
    if (!DANGEROUS_COMMANDS.has(baseCmd)) {
      return { blocked: false };
    }
    const paths = this.extractPaths(command);
    if (baseCmd === "cp" && paths.length > 0) {
      const dest = paths[paths.length - 1];
      if (!this.isPathAllowed(dest, true, resolveBase)) {
        return {
          blocked: true,
          reason: `Command "${baseCmd}" targets path outside working directory: ${this.resolvePath(
            dest,
            resolveBase
          )}`
        };
      }
      return { blocked: false };
    }
    if (baseCmd === "dd") {
      const ofMatch = command.match(/\bof=["']?([^"'\s]+)["']?/);
      if (ofMatch && !this.isPathAllowed(ofMatch[1], true, resolveBase)) {
        return {
          blocked: true,
          reason: `Command "dd" targets path outside working directory: ${this.resolvePath(
            ofMatch[1],
            resolveBase
          )}`
        };
      }
      return { blocked: false };
    }
    const allowDevicePaths = baseCmd === "truncate";
    for (const path of paths) {
      if (!this.isPathAllowed(path, allowDevicePaths, resolveBase)) {
        return {
          blocked: true,
          reason: `Command "${baseCmd}" targets path outside working directory: ${this.resolvePath(
            path,
            resolveBase
          )}`
        };
      }
    }
    return { blocked: false };
  }
  analyze(command) {
    const gitResult = this.checkDangerousGitCommands(command);
    if (gitResult.blocked) return gitResult;
    const redirectResult = this.checkRedirects(command);
    if (redirectResult.blocked) return redirectResult;
    const patternResult = this.checkDangerousPatterns(command);
    if (patternResult.blocked) return patternResult;
    const commands = this.splitCommands(command);
    let currentWorkDir = this.workingDirectory;
    for (const cmd of commands) {
      const trimmed = cmd.trim();
      if (!trimmed) continue;
      if (this.isCdCommand(trimmed)) {
        const target = this.extractCdTarget(trimmed);
        if (target) {
          const expanded = this.pathValidator.expand(target);
          currentWorkDir = resolve2(currentWorkDir, expanded);
        }
        continue;
      }
      const resolveBase = currentWorkDir !== this.workingDirectory ? currentWorkDir : void 0;
      const result = this.checkDangerousCommand(trimmed, resolveBase);
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

// packages/claude-code/leash.ts
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
  const { tool_name, tool_input, cwd } = input;
  const analyzer = new CommandAnalyzer(cwd);
  if (tool_name === "Bash") {
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
