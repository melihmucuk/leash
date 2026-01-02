import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";
import { CommandAnalyzer, checkForUpdates } from "../core/index.js";

export default function (pi: HookAPI) {
  let analyzer: CommandAnalyzer | null = null;

  pi.on("session_start", async (_event, ctx) => {
    analyzer = new CommandAnalyzer(ctx.cwd);
    ctx.ui.notify("🔒 Leash active", "info");

    const update = await checkForUpdates();
    if (update.hasUpdate) {
      ctx.ui.notify(
        `🔄 Leash ${update.latestVersion} available. Run: leash --update (restart required)`,
        "warning"
      );
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    // Fallback if session event was missed
    if (!analyzer) {
      analyzer = new CommandAnalyzer(ctx.cwd);
    }

    // Shell command execution
    if (event.toolName === "bash") {
      const command = (event.input.command as string) || "";
      const result = analyzer.analyze(command);

      if (result.blocked) {
        if (ctx.hasUI) {
          ctx.ui.notify(`🚫 Command blocked: ${result.reason}`, "warning");
        }
        return {
          block: true,
          reason:
            `Command blocked: ${command}\n` +
            `Reason: ${result.reason}\n` +
            `Working directory: ${ctx.cwd}\n` +
            `Action: Guide the user to run the command manually.`,
        };
      }
    }

    // File write/edit operations
    if (event.toolName === "write" || event.toolName === "edit") {
      const path = (event.input.path as string) || "";
      const result = analyzer.validatePath(path);

      if (result.blocked) {
        if (ctx.hasUI) {
          ctx.ui.notify(`🚫 File operation blocked: ${result.reason}`, "warning");
        }
        return {
          block: true,
          reason:
            `File operation blocked: ${path}\n` +
            `Reason: ${result.reason}\n` +
            `Working directory: ${ctx.cwd}\n` +
            `Action: Guide the user to perform this operation manually.`,
        };
      }
    }

    return undefined;
  });
}
