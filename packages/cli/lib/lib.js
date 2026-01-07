import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import * as jsonc from "jsonc-parser";
const PLATFORMS = {
  opencode: {
    name: "OpenCode",
    configPaths: [
      ".config/opencode/opencode.jsonc",
      ".config/opencode/opencode.json"
    ],
    distPath: "opencode/leash.js",
    remove: (config) => {
      if (!config.plugin) return false;
      const before = config.plugin.length;
      config.plugin = config.plugin.filter((p) => !p.includes("leash"));
      return config.plugin.length < before;
    }
  },
  pi: {
    name: "Pi",
    configPath: ".pi/agent/settings.json",
    distPath: "pi/leash.js",
    setup: (config, leashPath) => {
      config.extensions = config.extensions || [];
      if (config.extensions.some((e) => e.includes("leash"))) {
        return { skipped: true };
      }
      config.extensions.push(leashPath);
      return { skipped: false };
    },
    remove: (config) => {
      if (!config.extensions) return false;
      const before = config.extensions.length;
      config.extensions = config.extensions.filter((e) => !e.includes("leash"));
      return config.extensions.length < before;
    }
  },
  "claude-code": {
    name: "Claude Code",
    configPath: ".claude/settings.json",
    distPath: "claude-code/leash.js",
    setup: (config, leashPath) => {
      config.hooks = config.hooks || {};
      const hookCommand = { type: "command", command: `node ${leashPath}` };
      const inSessionStart = config.hooks.SessionStart?.some(
        (entry) => entry.hooks?.some((h) => h.command?.includes("leash"))
      );
      const inPreToolUse = config.hooks.PreToolUse?.some(
        (entry) => entry.hooks?.some((h) => h.command?.includes("leash"))
      );
      if (inSessionStart && inPreToolUse) {
        return { skipped: true };
      }
      if (!inSessionStart) {
        config.hooks.SessionStart = config.hooks.SessionStart || [];
        config.hooks.SessionStart.push({ hooks: [hookCommand] });
      }
      if (!inPreToolUse) {
        config.hooks.PreToolUse = config.hooks.PreToolUse || [];
        config.hooks.PreToolUse.push({
          matcher: "Bash|Write|Edit",
          hooks: [hookCommand]
        });
      }
      return { skipped: false };
    },
    remove: (config) => {
      if (!config.hooks) return false;
      let removed = false;
      if (config.hooks.SessionStart) {
        const before = config.hooks.SessionStart.length;
        config.hooks.SessionStart = config.hooks.SessionStart.filter(
          (entry) => !entry.hooks?.some((h) => h.command?.includes("leash"))
        );
        if (config.hooks.SessionStart.length < before) removed = true;
      }
      if (config.hooks.PreToolUse) {
        const before = config.hooks.PreToolUse.length;
        config.hooks.PreToolUse = config.hooks.PreToolUse.filter(
          (entry) => !entry.hooks?.some((h) => h.command?.includes("leash"))
        );
        if (config.hooks.PreToolUse.length < before) removed = true;
      }
      return removed;
    }
  },
  factory: {
    name: "Factory",
    configPath: ".factory/settings.json",
    distPath: "factory/leash.js",
    setup: (config, leashPath) => {
      config.hooks = config.hooks || {};
      const hookCommand = { type: "command", command: `node ${leashPath}` };
      const inSessionStart = config.hooks.SessionStart?.some(
        (entry) => entry.hooks?.some((h) => h.command?.includes("leash"))
      );
      const inPreToolUse = config.hooks.PreToolUse?.some(
        (entry) => entry.hooks?.some((h) => h.command?.includes("leash"))
      );
      if (inSessionStart && inPreToolUse) {
        return { skipped: true };
      }
      if (!inSessionStart) {
        config.hooks.SessionStart = config.hooks.SessionStart || [];
        config.hooks.SessionStart.push({ hooks: [hookCommand] });
      }
      if (!inPreToolUse) {
        config.hooks.PreToolUse = config.hooks.PreToolUse || [];
        config.hooks.PreToolUse.push({
          matcher: "Execute|Write|Edit",
          hooks: [hookCommand]
        });
      }
      return { skipped: false };
    },
    remove: (config) => {
      if (!config.hooks) return false;
      let removed = false;
      if (config.hooks.SessionStart) {
        const before = config.hooks.SessionStart.length;
        config.hooks.SessionStart = config.hooks.SessionStart.filter(
          (entry) => !entry.hooks?.some((h) => h.command?.includes("leash"))
        );
        if (config.hooks.SessionStart.length < before) removed = true;
      }
      if (config.hooks.PreToolUse) {
        const before = config.hooks.PreToolUse.length;
        config.hooks.PreToolUse = config.hooks.PreToolUse.filter(
          (entry) => !entry.hooks?.some((h) => h.command?.includes("leash"))
        );
        if (config.hooks.PreToolUse.length < before) removed = true;
      }
      return removed;
    }
  }
};
function readConfig(configPath) {
  if (!existsSync(configPath)) {
    return {};
  }
  const content = readFileSync(configPath, "utf-8");
  const errors = [];
  const config = jsonc.parse(content, errors);
  if (errors.length > 0) {
    throw new Error(`Invalid JSON/JSONC in ${configPath}`);
  }
  return config;
}
function writeConfig(configPath, config) {
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}
function setupOpenCode(configPath, leashPath) {
  const formatOptions = { tabSize: 2, insertSpaces: true };
  let content = "";
  let config = {};
  if (existsSync(configPath)) {
    content = readFileSync(configPath, "utf-8");
    const errors = [];
    config = jsonc.parse(content, errors);
    if (errors.length > 0) {
      return { error: `Invalid JSON/JSONC in ${configPath}` };
    }
  }
  if (config.plugin?.some((p) => p.includes("leash"))) {
    return { skipped: true, platform: "OpenCode" };
  }
  let edits;
  if (!config.plugin) {
    edits = jsonc.modify(content, ["plugin"], [leashPath], { formattingOptions: formatOptions });
  } else {
    edits = jsonc.modify(content, ["plugin", -1], leashPath, { formattingOptions: formatOptions });
  }
  const newContent = jsonc.applyEdits(content, edits);
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, newContent);
  return { success: true, platform: "OpenCode", configPath };
}
function removeOpenCode(configPath) {
  if (!existsSync(configPath)) {
    return { notFound: true, platform: "OpenCode" };
  }
  const content = readFileSync(configPath, "utf-8");
  const errors = [];
  const config = jsonc.parse(content, errors);
  if (errors.length > 0) {
    return { error: `Invalid JSON/JSONC in ${configPath}` };
  }
  if (!config.plugin) {
    return { notInstalled: true, platform: "OpenCode" };
  }
  const leashIndex = config.plugin.findIndex((p) => p.includes("leash"));
  if (leashIndex === -1) {
    return { notInstalled: true, platform: "OpenCode" };
  }
  const formatOptions = { tabSize: 2, insertSpaces: true };
  const edits = jsonc.modify(content, ["plugin", leashIndex], void 0, { formattingOptions: formatOptions });
  const newContent = jsonc.applyEdits(content, edits);
  writeFileSync(configPath, newContent);
  return { success: true, platform: "OpenCode" };
}
function setupPlatform(platformKey, configPath, leashPath) {
  const platform = PLATFORMS[platformKey];
  if (!platform) {
    return { error: `Unknown platform: ${platformKey}` };
  }
  if (platformKey === "opencode") {
    return setupOpenCode(configPath, leashPath);
  }
  const config = readConfig(configPath);
  const result = platform.setup(config, leashPath);
  if (result.skipped) {
    return { skipped: true, platform: platform.name };
  }
  writeConfig(configPath, config);
  return { success: true, platform: platform.name, configPath };
}
function removePlatform(platformKey, configPath) {
  const platform = PLATFORMS[platformKey];
  if (!platform) {
    return { error: `Unknown platform: ${platformKey}` };
  }
  if (platformKey === "opencode") {
    return removeOpenCode(configPath);
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
export {
  PLATFORMS,
  readConfig,
  removePlatform,
  setupPlatform,
  writeConfig
};
