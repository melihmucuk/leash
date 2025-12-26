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

const DELETE_COMMANDS = new Set(["rm", "rmdir", "unlink", "shred"]);

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
    if (this.pathValidator.isPlatformPath(resolved)) return true;
    return allowDevicePaths
      ? this.pathValidator.isSafeForWrite(resolved)
      : this.pathValidator.isTempPath(resolved);
  }

  private checkProtectedPath(
    path: string,
    context: string,
    resolveBase?: string
  ): AnalysisResult {
    const resolved = this.resolvePath(path, resolveBase);
    const protection = this.pathValidator.isProtectedPath(resolved);
    if (protection.protected) {
      return {
        blocked: true,
        reason: `${context} targets protected path: ${protection.name}`,
      };
    }
    return { blocked: false };
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
        !this.pathValidator.isWithinWorkingDir(path) &&
        !this.pathValidator.isPlatformPath(path)
      ) {
        return {
          blocked: true,
          reason: `Redirect to path outside working directory: ${path}`,
        };
      }
      const result = this.checkProtectedPath(path, "Redirect");
      if (result.blocked) return result;
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

  private checkDangerousPatterns(
    command: string,
    resolveBase?: string
  ): AnalysisResult {
    for (const { pattern, name } of DANGEROUS_PATTERNS) {
      if (!pattern.test(command)) continue;

      const paths = this.extractPaths(command);
      for (const path of paths) {
        const resolved = this.resolvePath(path, resolveBase);
        if (
          !this.pathValidator.isWithinWorkingDir(resolved) &&
          !this.pathValidator.isTempPath(resolved) &&
          !this.pathValidator.isPlatformPath(resolved)
        ) {
          return {
            blocked: true,
            reason: `Command "${name}" targets path outside working directory: ${path}`,
          };
        }
        const result = this.checkProtectedPath(path, `Command "${name}"`, resolveBase);
        if (result.blocked) return result;
      }
    }
    return { blocked: false };
  }

  private checkCpCommand(
    paths: string[],
    resolveBase?: string
  ): AnalysisResult {
    if (paths.length === 0) return { blocked: false };

    const dest = paths[paths.length - 1];
    if (!this.isPathAllowed(dest, true, resolveBase)) {
      return {
        blocked: true,
        reason: `Command "cp" targets path outside working directory: ${this.resolvePath(dest, resolveBase)}`,
      };
    }
    return this.checkProtectedPath(dest, 'Command "cp"', resolveBase);
  }

  private checkDdCommand(
    command: string,
    resolveBase?: string
  ): AnalysisResult {
    const ofMatch = command.match(/\bof=["']?([^"'\s]+)["']?/);
    if (!ofMatch) return { blocked: false };

    const dest = ofMatch[1];
    if (!this.isPathAllowed(dest, true, resolveBase)) {
      return {
        blocked: true,
        reason: `Command "dd" targets path outside working directory: ${this.resolvePath(dest, resolveBase)}`,
      };
    }
    return this.checkProtectedPath(dest, 'Command "dd"', resolveBase);
  }

  private checkMvCommand(
    paths: string[],
    resolveBase?: string
  ): AnalysisResult {
    if (paths.length === 0) return { blocked: false };

    const dest = paths[paths.length - 1];
    const sources = paths.slice(0, -1);

    if (!this.isPathAllowed(dest, true, resolveBase)) {
      return {
        blocked: true,
        reason: `Command "mv" targets path outside working directory: ${this.resolvePath(dest, resolveBase)}`,
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
          reason: `Command "mv" targets path outside working directory: ${this.resolvePath(source, resolveBase)}`,
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

  private checkDeleteCommand(
    baseCmd: string,
    paths: string[],
    resolveBase?: string
  ): AnalysisResult {
    for (const path of paths) {
      if (!this.isPathAllowed(path, false, resolveBase)) {
        return {
          blocked: true,
          reason: `Command "${baseCmd}" targets path outside working directory: ${this.resolvePath(path, resolveBase)}`,
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

  private checkWriteCommand(
    baseCmd: string,
    paths: string[],
    resolveBase?: string
  ): AnalysisResult {
    const allowDevicePaths = baseCmd === "truncate";

    for (const path of paths) {
      if (!this.isPathAllowed(path, allowDevicePaths, resolveBase)) {
        return {
          blocked: true,
          reason: `Command "${baseCmd}" targets path outside working directory: ${this.resolvePath(path, resolveBase)}`,
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

  private checkDangerousCommand(
    command: string,
    resolveBase?: string
  ): AnalysisResult {
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

  analyze(command: string): AnalysisResult {
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
          currentWorkDir = resolve(currentWorkDir, expanded);
        }
        continue;
      }

      const resolveBase =
        currentWorkDir !== this.workingDirectory ? currentWorkDir : undefined;

      if (hasCd) {
        const patternResult = this.checkDangerousPatterns(trimmed, resolveBase);
        if (patternResult.blocked) return patternResult;
      }

      const result = this.checkDangerousCommand(trimmed, resolveBase);
      if (result.blocked) return result;
    }

    return { blocked: false };
  }

  validatePath(path: string): AnalysisResult {
    if (!path) return { blocked: false };

    if (
      !this.pathValidator.isSafeForWrite(path) &&
      !this.pathValidator.isWithinWorkingDir(path) &&
      !this.pathValidator.isPlatformPath(path)
    ) {
      return {
        blocked: true,
        reason: `File operation targets path outside working directory: ${path}`,
      };
    }

    return this.checkProtectedPath(path, "File operation");
  }
}
