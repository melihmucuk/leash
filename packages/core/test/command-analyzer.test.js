import { test } from "node:test";
import assert from "node:assert";
import { CommandAnalyzer } from "../lib/command-analyzer.js";

const workDir = process.cwd();
const analyzer = new CommandAnalyzer(workDir);

// Dangerous commands - blocked outside working dir
test("blocks rm outside working dir", () => {
  const result = analyzer.analyze("rm -rf ~/Documents");
  assert.strictEqual(result.blocked, true);
});

test("blocks mv to home", () => {
  const result = analyzer.analyze("mv file.txt ~/backup/");
  assert.strictEqual(result.blocked, true);
});

test("blocks chmod outside", () => {
  const result = analyzer.analyze("chmod 777 /etc/hosts");
  assert.strictEqual(result.blocked, true);
});

// Dangerous commands - allowed inside working dir
test("allows rm inside working dir", () => {
  const result = analyzer.analyze("rm -rf ./temp");
  assert.strictEqual(result.blocked, false);
});

test("allows mv inside working dir", () => {
  const result = analyzer.analyze("mv ./old.ts ./new.ts");
  assert.strictEqual(result.blocked, false);
});

// Temp paths allowed for delete
test("allows rm in /tmp", () => {
  const result = analyzer.analyze("rm -rf /tmp/cache");
  assert.strictEqual(result.blocked, false);
});

// cp special case - only destination matters
test("allows cp from outside (read-only source)", () => {
  const result = analyzer.analyze("cp /etc/hosts ./local-hosts");
  assert.strictEqual(result.blocked, false);
});

test("blocks cp to outside", () => {
  const result = analyzer.analyze("cp ./secret ~/leaked");
  assert.strictEqual(result.blocked, true);
});

// Redirects
test("blocks redirect to home", () => {
  const result = analyzer.analyze('echo "data" > ~/file.txt');
  assert.strictEqual(result.blocked, true);
});

test("allows redirect inside working dir", () => {
  const result = analyzer.analyze('echo "data" > ./output.txt');
  assert.strictEqual(result.blocked, false);
});

test("allows redirect to /dev/null", () => {
  const result = analyzer.analyze("command 2>/dev/null");
  assert.strictEqual(result.blocked, false);
});

test("blocks quoted redirect to home", () => {
  const result = analyzer.analyze('echo "data" > "~/file.txt"');
  assert.strictEqual(result.blocked, true);
});

// Command chains (&&, ||, ;, | all use same splitCommands logic)
test("blocks dangerous command in chain", () => {
  const result = analyzer.analyze("echo ok && rm ~/file");
  assert.strictEqual(result.blocked, true);
});

// Wrapper commands
test("blocks sudo rm outside", () => {
  const result = analyzer.analyze("sudo rm -rf ~/dir");
  assert.strictEqual(result.blocked, true);
});

test("blocks env rm outside", () => {
  const result = analyzer.analyze("env rm ~/file");
  assert.strictEqual(result.blocked, true);
});

test("blocks command wrapper rm outside", () => {
  const result = analyzer.analyze("command rm ~/file");
  assert.strictEqual(result.blocked, true);
});

// Quote-aware parsing
test("handles quoted paths", () => {
  const result = analyzer.analyze('rm "file with spaces"');
  assert.strictEqual(result.blocked, false);
});

// validatePath
test("validatePath blocks outside path", () => {
  const result = analyzer.validatePath("/etc/passwd");
  assert.strictEqual(result.blocked, true);
});

test("validatePath allows inside path", () => {
  const result = analyzer.validatePath("./src/file.ts");
  assert.strictEqual(result.blocked, false);
});

// Safe commands
test("allows safe commands", () => {
  const result = analyzer.analyze("ls -la");
  assert.strictEqual(result.blocked, false);
});

// Append redirect >>
test("blocks append redirect to home", () => {
  const result = analyzer.analyze('echo "data" >> ~/file.txt');
  assert.strictEqual(result.blocked, true);
});

// ln command
test("blocks ln outside working dir", () => {
  const result = analyzer.analyze("ln -s ./file ~/link");
  assert.strictEqual(result.blocked, true);
});

test("allows ln inside working dir", () => {
  const result = analyzer.analyze("ln -s ./file ./link");
  assert.strictEqual(result.blocked, false);
});

// Chain operators: ||, ;, and |
test("blocks dangerous command after || operator", () => {
  const result = analyzer.analyze("false || rm ~/file");
  assert.strictEqual(result.blocked, true);
});

test("blocks dangerous command after ; operator", () => {
  const result = analyzer.analyze("echo ok; rm ~/file");
  assert.strictEqual(result.blocked, true);
});

test("blocks dangerous command after pipe", () => {
  const result = analyzer.analyze("cat file | rm ~/file");
  assert.strictEqual(result.blocked, true);
});

// dd and truncate - special handling for device paths
test("allows truncate to /dev/null", () => {
  const result = analyzer.analyze("truncate -s 0 /dev/null");
  assert.strictEqual(result.blocked, false);
});

test("allows dd to /tmp", () => {
  const result = analyzer.analyze("dd if=/dev/zero of=/tmp/file bs=1M count=1");
  assert.strictEqual(result.blocked, false);
});

test("blocks dd to home", () => {
  const result = analyzer.analyze("dd if=/dev/zero of=~/file");
  assert.strictEqual(result.blocked, true);
});

// Empty path edge case
test("validatePath allows empty path", () => {
  const result = analyzer.validatePath("");
  assert.strictEqual(result.blocked, false);
});
