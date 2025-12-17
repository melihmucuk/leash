import { resolve, relative } from "path";
import { homedir } from "os";
import { realpathSync } from "fs";
import { SAFE_WRITE_PATHS, TEMP_PATHS } from "./constants.js";

export class PathValidator {
  constructor(private workingDirectory: string) {}

  /** Expand ~ and environment variables in path */
  private expand(path: string): string {
    return path
      .replace(/^~(?=\/|$)/, homedir())
      .replace(/\$\{?(\w+)\}?/g, (_, name) => {
        if (name === "HOME") return homedir();
        if (name === "PWD") return this.workingDirectory;
        return process.env[name] || "";
      });
  }

  /** Resolve path following all symlinks (including parent directories) */
  private resolveReal(path: string): string {
    const expanded = this.expand(path);
    const resolved = resolve(this.workingDirectory, expanded);

    try {
      return realpathSync(resolved);
    } catch {
      // Path doesn't exist yet, use resolved path
      return resolved;
    }
  }

  isWithinWorkingDir(path: string): boolean {
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

  private matchesAny(resolved: string, paths: string[]): boolean {
    return paths.some((p) => resolved === p || resolved.startsWith(p + "/"));
  }

  isSafeForWrite(path: string): boolean {
    const resolved = this.resolveReal(path);
    return this.matchesAny(resolved, SAFE_WRITE_PATHS);
  }

  isTempPath(path: string): boolean {
    const resolved = this.resolveReal(path);
    return this.matchesAny(resolved, TEMP_PATHS);
  }
}
