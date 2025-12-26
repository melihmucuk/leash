# Leash 🔒

[![npm version](https://img.shields.io/npm/v/@melihmucuk/leash.svg)](https://www.npmjs.com/package/@melihmucuk/leash)

**Security guardrails for AI coding agents.** Sandboxes file system access, blocks dangerous commands outside project directory, prevents destructive git operations, catches agent hallucinations before they cause damage.

## Why Leash?

AI agents can hallucinate dangerous commands. Leash sandboxes them:

- Blocks `rm`, `mv`, `cp`, `chmod` outside working directory
- Protects sensitive files (`.env`, `.git`) even inside project
- Blocks `git reset --hard`, `push --force`, `clean -f`
- Resolves symlinks to prevent directory escapes
- Analyzes command chains (`&&`, `||`, `;`, `|`)

![Claude Code](assets/claude-code.png)

## Example horror stories

<img height="400" alt="image" src="https://github.com/user-attachments/assets/db503024-94ca-4443-b80e-b63fbc740367" />

<img height="400" alt="image" src="https://github.com/user-attachments/assets/94f0a4e5-db6c-4b14-bddd-b8984c51ed3d" />

Links:
1. [Claude CLI deleted my entire home directory (Dec 8th 2025)](https://www.reddit.com/r/ClaudeAI/comments/1pgxckk/claude_cli_deleted_my_entire_home_directory_wiped/)
2. [Google Antigravity just deleted my drive (Nov 27th 2025)](https://www.reddit.com/r/google_antigravity/comments/1p82or6/google_antigravity_just_deleted_the_contents_of/)

## Quick Start

```bash
# Install leash globally
npm install -g @melihmucuk/leash

# Setup leash for your platform
leash --setup <platform>

# Remove leash from a platform
leash --remove <platform>

# Update leash anytime
leash --update
```

| Platform        | Command                     |
| --------------- | --------------------------- |
| OpenCode        | `leash --setup opencode`    |
| Pi Coding Agent | `leash --setup pi`          |
| Claude Code     | `leash --setup claude-code` |
| Factory Droid   | `leash --setup factory`     |

Restart your agent. Done!

<details>
<summary><b>Manual Setup</b></summary>

If you prefer manual configuration, use `leash --path <platform>` to get the path and add it to your config file.

**Pi Coding Agent** - [docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/hooks.md)

Add to `~/.pi/agent/settings.json`:

```json
{
  "hooks": ["<path from leash --path pi>"]
}
```

**OpenCode** - [docs](https://opencode.ai/docs/plugins/)

Add to `~/.config/opencode/opencode.json` (or `opencode.jsonc` if you use that):

```json
{
  "plugin": ["<path from leash --path opencode>"]
}
```

**Claude Code** - [docs](https://code.claude.com/docs/en/hooks-guide)

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node <path from leash --path claude-code>"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash|Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node <path from leash --path claude-code>"
          }
        ]
      }
    ]
  }
}
```

**Factory Droid** - [docs](https://docs.factory.ai/cli/configuration/hooks-guide)

Add to `~/.factory/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node <path from leash --path factory>"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Execute|Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node <path from leash --path factory>"
          }
        ]
      }
    ]
  }
}
```

</details>

## What Gets Blocked

```bash
# Dangerous commands outside working directory
rm -rf ~/Documents                # ❌ Delete outside working dir
mv ~/.bashrc /tmp/                # ❌ Move from outside
echo "data" > ~/file.txt          # ❌ Redirect to home

# Protected files (blocked even inside project)
rm .env                           # ❌ Protected file
echo "SECRET=x" > .env.local      # ❌ Protected file
rm -rf .git                       # ❌ Protected directory

# Dangerous git commands (blocked everywhere)
git reset --hard                  # ❌ Destroys uncommitted changes
git push --force                  # ❌ Destroys remote history
git clean -fd                     # ❌ Removes untracked files

# File operations via Write/Edit tools
~/.bashrc                         # ❌ Home directory file
../../../etc/hosts                # ❌ Path traversal
.env                              # ❌ Protected file
```

## What's Allowed

```bash
rm -rf ./node_modules             # ✅ Working directory
rm -rf /tmp/build-cache           # ✅ Temp directory
rm .env.example                   # ✅ Example files allowed
git commit -m "message"           # ✅ Safe git commands
git push origin main              # ✅ Normal push (no --force)
echo "plan" > ~/.claude/plans/x   # ✅ Platform config directories
rm ~/.pi/agent/old.md             # ✅ Platform config directories
```

<details>

<summary><b>Detailed Examples</b></summary>

### Dangerous Commands

```bash
rm -rf ~/Documents           # ❌ Delete outside working dir
mv ~/.bashrc /tmp/           # ❌ Move from outside
cp ./secrets ~/leaked        # ❌ Copy to outside
chmod 777 /etc/hosts         # ❌ Permission change outside
chown user ~/file            # ❌ Ownership change outside
ln -s ./file ~/link          # ❌ Symlink to outside
dd if=/dev/zero of=~/file    # ❌ Write outside
truncate -s 0 ~/file         # ❌ Truncate outside
```

### Dangerous Git Commands

```bash
git checkout -- .            # ❌ Discards uncommitted changes
git restore src/file.ts      # ❌ Discards uncommitted changes
git reset --hard             # ❌ Destroys all uncommitted changes
git reset --hard HEAD~1      # ❌ Destroys commits and changes
git reset --merge            # ❌ Can lose uncommitted changes
git clean -f                 # ❌ Removes untracked files permanently
git clean -fd                # ❌ Removes untracked files and directories
git push --force             # ❌ Destroys remote history
git push -f origin main      # ❌ Destroys remote history
git branch -D feature        # ❌ Force-deletes branch without merge check
git stash drop               # ❌ Permanently deletes stashed changes
git stash clear              # ❌ Deletes ALL stashed changes
```

### Redirects

```bash
echo "data" > ~/file.txt     # ❌ Redirect to home
echo "log" >> ~/app.log      # ❌ Append to home
cat secrets > "/tmp/../~/x"  # ❌ Path traversal in redirect
```

### Command Chains

```bash
echo ok && rm ~/file         # ❌ Dangerous command after &&
false || rm -rf ~/           # ❌ Dangerous command after ||
ls; rm ~/file                # ❌ Dangerous command after ;
cat x | rm ~/file            # ❌ Dangerous command in pipe
cd ~/Downloads && rm file    # ❌ cd outside + dangerous command
cd .. && cd .. && rm target  # ❌ cd hops escaping working dir
```

### Wrapper Commands

```bash
sudo rm -rf ~/dir            # ❌ sudo + dangerous command
env rm ~/file                # ❌ env + dangerous command
command rm ~/file            # ❌ command + dangerous command
```

### Compound Patterns

```bash
find ~ -name "*.tmp" -delete          # ❌ find -delete outside
find ~ -exec rm {} \;                 # ❌ find -exec rm outside
find ~/logs | xargs rm                # ❌ xargs rm outside
find ~ | xargs -I{} mv {} /tmp        # ❌ xargs mv outside
rsync -av --delete ~/src/ ~/dst/      # ❌ rsync --delete outside
```

### Protected Files (blocked even inside project)

```bash
rm .env                      # ❌ Environment file
rm .env.local                # ❌ Environment file
rm .env.production           # ❌ Environment file
echo "x" > .env              # ❌ Write to env file
rm -rf .git                  # ❌ Git directory
echo "x" > .git/config       # ❌ Write to git directory
find . -name ".env" -delete  # ❌ Delete protected via find
```

Note: `.env.example` is allowed (template files are safe).

### File Operations (Write/Edit tools)

```bash
/etc/passwd                  # ❌ System file
~/.bashrc                    # ❌ Home directory file
/home/user/.ssh/id_rsa       # ❌ Absolute path outside
../../../etc/hosts           # ❌ Path traversal
.env                         # ❌ Protected file
.git/config                  # ❌ Protected directory
```

### What's Allowed (Full List)

```bash
# Working directory operations
rm -rf ./node_modules
mv ./old.ts ./new.ts
cp ./src/config.json ./dist/
find . -name "*.bak" -delete
find ./logs | xargs rm

# Temp directory operations
rm -rf /tmp/build-cache
echo "data" > /tmp/output.txt
rsync -av --delete ./src/ /tmp/backup/

# Platform config directories
rm ~/.claude/plans/old-plan.md
echo "config" > ~/.factory/cache.json
rm ~/.pi/agent/temp.md
rm ~/.config/opencode/cache.json
find ~/.claude -name '*.tmp' -delete
rsync -av --delete ./src/ ~/.pi/backup/

# Device paths
echo "x" > /dev/null
truncate -s 0 /dev/null

# Read from anywhere (safe)
cp /etc/hosts ./local-hosts
cat /etc/passwd

# Safe git commands
git status
git add .
git commit -m "message"
git push origin main
git checkout main
git checkout -b feature/new
git branch -d merged-branch      # lowercase -d is safe
git reset --soft HEAD~1          # soft reset is safe
git restore --staged .           # unstaging is safe
git stash
git stash pop
```

</details>

## Performance

Near-zero latency impact on your workflow:

| Platform    | Latency per tool call | Notes                                    |
| ----------- | --------------------- | ---------------------------------------- |
| OpenCode    | **~20µs**             | In-process plugin, near-zero overhead    |
| Pi          | **~20µs**             | In-process hook, near-zero overhead      |
| Claude Code | **~31ms**             | External process (~30ms Node.js startup) |
| Factory     | **~31ms**             | External process (~30ms Node.js startup) |

For context: LLM API calls typically take 2-10+ seconds. Even the slower external process hook adds less than 0.3% to total response time.

## Limitations

Leash is a **defense-in-depth** layer, not a complete sandbox. It cannot protect against:

- Kernel exploits or privilege escalation
- Network-based attacks (downloading and executing scripts)
- Commands not routed through the intercepted tools

For maximum security, combine Leash with container isolation (Docker), user permission restrictions, or read-only filesystem mounts.

## Development

```bash
cd ~/leash
npm install
npm run build
```

## Contributing

Contributions are welcome! Areas where help is needed:

- [ ] Plugin for AMP Code

---

_Keep your AI agents on a leash._
