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

  /** Get the base command name */
  private getBaseCommand(command: string): string {
    const firstWord = command.trim().split(/\s+/)[0] || "";
    return basename(firstWord);
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
      const path = match[1];
      if (
        path &&
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

  /**
   * Extract search paths from find command
   * find [options] [path...] [expression]
   * Paths come after 'find' and before first flag/expression
   * Handles quoted paths by stripping quotes
   */
  private extractFindPaths(command: string): string[] {
    const tokens = command.trim().split(/\s+/);
    const paths: string[] = [];

    // Skip 'find', collect paths until first flag or expression
    for (let i = 1; i < tokens.length; i++) {
      let token = tokens[i];

      // Strip quotes if present
      if (
        (token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'"))
      ) {
        token = token.slice(1, -1);
      }

      // Stop at flags, negation, or grouping
      if (token.startsWith("-") || token === "!" || token === "(" || token === "\\(") {
        break;
      }
      paths.push(token);
    }

    // Default to current directory if no paths specified
    return paths.length > 0 ? paths : ["."];
  }

  /**
   * Check find command for destructive actions (-delete, -exec, -ok, etc.)
   * Validates search paths if destructive action is present
   */
  private checkFindCommand(command: string): AnalysisResult {
    // Check for -delete flag
    const hasDelete = /\s-delete\b/.test(command);

    // Check ALL -exec/-execdir/-ok/-okdir occurrences for dangerous commands
    const execPattern = /-(?:exec|ok)(?:dir)?\s+(\S+)/g;
    const execMatches = [...command.matchAll(execPattern)];
    const dangerousExec = execMatches.find((match) =>
      DANGEROUS_COMMANDS.has(basename(match[1]))
    );

    // If no destructive action, allow
    if (!hasDelete && !dangerousExec) {
      return { blocked: false };
    }

    // Extract and validate all search paths
    const paths = this.extractFindPaths(command);

    for (const path of paths) {
      if (!this.isPathAllowed(path, false)) {
        const action = hasDelete ? "-delete" : `-exec ${dangerousExec?.[1]}`;
        return {
          blocked: true,
          reason: `Command "find" with ${action} targets path outside working directory: ${path}`,
        };
      }
    }

    return { blocked: false };
  }

  /**
   * Check xargs command for dangerous commands
   * Cannot validate piped input, so block if dangerous command detected
   */
  private checkXargsCommand(command: string): AnalysisResult {
    const tokens = command.trim().split(/\s+/);
    // xargs options that take an argument
    const optsWithArgs = new Set(["-I", "-L", "-n", "-P", "-s", "-d", "-E", "-a"]);

    let i = 1; // Skip 'xargs'
    while (i < tokens.length) {
      const token = tokens[i];

      // Skip options
      if (token.startsWith("-")) {
        // If option takes argument and next token exists, skip it too
        if (optsWithArgs.has(token) && i + 1 < tokens.length) {
          i++;
        }
        i++;
        continue;
      }

      // Found the command xargs will execute
      const cmd = basename(token);
      if (DANGEROUS_COMMANDS.has(cmd)) {
        return {
          blocked: true,
          reason: `Command "xargs ${cmd}" blocked - cannot validate piped input`,
        };
      }
      break;
    }

    return { blocked: false };
  }

  /** Check dangerous commands for external paths */
  private checkDangerousCommand(command: string): AnalysisResult {
    const baseCmd = this.getBaseCommand(command);

    // Special handling for find (can be destructive with -delete or -exec)
    if (baseCmd === "find") {
      return this.checkFindCommand(command);
    }

    // Special handling for xargs (proxies commands with unvalidatable input)
    if (baseCmd === "xargs") {
      return this.checkXargsCommand(command);
    }

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

    // Check find commands BEFORE splitting (find uses ; as -exec terminator, not shell separator)
    // Only return early if BLOCKED - otherwise continue to check piped commands (e.g., find | xargs rm)
    const baseCmd = this.getBaseCommand(command);
    if (baseCmd === "find") {
      const findResult = this.checkFindCommand(command);
      if (findResult.blocked) return findResult;
    }

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
