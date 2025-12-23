import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";

export const PLATFORMS = {
  opencode: {
    name: "OpenCode",
    configPaths: [
      ".config/opencode/opencode.jsonc",
      ".config/opencode/opencode.json",
    ],
    distPath: "opencode/leash.js",
    setup: (config, leashPath) => {
      config.plugins = config.plugins || [];
      if (config.plugins.some((p) => p.includes("leash"))) {
        return { skipped: true };
      }
      config.plugins.push(leashPath);
      return { skipped: false };
    },
    remove: (config) => {
      if (!config.plugins) return false;
      const before = config.plugins.length;
      config.plugins = config.plugins.filter((p) => !p.includes("leash"));
      return config.plugins.length < before;
    },
  },
  pi: {
    name: "Pi",
    configPath: ".pi/agent/settings.json",
    distPath: "pi/leash.js",
    setup: (config, leashPath) => {
      config.hooks = config.hooks || [];
      if (config.hooks.some((h) => h.includes("leash"))) {
        return { skipped: true };
      }
      config.hooks.push(leashPath);
      return { skipped: false };
    },
    remove: (config) => {
      if (!config.hooks) return false;
      const before = config.hooks.length;
      config.hooks = config.hooks.filter((h) => !h.includes("leash"));
      return config.hooks.length < before;
    },
  },
  "claude-code": {
    name: "Claude Code",
    configPath: ".claude/settings.json",
    distPath: "claude-code/leash.js",
    setup: (config, leashPath) => {
      config.hooks = config.hooks || {};
      config.hooks.PreToolUse = config.hooks.PreToolUse || [];
      const exists = config.hooks.PreToolUse.some((entry) =>
        entry.hooks?.some((h) => h.command?.includes("leash"))
      );
      if (exists) {
        return { skipped: true };
      }
      config.hooks.PreToolUse.push({
        matcher: "Bash|Write|Edit",
        hooks: [{ type: "command", command: `node ${leashPath}` }],
      });
      return { skipped: false };
    },
    remove: (config) => {
      if (!config.hooks?.PreToolUse) return false;
      const before = config.hooks.PreToolUse.length;
      config.hooks.PreToolUse = config.hooks.PreToolUse.filter(
        (entry) => !entry.hooks?.some((h) => h.command?.includes("leash"))
      );
      return config.hooks.PreToolUse.length < before;
    },
  },
  factory: {
    name: "Factory",
    configPath: ".factory/settings.json",
    distPath: "factory/leash.js",
    setup: (config, leashPath) => {
      config.hooks = config.hooks || {};
      config.hooks.PreToolUse = config.hooks.PreToolUse || [];
      const exists = config.hooks.PreToolUse.some((entry) =>
        entry.hooks?.some((h) => h.command?.includes("leash"))
      );
      if (exists) {
        return { skipped: true };
      }
      config.hooks.PreToolUse.push({
        matcher: "Execute|Write|Edit",
        hooks: [{ type: "command", command: `node ${leashPath}` }],
      });
      return { skipped: false };
    },
    remove: (config) => {
      if (!config.hooks?.PreToolUse) return false;
      const before = config.hooks.PreToolUse.length;
      config.hooks.PreToolUse = config.hooks.PreToolUse.filter(
        (entry) => !entry.hooks?.some((h) => h.command?.includes("leash"))
      );
      return config.hooks.PreToolUse.length < before;
    },
  },
};

export function readConfig(configPath) {
  if (!existsSync(configPath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

export function writeConfig(configPath, config) {
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

export function setupPlatform(platformKey, configPath, leashPath) {
  const platform = PLATFORMS[platformKey];
  if (!platform) {
    return { error: `Unknown platform: ${platformKey}` };
  }

  const config = readConfig(configPath);
  const result = platform.setup(config, leashPath);

  if (result.skipped) {
    return { skipped: true, platform: platform.name };
  }

  writeConfig(configPath, config);
  return { success: true, platform: platform.name, configPath };
}

export function removePlatform(platformKey, configPath) {
  const platform = PLATFORMS[platformKey];
  if (!platform) {
    return { error: `Unknown platform: ${platformKey}` };
  }

  if (!existsSync(configPath)) {
    return { notFound: true, platform: platform.name };
  }

  const config = readConfig(configPath);
  const removed = platform.remove(config);

  if (!removed) {
    return { notInstalled: true, platform: platform.name };
  }

  writeConfig(configPath, config);
  return { success: true, platform: platform.name };
}
