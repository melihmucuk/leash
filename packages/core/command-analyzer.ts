import { basename } from "path";
import { PathValidator } from "./path-validator.js";
import { DANGEROUS_COMMANDS, REDIRECT_PATTERN } from "./constants.js";

export interface AnalysisResult {
  blocked: boolean;
  reason?: string;
}

export class CommandAnalyzer {
  private pathValidator: PathValidator;

  constructor(private workingDirectory: string) {
    this.pathValidator = new PathValidator(workingDirectory);
  }

  /** Extract potential paths from command string */
  private extractPaths(command: string): string[] {
    const paths: string[] = [];

    // Match quoted strings
    const quoted = command.match(/["']([^"']+)["']/g) || [];
    quoted.forEach((q) => paths.push(q.slice(1, -1)));

    // Match unquoted paths
    const tokens = command
      .replace(/["'][^"']*["']/g, "")
      .split(/\s+/)
      .filter((t) => !t.startsWith("-"));

    tokens.forEach((t) => {
      if (
        t.includes("/") ||
        t.startsWith("~") ||
        t.startsWith(".") ||
        t.startsWith("$")
      ) {
        paths.push(t);
      }
    });

    return paths;
  }

  /** Get base command name, skipping common wrapper commands (sudo/env/command) */
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

  /** Split command by chain operators while respecting quotes */
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

  /** Check if path is allowed for the operation */
  private isPathAllowed(path: string, allowDevicePaths: boolean): boolean {
    if (this.pathValidator.isWithinWorkingDir(path)) return true;
    return allowDevicePaths
      ? this.pathValidator.isSafeForWrite(path)
      : this.pathValidator.isTempPath(path);
  }

  /** Check dangerous commands for external paths */
  private checkDangerousCommand(command: string): AnalysisResult {
    const baseCmd = this.getBaseCommand(command);

    if (!DANGEROUS_COMMANDS.has(baseCmd)) {
      return { blocked: false };
    }

    const paths = this.extractPaths(command);

    // cp: only check destination (last path), source is just read
    if (baseCmd === "cp" && paths.length > 0) {
      const dest = paths[paths.length - 1];
      if (!this.isPathAllowed(dest, true)) {
        return {
          blocked: true,
          reason: `Command "${baseCmd}" targets path outside working directory: ${dest}`,
        };
      }
      return { blocked: false };
    }

    // Write commands: allow device paths (e.g., truncate /dev/null)
    const isWriteCommand = baseCmd === "truncate" || baseCmd === "dd";

    for (const path of paths) {
      if (!this.isPathAllowed(path, isWriteCommand)) {
        return {
          blocked: true,
          reason: `Command "${baseCmd}" targets path outside working directory: ${path}`,
        };
      }
    }

    return { blocked: false };
  }

  /** Analyze command for dangerous operations */
  analyze(command: string): AnalysisResult {
    // Check redirects
    const redirectResult = this.checkRedirects(command);
    if (redirectResult.blocked) return redirectResult;

    // Split by chain operators and check each
    const commands = this.splitCommands(command);

    for (const cmd of commands) {
      const trimmed = cmd.trim();
      if (!trimmed) continue;

      const result = this.checkDangerousCommand(trimmed);
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
