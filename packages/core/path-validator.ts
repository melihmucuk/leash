import { resolve, relative } from "path";
import { homedir } from "os";
import { realpathSync } from "fs";
import {
  SAFE_WRITE_PATHS,
  TEMP_PATHS,
  PLATFORM_PATHS,
  PROTECTED_PATTERNS,
} from "./constants.js";

export class PathValidator {
  constructor(private workingDirectory: string) {}

  expand(path: string): string {
    return path
      .replace(/^~(?=\/|$)/, homedir())
      .replace(/\$\{?(\w+)\}?/g, (_, name) => {
        if (name === "HOME") return homedir();
        if (name === "PWD") return this.workingDirectory;
        return process.env[name] || "";
      });
  }

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

  isPlatformPath(path: string): boolean {
    const resolved = this.resolveReal(path);
    const home = homedir();
    const platformPaths = PLATFORM_PATHS.map((p) => `${home}/${p}`);
    return this.matchesAny(resolved, platformPaths);
  }

  isProtectedPath(path: string): { protected: boolean; name?: string } {
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
}
