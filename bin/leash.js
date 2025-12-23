#!/usr/bin/env node

import { existsSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { PLATFORMS, setupPlatform, removePlatform } from "./lib.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getDistPath() {
  return join(__dirname, "..", "dist");
}

function getConfigPath(platformKey) {
  const platform = PLATFORMS[platformKey];
  return platform ? join(homedir(), platform.configPath) : null;
}

function getLeashPath(platformKey) {
  const platform = PLATFORMS[platformKey];
  return platform ? join(getDistPath(), platform.distPath) : null;
}

function setup(platformKey) {
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

function remove(platformKey) {
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

function showPath(platformKey) {
  const leashPath = getLeashPath(platformKey);

  if (!leashPath) {
    console.error(`Unknown platform: ${platformKey}`);
    console.error(`Available: ${Object.keys(PLATFORMS).join(", ")}`);
    process.exit(1);
  }

  console.log(leashPath);
}

function showHelp() {
  console.log(`
leash - Security guardrails for AI coding agents

Usage:
  leash --setup <platform>    Install leash for a platform
  leash --remove <platform>   Remove leash from a platform
  leash --path <platform>     Show leash path for a platform
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
