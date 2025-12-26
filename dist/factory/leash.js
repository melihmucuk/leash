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
var PLATFORM_PATHS = [
  ".claude",
  ".factory",
  ".pi",
  ".config/opencode"
];
var TEMP_PATHS = [
  "/tmp",
  "/var/tmp",
  "/private/tmp",
  "/private/var/tmp"
];
var SAFE_WRITE_PATHS = [...DEVICE_PATHS, ...TEMP_PATHS];
var PROTECTED_PATTERNS = [
  { pattern: /^\.env($|\.(?!example$).+)/, name: ".env files" },
  { pattern: /^\.git(\/|$)/, name: ".git directory" }
];
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
  isPlatformPath(path) {
    const resolved = this.resolveReal(path);
    const home = homedir();
    const platformPaths = PLATFORM_PATHS.map((p) => `${home}/${p}`);
    return this.matchesAny(resolved, platformPaths);
  }
  isProtectedPath(path) {
    if (!this.isWithinWorkingDir(path)) {
      return { protected: false };
    }
    const realPath = this.resolveReal(path);
    const realWorkDir = realpathSync(this.workingDirectory);
    const relativePath = relative(realWorkDir, realPath);
    for (const { pattern, name } of PROTECTED_PATTERNS) {
      if (pattern.test(relativePath)) {
        return { protected: true, name };
      }
    }
    return { protected: false };
  }
};

// packages/core/command-analyzer.ts
var DELETE_COMMANDS = /* @__PURE__ */ new Set(["rm", "rmdir", "unlink", "shred"]);
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
    if (this.pathValidator.isPlatformPath(resolved)) return true;
    return allowDevicePaths ? this.pathValidator.isSafeForWrite(resolved) : this.pathValidator.isTempPath(resolved);
  }
  checkProtectedPath(path, context, resolveBase) {
    const resolved = this.resolvePath(path, resolveBase);
    const protection = this.pathValidator.isProtectedPath(resolved);
    if (protection.protected) {
      return {
        blocked: true,
        reason: `${context} targets protected path: ${protection.name}`
      };
    }
    return { blocked: false };
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
      if (!this.pathValidator.isSafeForWrite(path) && !this.pathValidator.isWithinWorkingDir(path) && !this.pathValidator.isPlatformPath(path)) {
        return {
          blocked: true,
          reason: `Redirect to path outside working directory: ${path}`
        };
      }
      const result = this.checkProtectedPath(path, "Redirect");
      if (result.blocked) return result;
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
  checkDangerousPatterns(command, resolveBase) {
    for (const { pattern, name } of DANGEROUS_PATTERNS) {
      if (!pattern.test(command)) continue;
      const paths = this.extractPaths(command);
      for (const path of paths) {
        const resolved = this.resolvePath(path, resolveBase);
        if (!this.pathValidator.isWithinWorkingDir(resolved) && !this.pathValidator.isTempPath(resolved) && !this.pathValidator.isPlatformPath(resolved)) {
          return {
            blocked: true,
            reason: `Command "${name}" targets path outside working directory: ${path}`
          };
        }
        const result = this.checkProtectedPath(path, `Command "${name}"`, resolveBase);
        if (result.blocked) return result;
      }
    }
    return { blocked: false };
  }
  checkCpCommand(paths, resolveBase) {
    if (paths.length === 0) return { blocked: false };
    const dest = paths[paths.length - 1];
    if (!this.isPathAllowed(dest, true, resolveBase)) {
      return {
        blocked: true,
        reason: `Command "cp" targets path outside working directory: ${this.resolvePath(dest, resolveBase)}`
      };
    }
    return this.checkProtectedPath(dest, 'Command "cp"', resolveBase);
  }
  checkDdCommand(command, resolveBase) {
    const ofMatch = command.match(/\bof=["']?([^"'\s]+)["']?/);
    if (!ofMatch) return { blocked: false };
    const dest = ofMatch[1];
    if (!this.isPathAllowed(dest, true, resolveBase)) {
      return {
        blocked: true,
        reason: `Command "dd" targets path outside working directory: ${this.resolvePath(dest, resolveBase)}`
      };
    }
    return this.checkProtectedPath(dest, 'Command "dd"', resolveBase);
  }
  checkMvCommand(paths, resolveBase) {
    if (paths.length === 0) return { blocked: false };
    const dest = paths[paths.length - 1];
    const sources = paths.slice(0, -1);
    if (!this.isPathAllowed(dest, true, resolveBase)) {
      return {
        blocked: true,
        reason: `Command "mv" targets path outside working directory: ${this.resolvePath(dest, resolveBase)}`
      };
    }
    const destResult = this.checkProtectedPath(
      dest,
      'Command "mv"',
      resolveBase
    );
    if (destResult.blocked) return destResult;
    for (const source of sources) {
      if (!this.isPathAllowed(source, false, resolveBase)) {
        return {
          blocked: true,
          reason: `Command "mv" targets path outside working directory: ${this.resolvePath(source, resolveBase)}`
        };
      }
      const sourceResult = this.checkProtectedPath(
        source,
        'Command "mv"',
        resolveBase
      );
      if (sourceResult.blocked) return sourceResult;
    }
    return { blocked: false };
  }
  checkDeleteCommand(baseCmd, paths, resolveBase) {
    for (const path of paths) {
      if (!this.isPathAllowed(path, false, resolveBase)) {
        return {
          blocked: true,
          reason: `Command "${baseCmd}" targets path outside working directory: ${this.resolvePath(path, resolveBase)}`
        };
      }
      const result = this.checkProtectedPath(
        path,
        `Command "${baseCmd}"`,
        resolveBase
      );
      if (result.blocked) return result;
    }
    return { blocked: false };
  }
  checkWriteCommand(baseCmd, paths, resolveBase) {
    const allowDevicePaths = baseCmd === "truncate";
    for (const path of paths) {
      if (!this.isPathAllowed(path, allowDevicePaths, resolveBase)) {
        return {
          blocked: true,
          reason: `Command "${baseCmd}" targets path outside working directory: ${this.resolvePath(path, resolveBase)}`
        };
      }
      const result = this.checkProtectedPath(
        path,
        `Command "${baseCmd}"`,
        resolveBase
      );
      if (result.blocked) return result;
    }
    return { blocked: false };
  }
  checkDangerousCommand(command, resolveBase) {
    const baseCmd = this.getBaseCommand(command);
    if (!DANGEROUS_COMMANDS.has(baseCmd)) {
      return { blocked: false };
    }
    const paths = this.extractPaths(command);
    if (baseCmd === "cp") return this.checkCpCommand(paths, resolveBase);
    if (baseCmd === "dd") return this.checkDdCommand(command, resolveBase);
    if (baseCmd === "mv") return this.checkMvCommand(paths, resolveBase);
    if (DELETE_COMMANDS.has(baseCmd))
      return this.checkDeleteCommand(baseCmd, paths, resolveBase);
    return this.checkWriteCommand(baseCmd, paths, resolveBase);
  }
  analyze(command) {
    const gitResult = this.checkDangerousGitCommands(command);
    if (gitResult.blocked) return gitResult;
    const redirectResult = this.checkRedirects(command);
    if (redirectResult.blocked) return redirectResult;
    const commands = this.splitCommands(command);
    const hasCd = commands.some((cmd) => this.isCdCommand(cmd.trim()));
    if (!hasCd) {
      const patternResult = this.checkDangerousPatterns(command);
      if (patternResult.blocked) return patternResult;
    }
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
      if (hasCd) {
        const patternResult = this.checkDangerousPatterns(trimmed, resolveBase);
        if (patternResult.blocked) return patternResult;
      }
      const result = this.checkDangerousCommand(trimmed, resolveBase);
      if (result.blocked) return result;
    }
    return { blocked: false };
  }
  validatePath(path) {
    if (!path) return { blocked: false };
    if (!this.pathValidator.isSafeForWrite(path) && !this.pathValidator.isWithinWorkingDir(path) && !this.pathValidator.isPlatformPath(path)) {
      return {
        blocked: true,
        reason: `File operation targets path outside working directory: ${path}`
      };
    }
    return this.checkProtectedPath(path, "File operation");
  }
};

// packages/core/version-checker.ts
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
function getVersion() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(__dirname, "..", "..", "package.json"),
    join(__dirname, "..", "..", "..", "package.json")
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const pkg = JSON.parse(readFileSync(path, "utf-8"));
        if (pkg.name === "@melihmucuk/leash") {
          return pkg.version;
        }
      } catch {
      }
    }
  }
  return "0.0.0";
}
var CURRENT_VERSION = getVersion();
var NPM_REGISTRY_URL = "https://registry.npmjs.org/@melihmucuk/leash/latest";
async function checkForUpdates() {
  try {
    const response = await fetch(NPM_REGISTRY_URL);
    if (!response.ok) {
      return { hasUpdate: false, currentVersion: CURRENT_VERSION };
    }
    const data = await response.json();
    return {
      hasUpdate: data.version !== CURRENT_VERSION,
      latestVersion: data.version,
      currentVersion: CURRENT_VERSION
    };
  } catch {
    return { hasUpdate: false, currentVersion: CURRENT_VERSION };
  }
}

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
  const { hook_event_name, tool_name, tool_input } = input;
  const cwd = process.env.FACTORY_PROJECT_DIR || input.cwd || process.cwd();
  if (hook_event_name === "SessionStart") {
    const messages = ["\u{1F512} Leash active"];
    const update = await checkForUpdates();
    if (update.hasUpdate) {
      messages.push(
        `\u{1F504} Leash ${update.latestVersion} available. Run: leash --update`
      );
    }
    console.log(JSON.stringify({ systemMessage: messages.join("\n") }));
    process.exit(0);
  }
  const analyzer = new CommandAnalyzer(cwd);
  if (tool_name === "Execute") {
    const command = tool_input?.command || "";
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
    const path = tool_input?.file_path || "";
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
