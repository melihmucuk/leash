# AGENTS.md

Security guardrails plugin for AI coding agents. Prevents accidental file operations outside working directory and protects sensitive files (`.env`, `.git`) even inside project.

## Architecture

```
packages/
  core/           # Constants, PathValidator, CommandAnalyzer, tests
  opencode/       # OpenCode plugin
  pi/             # Pi coding agent hook
  claude-code/    # Claude Code hook
  factory/        # Factory Droid hook
dist/             # Compiled output (committed)
```

## Core Concepts

- **Threat model**: Agent hallucination, NOT external attacks
- **Protection**: Block dangerous commands + file ops outside working dir + protect sensitive files
- **Scope**: Shell execution + file write/edit operations

## Rules

- Keep it simple; no overengineering for unlikely attack vectors
- Focus on common hallucination patterns: wrong paths, wrong directories
- Quote-aware parsing for `rm "file with spaces"`
- Always resolve symlinks to prevent escape
- Code should be self-documenting; comment only to explain "why"

## Testing

See `packages/core/test/` for scenarios. Categories:

- **BLOCK**: outside working dir, dangerous git, protected files (.env, .git)
- **ALLOW**: working dir, temp paths (/tmp), safe git, .env.example, platform config dirs

## Development

1. `npm test` — builds core + runs tests
2. `npm run build` — builds all platforms (dist/ committed)

---

## Platform: OpenCode

**Location**: `packages/opencode/leash.ts`

**Install**:

```bash
leash --setup opencode
```

Or manually add to `~/.config/opencode/opencode.json` (or `opencode.jsonc`):

```json
{
  "plugin": ["<path from leash --path opencode>"]
}
```

**Docs** (read when needed):

- Tools: https://opencode.ai/docs/tools/
- Plugins: https://opencode.ai/docs/plugins/
- SDK: https://opencode.ai/docs/sdk/

**Hook**: `tool.execute.before`

**Tools to guard**:

| Tool    | Argument              |
| ------- | --------------------- |
| `bash`  | `output.args.command` |
| `write` | `output.args.path`    |
| `edit`  | `output.args.path`    |
| `patch` | `output.args.path`    |

---

## Platform: Pi Coding Agent

**Location**: `packages/pi/leash.ts`

**Install**:

```bash
leash --setup pi
```

Or manually add to `~/.pi/agent/settings.json`:

```json
{
  "hooks": ["<path from leash --path pi>"]
}
```

**Docs**: https://shittycodingagent.ai

**Hook**: `tool_call` event

**Tools to guard**:

| Tool    | Argument              |
| ------- | --------------------- |
| `bash`  | `event.input.command` |
| `write` | `event.input.path`    |
| `edit`  | `event.input.path`    |

---

## Platform: Claude Code

**Location**: `packages/claude-code/leash.ts`

**Install**:

```bash
leash --setup claude-code
```

Or manually add to `~/.claude/settings.json`:

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

**Docs**:

- Hooks Guide: https://code.claude.com/docs/en/hooks-guide
- Hooks Reference: https://code.claude.com/docs/en/hooks

**Hooks**:

- `SessionStart`: Shows activation message + checks for updates
- `PreToolUse`: Blocks dangerous commands/file operations (exit code 2 + stderr)

**Tools to guard**:

| Tool    | Argument               |
| ------- | ---------------------- |
| `Bash`  | `tool_input.command`   |
| `Write` | `tool_input.file_path` |
| `Edit`  | `tool_input.file_path` |

---

## Platform: Factory Droid

**Location**: `packages/factory/leash.ts`

**Install**:

```bash
leash --setup factory
```

Or manually add to `~/.factory/settings.json`:

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

**Docs**:

- Hooks Guide: https://docs.factory.ai/cli/configuration/hooks-guide
- Hooks Reference: https://docs.factory.ai/reference/hooks-reference

**Hooks**:

- `SessionStart`: Shows activation message + checks for updates
- `PreToolUse`: Blocks dangerous commands/file operations (exit code 2 + stderr)

**Env**: `FACTORY_PROJECT_DIR` - working directory

**Tools to guard**:

| Tool      | Argument               |
| --------- | ---------------------- |
| `Execute` | `tool_input.command`   |
| `Write`   | `tool_input.file_path` |
| `Edit`    | `tool_input.file_path` |
