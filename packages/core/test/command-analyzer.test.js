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

// Compound dangerous patterns: find -delete
test("blocks find -delete outside working dir", () => {
  const result = analyzer.analyze("find ~/Documents -name '*.tmp' -delete");
  assert.strictEqual(result.blocked, true);
});

test("allows find -delete inside working dir", () => {
  const result = analyzer.analyze("find ./temp -name '*.tmp' -delete");
  assert.strictEqual(result.blocked, false);
});

test("allows find -delete in /tmp", () => {
  const result = analyzer.analyze("find /tmp -name '*.log' -delete");
  assert.strictEqual(result.blocked, false);
});

// Compound dangerous patterns: find -exec rm/mv/cp
test("blocks find -exec rm outside working dir", () => {
  const result = analyzer.analyze("find ~ -type f -exec rm {} \\;");
  assert.strictEqual(result.blocked, true);
});

test("allows find -exec rm inside working dir", () => {
  const result = analyzer.analyze("find . -name '*.bak' -exec rm {} \\;");
  assert.strictEqual(result.blocked, false);
});

// Compound dangerous patterns: xargs rm/mv/cp
test("blocks xargs rm with path outside working dir", () => {
  const result = analyzer.analyze("find ~/old -name '*.log' | xargs rm");
  assert.strictEqual(result.blocked, true);
});

test("allows xargs rm with path inside working dir", () => {
  const result = analyzer.analyze("find ./logs -name '*.log' | xargs rm");
  assert.strictEqual(result.blocked, false);
});

test("blocks xargs with flags rm outside working dir", () => {
  const result = analyzer.analyze("find ~ | xargs -I{} rm {}");
  assert.strictEqual(result.blocked, true);
});

// Compound dangerous patterns: rsync --delete
test("blocks rsync --delete outside working dir", () => {
  const result = analyzer.analyze("rsync -av --delete ~/src/ ~/backup/");
  assert.strictEqual(result.blocked, true);
});

test("allows rsync --delete inside working dir", () => {
  const result = analyzer.analyze("rsync -av --delete ./src/ ./backup/");
  assert.strictEqual(result.blocked, false);
});

test("allows rsync --delete to /tmp", () => {
  const result = analyzer.analyze("rsync -av --delete ./src/ /tmp/backup/");
  assert.strictEqual(result.blocked, false);
});

// Dangerous git commands - blocked even within working directory

// git checkout -- <files>
test("blocks git checkout -- (discards changes)", () => {
  const result = analyzer.analyze("git checkout -- .");
  assert.strictEqual(result.blocked, true);
  assert.ok(result.reason.includes("git checkout --"));
});

test("blocks git checkout with path and --", () => {
  const result = analyzer.analyze("git checkout HEAD -- src/file.ts");
  assert.strictEqual(result.blocked, true);
});

test("allows git checkout for branch switching", () => {
  const result = analyzer.analyze("git checkout main");
  assert.strictEqual(result.blocked, false);
});

test("allows git checkout -b for new branch", () => {
  const result = analyzer.analyze("git checkout -b feature/new");
  assert.strictEqual(result.blocked, false);
});

// git restore
test("blocks git restore (discards changes)", () => {
  const result = analyzer.analyze("git restore .");
  assert.strictEqual(result.blocked, true);
  assert.ok(result.reason.includes("git restore"));
});

test("blocks git restore with file path", () => {
  const result = analyzer.analyze("git restore src/file.ts");
  assert.strictEqual(result.blocked, true);
});

test("allows git restore --staged (safe - unstages)", () => {
  const result = analyzer.analyze("git restore --staged .");
  assert.strictEqual(result.blocked, false);
});

// git reset --hard
test("blocks git reset --hard", () => {
  const result = analyzer.analyze("git reset --hard");
  assert.strictEqual(result.blocked, true);
  assert.ok(result.reason.includes("git reset --hard"));
});

test("blocks git reset --hard with ref", () => {
  const result = analyzer.analyze("git reset --hard HEAD~1");
  assert.strictEqual(result.blocked, true);
});

test("allows git reset without --hard (soft reset)", () => {
  const result = analyzer.analyze("git reset HEAD~1");
  assert.strictEqual(result.blocked, false);
});

test("allows git reset --soft", () => {
  const result = analyzer.analyze("git reset --soft HEAD~1");
  assert.strictEqual(result.blocked, false);
});

// git reset --merge
test("blocks git reset --merge", () => {
  const result = analyzer.analyze("git reset --merge");
  assert.strictEqual(result.blocked, true);
  assert.ok(result.reason.includes("git reset --merge"));
});

// git clean -f/--force
test("blocks git clean -f", () => {
  const result = analyzer.analyze("git clean -f");
  assert.strictEqual(result.blocked, true);
  assert.ok(result.reason.includes("git clean"));
});

test("blocks git clean --force", () => {
  const result = analyzer.analyze("git clean --force");
  assert.strictEqual(result.blocked, true);
});

test("blocks git clean -fd", () => {
  const result = analyzer.analyze("git clean -fd");
  assert.strictEqual(result.blocked, true);
});

test("allows git clean -n (dry run)", () => {
  const result = analyzer.analyze("git clean -n");
  assert.strictEqual(result.blocked, false);
});

// git push --force/-f
test("blocks git push --force", () => {
  const result = analyzer.analyze("git push --force");
  assert.strictEqual(result.blocked, true);
  assert.ok(result.reason.includes("git push --force"));
});

test("blocks git push -f", () => {
  const result = analyzer.analyze("git push -f");
  assert.strictEqual(result.blocked, true);
});

test("blocks git push origin main --force", () => {
  const result = analyzer.analyze("git push origin main --force");
  assert.strictEqual(result.blocked, true);
});

test("allows git push (normal)", () => {
  const result = analyzer.analyze("git push origin main");
  assert.strictEqual(result.blocked, false);
});

// git branch -D
test("blocks git branch -D", () => {
  const result = analyzer.analyze("git branch -D feature/old");
  assert.strictEqual(result.blocked, true);
  assert.ok(result.reason.includes("git branch -D"));
});

test("allows git branch -d (safe delete)", () => {
  const result = analyzer.analyze("git branch -d feature/merged");
  assert.strictEqual(result.blocked, false);
});

// git stash drop
test("blocks git stash drop", () => {
  const result = analyzer.analyze("git stash drop");
  assert.strictEqual(result.blocked, true);
  assert.ok(result.reason.includes("git stash drop"));
});

test("blocks git stash drop with index", () => {
  const result = analyzer.analyze("git stash drop stash@{0}");
  assert.strictEqual(result.blocked, true);
});

// git stash clear
test("blocks git stash clear", () => {
  const result = analyzer.analyze("git stash clear");
  assert.strictEqual(result.blocked, true);
  assert.ok(result.reason.includes("git stash clear"));
});

// Safe git commands (should not be blocked)
test("allows git status", () => {
  const result = analyzer.analyze("git status");
  assert.strictEqual(result.blocked, false);
});

test("allows git add", () => {
  const result = analyzer.analyze("git add .");
  assert.strictEqual(result.blocked, false);
});

test("allows git commit", () => {
  const result = analyzer.analyze("git commit -m 'test'");
  assert.strictEqual(result.blocked, false);
});

test("allows git stash (save)", () => {
  const result = analyzer.analyze("git stash");
  assert.strictEqual(result.blocked, false);
});

test("allows git stash pop", () => {
  const result = analyzer.analyze("git stash pop");
  assert.strictEqual(result.blocked, false);
});

// cd context tracking for dangerous patterns
test("allows cd inside working dir followed by find -delete with relative parent path", () => {
  const result = analyzer.analyze("cd ./packages && find ../dist -delete");
  assert.strictEqual(result.blocked, false);
});

test("blocks cd inside working dir followed by find -delete escaping", () => {
  const result = analyzer.analyze("cd ./packages && find ../../other -delete");
  assert.strictEqual(result.blocked, true);
});

// cd bypass prevention
test("blocks cd outside working dir followed by rm", () => {
  const result = analyzer.analyze('cd ~/Downloads && rm -rf folder');
  assert.strictEqual(result.blocked, true);
});

test("blocks cd to absolute path followed by rm", () => {
  const result = analyzer.analyze('cd /Users/someone/Downloads && rm -rf "folder"');
  assert.strictEqual(result.blocked, true);
});

test("blocks cd with quoted path followed by rm", () => {
  const result = analyzer.analyze('cd "/Users/someone/Downloads" && rm -rf folder');
  assert.strictEqual(result.blocked, true);
});

test("allows cd inside working dir followed by rm", () => {
  const result = analyzer.analyze('cd ./subdir && rm -rf temp');
  assert.strictEqual(result.blocked, false);
});

test("allows cd to /tmp followed by rm", () => {
  const result = analyzer.analyze('cd /tmp && rm -rf cache');
  assert.strictEqual(result.blocked, false);
});

test("blocks multiple cd hops escaping working dir", () => {
  const result = analyzer.analyze('cd .. && cd .. && rm -rf target');
  assert.strictEqual(result.blocked, true);
});

test("blocks cd home followed by dangerous command", () => {
  const result = analyzer.analyze('cd && rm -rf Documents');
  assert.strictEqual(result.blocked, true);
});

// Protected paths - .env files
test("blocks rm .env", () => {
  const result = analyzer.analyze("rm .env");
  assert.strictEqual(result.blocked, true);
  assert.ok(result.reason.includes(".env files"));
});

test("blocks rm .env.local", () => {
  const result = analyzer.analyze("rm .env.local");
  assert.strictEqual(result.blocked, true);
});

test("allows rm .env.example", () => {
  const result = analyzer.analyze("rm .env.example");
  assert.strictEqual(result.blocked, false);
});

test("blocks redirect to .env", () => {
  const result = analyzer.analyze('echo "SECRET=123" > .env');
  assert.strictEqual(result.blocked, true);
  assert.ok(result.reason.includes(".env files"));
});

test("blocks mv .env (source delete)", () => {
  const result = analyzer.analyze("mv .env .env.backup");
  assert.strictEqual(result.blocked, true);
});

test("blocks cp to .env (dest write)", () => {
  const result = analyzer.analyze("cp template .env");
  assert.strictEqual(result.blocked, true);
});

test("validatePath blocks .env", () => {
  const result = analyzer.validatePath(".env");
  assert.strictEqual(result.blocked, true);
  assert.ok(result.reason.includes(".env files"));
});

test("validatePath blocks .env.local", () => {
  const result = analyzer.validatePath(".env.local");
  assert.strictEqual(result.blocked, true);
});

test("validatePath allows .env.example", () => {
  const result = analyzer.validatePath(".env.example");
  assert.strictEqual(result.blocked, false);
});

// Protected paths - .git directory
test("blocks rm -rf .git", () => {
  const result = analyzer.analyze("rm -rf .git");
  assert.strictEqual(result.blocked, true);
  assert.ok(result.reason.includes(".git directory"));
});

test("blocks redirect to .git/config", () => {
  const result = analyzer.analyze('echo "[user]" > .git/config');
  assert.strictEqual(result.blocked, true);
  assert.ok(result.reason.includes(".git directory"));
});

test("blocks truncate .git/HEAD", () => {
  const result = analyzer.analyze("truncate -s 0 .git/HEAD");
  assert.strictEqual(result.blocked, true);
});

test("blocks dd to .git/objects", () => {
  const result = analyzer.analyze("dd if=/dev/zero of=.git/objects/pack");
  assert.strictEqual(result.blocked, true);
});

test("validatePath blocks .git/config", () => {
  const result = analyzer.validatePath(".git/config");
  assert.strictEqual(result.blocked, true);
  assert.ok(result.reason.includes(".git directory"));
});

// Protected paths with dangerous patterns (find -delete, xargs rm, etc.)
test("blocks find -delete on .env", () => {
  const result = analyzer.analyze("find . -name '.env' -delete");
  assert.strictEqual(result.blocked, true);
  assert.ok(result.reason.includes(".env files"));
});

test("blocks find -exec rm on .git", () => {
  const result = analyzer.analyze("find .git -type f -exec rm {} \\;");
  assert.strictEqual(result.blocked, true);
  assert.ok(result.reason.includes(".git directory"));
});

test("blocks xargs rm on .env files", () => {
  const result = analyzer.analyze("echo .env.local | xargs rm");
  assert.strictEqual(result.blocked, true);
  assert.ok(result.reason.includes(".env files"));
});

// Platform paths - allowed for write/delete operations
test("allows rm in ~/.claude", () => {
  const result = analyzer.analyze("rm ~/.claude/plans/old-plan.md");
  assert.strictEqual(result.blocked, false);
});

test("allows rm in ~/.factory", () => {
  const result = analyzer.analyze("rm ~/.factory/cache/temp.json");
  assert.strictEqual(result.blocked, false);
});

test("allows rm in ~/.pi", () => {
  const result = analyzer.analyze("rm ~/.pi/agent/old.md");
  assert.strictEqual(result.blocked, false);
});

test("allows rm in ~/.config/opencode", () => {
  const result = analyzer.analyze("rm ~/.config/opencode/cache.json");
  assert.strictEqual(result.blocked, false);
});

test("validatePath allows ~/.claude path", () => {
  const result = analyzer.validatePath("~/.claude/plans/test.md");
  assert.strictEqual(result.blocked, false);
});

test("validatePath allows ~/.config/opencode path", () => {
  const result = analyzer.validatePath("~/.config/opencode/settings.json");
  assert.strictEqual(result.blocked, false);
});

test("allows redirect to ~/.claude", () => {
  const result = analyzer.analyze('echo "plan" > ~/.claude/plans/new.md');
  assert.strictEqual(result.blocked, false);
});

test("allows find -delete in ~/.claude", () => {
  const result = analyzer.analyze("find ~/.claude/plans -name '*.tmp' -delete");
  assert.strictEqual(result.blocked, false);
});

test("allows rsync --delete to ~/.claude", () => {
  const result = analyzer.analyze("rsync -av --delete ./src/ ~/.claude/backup/");
  assert.strictEqual(result.blocked, false);
});

test("allows xargs rm in ~/.pi", () => {
  const result = analyzer.analyze("find ~/.pi/cache | xargs rm");
  assert.strictEqual(result.blocked, false);
});
