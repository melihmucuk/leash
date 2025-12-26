import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PathValidator } from "../lib/path-validator.js";

const workDir = process.cwd();
const validator = new PathValidator(workDir);

// isWithinWorkingDir
test("allows relative path inside working dir", () => {
  assert.strictEqual(validator.isWithinWorkingDir("./src/file.ts"), true);
});

test("allows nested relative path", () => {
  assert.strictEqual(validator.isWithinWorkingDir("src/lib/util.ts"), true);
});

test("blocks path with ..", () => {
  assert.strictEqual(validator.isWithinWorkingDir("../outside"), false);
});

test("blocks home directory path", () => {
  assert.strictEqual(validator.isWithinWorkingDir("~/Documents"), false);
});

test("blocks $HOME expansion", () => {
  assert.strictEqual(validator.isWithinWorkingDir("$HOME/file"), false);
});

test("blocks ${HOME} expansion", () => {
  assert.strictEqual(validator.isWithinWorkingDir("${HOME}/file"), false);
});

test("blocks absolute path outside", () => {
  assert.strictEqual(validator.isWithinWorkingDir("/etc/passwd"), false);
});

test("allows working directory root path", () => {
  assert.strictEqual(validator.isWithinWorkingDir("."), true);
  assert.strictEqual(validator.isWithinWorkingDir("./"), true);
});

test("allows $PWD expansion", () => {
  assert.strictEqual(validator.isWithinWorkingDir("$PWD/file"), true);
  assert.strictEqual(validator.isWithinWorkingDir("${PWD}/file"), true);
});

// isSafeForWrite
test("allows /dev/null for write", () => {
  assert.strictEqual(validator.isSafeForWrite("/dev/null"), true);
});

test("allows /tmp for write", () => {
  assert.strictEqual(validator.isSafeForWrite("/tmp/cache"), true);
});

test("blocks home path for write", () => {
  assert.strictEqual(validator.isSafeForWrite("~/file"), false);
});

// isTempPath
test("recognizes /tmp as temp", () => {
  assert.strictEqual(validator.isTempPath("/tmp/file"), true);
});

test("recognizes /var/tmp as temp", () => {
  assert.strictEqual(validator.isTempPath("/var/tmp/file"), true);
});

test("/dev/null is not temp path", () => {
  assert.strictEqual(validator.isTempPath("/dev/null"), false);
});

// isPlatformPath
test("recognizes ~/.claude as platform path", () => {
  assert.strictEqual(validator.isPlatformPath("~/.claude/plans/test.md"), true);
});

test("recognizes ~/.factory as platform path", () => {
  assert.strictEqual(validator.isPlatformPath("~/.factory/settings.json"), true);
});

test("recognizes ~/.pi as platform path", () => {
  assert.strictEqual(validator.isPlatformPath("~/.pi/agent/test.md"), true);
});

test("recognizes ~/.config/opencode as platform path", () => {
  assert.strictEqual(validator.isPlatformPath("~/.config/opencode/config.json"), true);
});

test("does not recognize arbitrary home paths as platform path", () => {
  assert.strictEqual(validator.isPlatformPath("~/Documents/file.txt"), false);
});

// isProtectedPath
test("protects .env", () => {
  const result = validator.isProtectedPath(".env");
  assert.strictEqual(result.protected, true);
  assert.strictEqual(result.name, ".env files");
});

test("protects .env.local", () => {
  const result = validator.isProtectedPath(".env.local");
  assert.strictEqual(result.protected, true);
});

test("protects .env.production", () => {
  const result = validator.isProtectedPath(".env.production");
  assert.strictEqual(result.protected, true);
});

test("allows .env.example", () => {
  const result = validator.isProtectedPath(".env.example");
  assert.strictEqual(result.protected, false);
});

test("protects .git", () => {
  const result = validator.isProtectedPath(".git");
  assert.strictEqual(result.protected, true);
  assert.strictEqual(result.name, ".git directory");
});

test("protects .git/config", () => {
  const result = validator.isProtectedPath(".git/config");
  assert.strictEqual(result.protected, true);
});

test("protects .git/hooks/pre-commit", () => {
  const result = validator.isProtectedPath(".git/hooks/pre-commit");
  assert.strictEqual(result.protected, true);
});

test("does not protect paths outside working dir", () => {
  const result = validator.isProtectedPath("/etc/.env");
  assert.strictEqual(result.protected, false);
});

// Symlink escape - critical security test
test("blocks symlink that points outside working dir", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "leash-test-"));
  const symlinkPath = join(workDir, "test-escape-link");

  try {
    // Create symlink inside working dir that points to /tmp
    symlinkSync(tempDir, symlinkPath);

    // Should block because resolved path is outside working dir
    assert.strictEqual(validator.isWithinWorkingDir(symlinkPath), false);
    assert.strictEqual(validator.isWithinWorkingDir("./test-escape-link"), false);
  } finally {
    rmSync(symlinkPath, { force: true });
    rmSync(tempDir, { force: true, recursive: true });
  }
});
