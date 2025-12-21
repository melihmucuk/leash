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
