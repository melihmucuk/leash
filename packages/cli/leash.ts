import { existsSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { PLATFORMS, setupPlatform, removePlatform } from "./lib.js";
import { checkForUpdates } from "../core/version-checker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getDistPath(): string {
  // Bundle is at dist/cli/leash.js, so dist/ is one level up
  return join(__dirname, "..");
}

function getConfigPath(platformKey: string): string | null {
  const platform = PLATFORMS[platformKey];
  if (!platform) return null;

  if (platform.configPaths) {
    for (const p of platform.configPaths) {
      const full = join(homedir(), p);
      if (existsSync(full)) return full;
    }
    return join(homedir(), platform.configPaths.at(-1)!);
  }

  return join(homedir(), platform.configPath!);
}

function getLeashPath(platformKey: string): string | null {
  const platform = PLATFORMS[platformKey];
  return platform ? join(getDistPath(), platform.distPath) : null;
}

function setup(platformKey: string): void {
  const configPath = getConfigPath(platformKey);
  const leashPath = getLeashPath(platformKey);

  if (!configPath || !leashPath) {
    console.error(`Unknown platform: ${platformKey}`);
    console.error(`Available: ${Object.keys(PLATFORMS).join(", ")}`);
    process.exit(1);
  }

  if (!existsSync(leashPath)) {
    console.error(`Leash not found at: ${leashPath}`);
    process.exit(1);
  }

  const result = setupPlatform(platformKey, configPath, leashPath);

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.skipped) {
    console.log(`[ok] Leash already installed for ${result.platform}`);
    return;
  }

  console.log(`[ok] Config: ${result.configPath}`);
  console.log(`[ok] Leash installed for ${result.platform}`);
  console.log(`[ok] Restart ${result.platform} to apply changes`);
}

function remove(platformKey: string): void {
  const configPath = getConfigPath(platformKey);

  if (!configPath) {
    console.error(`Unknown platform: ${platformKey}`);
    console.error(`Available: ${Object.keys(PLATFORMS).join(", ")}`);
    process.exit(1);
  }

  const result = removePlatform(platformKey, configPath);

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.notFound) {
    console.log(`[ok] No config found for ${result.platform}`);
    return;
  }

  if (result.notInstalled) {
    console.log(`[ok] Leash not found in ${result.platform} config`);
    return;
  }

  console.log(`[ok] Leash removed from ${result.platform}`);
  console.log(`[ok] Restart ${result.platform} to apply changes`);
}

function showPath(platformKey: string): void {
  const leashPath = getLeashPath(platformKey);

  if (!leashPath) {
    console.error(`Unknown platform: ${platformKey}`);
    console.error(`Available: ${Object.keys(PLATFORMS).join(", ")}`);
    process.exit(1);
  }

  console.log(leashPath);
}

async function update(): Promise<void> {
  console.log("Checking for updates...");

  const result = await checkForUpdates();

  if (!result.hasUpdate) {
    console.log(`[ok] Already up to date (v${result.currentVersion})`);
    return;
  }

  console.log(`[ok] Update available: v${result.currentVersion} → v${result.latestVersion}`);
  console.log("[ok] Updating...");

  try {
    execSync("npm update -g @melihmucuk/leash", { stdio: "inherit" });
    console.log("[ok] Update complete");
  } catch {
    console.error("[error] Update failed. Try manually: npm update -g @melihmucuk/leash");
    process.exit(1);
  }
}

function showHelp(): void {
  console.log(`
leash - Security guardrails for AI coding agents

Usage:
  leash --setup <platform>    Install leash for a platform
  leash --remove <platform>   Remove leash from a platform
  leash --path <platform>     Show leash path for a platform
  leash --update              Update leash to latest version
  leash --help                Show this help

Platforms:
  opencode      OpenCode
  pi            Pi Coding Agent
  claude-code   Claude Code
  factory       Factory Droid

Examples:
  leash --setup opencode
  leash --remove claude-code
  leash --path pi
  leash --update
`);
}

const args = process.argv.slice(2);
const command = args[0];
const platform = args[1];

switch (command) {
  case "--setup":
  case "-s":
    if (!platform) {
      console.error("Missing platform argument");
      showHelp();
      process.exit(1);
    }
    setup(platform);
    break;
  case "--remove":
  case "-r":
    if (!platform) {
      console.error("Missing platform argument");
      showHelp();
      process.exit(1);
    }
    remove(platform);
    break;
  case "--path":
  case "-p":
    if (!platform) {
      console.error("Missing platform argument");
      showHelp();
      process.exit(1);
    }
    showPath(platform);
    break;
  case "--update":
  case "-u":
    await update();
    break;
  case "--help":
  case "-h":
  case undefined:
    showHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
}
