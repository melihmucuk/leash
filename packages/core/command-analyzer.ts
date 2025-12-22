import { basename, resolve } from "path";
import { homedir } from "os";
import { PathValidator } from "./path-validator.js";
import {
  DANGEROUS_COMMANDS,
  DANGEROUS_PATTERNS,
  DANGEROUS_GIT_PATTERNS,
  REDIRECT_PATTERN,
} from "./constants.js";

export interface AnalysisResult {
  blocked: boolean;
  reason?: string;
}

export class CommandAnalyzer {
  private pathValidator: PathValidator;

  constructor(private workingDirectory: string) {
    this.pathValidator = new PathValidator(workingDirectory);
  }

  private resolvePath(path: string, resolveBase?: string): string {
    const expanded = this.pathValidator.expand(path);
    return resolveBase ? resolve(resolveBase, expanded) : expanded;
  }

  private isPathAllowed(
    path: string,
    allowDevicePaths: boolean,
    resolveBase?: string
  ): boolean {
    const resolved = this.resolvePath(path, resolveBase);
    if (this.pathValidator.isWithinWorkingDir(resolved)) return true;
    return allowDevicePaths
      ? this.pathValidator.isSafeForWrite(resolved)
      : this.pathValidator.isTempPath(resolved);
  }

  private extractPaths(command: string): string[] {
    const paths: string[] = [];

    const quoted = command.match(/["']([^"']+)["']/g) || [];
    quoted.forEach((q) => paths.push(q.slice(1, -1)));

    const tokens = command
      .replace(/["'][^"']*["']/g, "")
      .split(/\s+/)
      .filter((t) => !t.startsWith("-"));

    for (let i = 1; i < tokens.length; i++) {
      const value = tokens[i].includes("=")
        ? tokens[i].split("=").slice(1).join("=")
        : tokens[i];
      if (value) paths.push(value);
    }

    return paths;
  }

  private getBaseCommand(command: string): string {
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
      const optsWithArgs = new Set([
        "-u",
        "-C",
        "-S",
        "--unset",
        "--chdir",
        "--split-string",
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

  private splitCommands(command: string): string[] {
    const commands: string[] = [];
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
        if (
          (char === "&" && nextChar === "&") ||
          (char === "|" && nextChar === "|")
        ) {
          if (current.trim()) commands.push(current.trim());
          current = "";
          i += 2;
          continue;
        }

        if (char === ";" || (char === "|" && nextChar !== "|")) {
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

  private checkRedirects(command: string): AnalysisResult {
    const matches = command.matchAll(REDIRECT_PATTERN);

    for (const match of matches) {
      const path = match[1] || match[2] || match[3];
      if (!path || path.startsWith("&")) {
        continue;
      }
      if (
        !this.pathValidator.isSafeForWrite(path) &&
        !this.pathValidator.isWithinWorkingDir(path)
      ) {
        return {
          blocked: true,
          reason: `Redirect to path outside working directory: ${path}`,
        };
      }
    }

    return { blocked: false };
  }

  private isCdCommand(command: string): boolean {
    return this.getBaseCommand(command) === "cd";
  }

  private extractCdTarget(command: string): string | null {
    const trimmed = command.trim();

    const quotedMatch = trimmed.match(/^cd\s+["']([^"']+)["']/);
    if (quotedMatch) return quotedMatch[1];

    const tokens = trimmed.split(/\s+/);
    if (tokens[0] !== "cd") return null;
    if (tokens.length === 1) return homedir();

    let i = 1;
    while (i < tokens.length && tokens[i].startsWith("-")) {
      i++;
    }

    return tokens[i] || null;
  }

  private checkDangerousGitCommands(command: string): AnalysisResult {
    for (const { pattern, name } of DANGEROUS_GIT_PATTERNS) {
      if (pattern.test(command)) {
        return {
          blocked: true,
          reason: `Dangerous git command blocked: ${name}`,
        };
      }
    }
    return { blocked: false };
  }

  private checkDangerousPatterns(command: string): AnalysisResult {
    for (const { pattern, name } of DANGEROUS_PATTERNS) {
      if (!pattern.test(command)) continue;

      const paths = this.extractPaths(command);
      for (const path of paths) {
        if (
          !this.pathValidator.isWithinWorkingDir(path) &&
          !this.pathValidator.isTempPath(path)
        ) {
          return {
            blocked: true,
            reason: `Command "${name}" targets path outside working directory: ${path}`,
          };
        }
      }
    }
    return { blocked: false };
  }

  private checkDangerousCommand(
    command: string,
    resolveBase?: string
  ): AnalysisResult {
    const baseCmd = this.getBaseCommand(command);

    if (!DANGEROUS_COMMANDS.has(baseCmd)) {
      return { blocked: false };
    }

    const paths = this.extractPaths(command);

    // cp: only destination matters, source is read-only
    if (baseCmd === "cp" && paths.length > 0) {
      const dest = paths[paths.length - 1];
      if (!this.isPathAllowed(dest, true, resolveBase)) {
        return {
          blocked: true,
          reason: `Command "${baseCmd}" targets path outside working directory: ${this.resolvePath(
            dest,
            resolveBase
          )}`,
        };
      }
      return { blocked: false };
    }

    // dd: only of= matters, if= is read-only
    if (baseCmd === "dd") {
      const ofMatch = command.match(/\bof=["']?([^"'\s]+)["']?/);
      if (ofMatch && !this.isPathAllowed(ofMatch[1], true, resolveBase)) {
        return {
          blocked: true,
          reason: `Command "dd" targets path outside working directory: ${this.resolvePath(
            ofMatch[1],
            resolveBase
          )}`,
        };
      }
      return { blocked: false };
    }

    // truncate: allow device paths like /dev/null
    const allowDevicePaths = baseCmd === "truncate";

    for (const path of paths) {
      if (!this.isPathAllowed(path, allowDevicePaths, resolveBase)) {
        return {
          blocked: true,
          reason: `Command "${baseCmd}" targets path outside working directory: ${this.resolvePath(
            path,
            resolveBase
          )}`,
        };
      }
    }

    return { blocked: false };
  }

  analyze(command: string): AnalysisResult {
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
          currentWorkDir = resolve(currentWorkDir, expanded);
        }
        continue;
      }

      const resolveBase =
        currentWorkDir !== this.workingDirectory ? currentWorkDir : undefined;
      const result = this.checkDangerousCommand(trimmed, resolveBase);
      if (result.blocked) return result;
    }

    return { blocked: false };
  }

  validatePath(path: string): AnalysisResult {
    if (!path) return { blocked: false };

    if (
      !this.pathValidator.isSafeForWrite(path) &&
      !this.pathValidator.isWithinWorkingDir(path)
    ) {
      return {
        blocked: true,
        reason: `File operation targets path outside working directory: ${path}`,
      };
    }

    return { blocked: false };
  }
}
