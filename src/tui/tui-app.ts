// src/tui/tui-app.ts
// Single owner of terminal input + rendering orchestration.

import { terminal as term } from "terminal-kit";
import { Screen, type AgentState } from "./screen";
import { LogRingBuffer } from "./log-capture";
import { dispatchCommand, type CommandContext } from "../core/commands";
import { handleChatMessage } from "../telegram/chat";
import { agentIsPaused } from "../core/lifecycle";
import { listJobs } from "../core/scheduler";
import { getOpenPositions } from "../memory/positions";
import type { Config } from "../config/schema";

export class TuiApp {
  private screen = new Screen();
  private config!: Config;
  private walletSolBalance = 0;
  private walletTokenBalances: Record<string, number> = {};
  private running = false;
  private statusInterval: ReturnType<typeof setInterval> | null = null;
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private history: string[] = [];
  private ringBuffer!: LogRingBuffer;
  private inputActive = false;

  updateWallet(sol: number, tokens: Record<string, number>): void {
    this.walletSolBalance = sol;
    this.walletTokenBalances = tokens;
  }

  async start(config: Config, ringBuffer: LogRingBuffer): Promise<void> {
    this.config = config;
    this.ringBuffer = ringBuffer;

    // ── Terminal setup ──
    term.fullscreen(true);
    term.grabInput({ mouse: "button" });
    this.screen.layout();
    this.screen.redraw();
    this.running = true;

    // ── Replay boot errors/warnings into log ──
    for (const entry of ringBuffer.getEntries()) {
      if (entry.text.includes("WARN") || entry.text.includes("ERROR")) {
        this.screen.appendLine(entry.text);
      }
    }

    // ── Global key handler ──
    term.on("key", (key: string) => {
      // CTRL_C is NOT in inputField's default keybindings — always safe
      if (key === "CTRL_C" || key === "CTRL_D") {
        this.shutdown();
        return;
      }
      if (this.inputActive) return;
      if (key === "CTRL_P") {
        this.dispatch(agentIsPaused() ? "/resume" : "/pause");
      } else if (key === "CTRL_L") {
        this.screen.clearLog();
      } else if (key === "PAGE_UP") {
        this.screen.scrollUp(10);
      } else if (key === "PAGE_DOWN") {
        this.screen.scrollDown(10);
      }
    });

    // Mouse doesn't conflict with inputField
    term.on("mouse", (name: string) => {
      if (name === "MOUSE_WHEEL_UP") this.screen.scrollUp(5);
      else if (name === "MOUSE_WHEEL_DOWN") this.screen.scrollDown(5);
    });

    // Resize
    term.on("resize", () => {
      if (this.inputActive) return;
      this.screen.layout();
      this.screen.redraw();
    });

    // ── Spinner tick (80ms) — skips during input ──
    this.spinnerInterval = setInterval(() => {
      if (this.inputActive) return;
      this.screen.drawSpinner();
    }, 80);

    // ── Periodic status refresh ──
    this.statusInterval = setInterval(() => {
      if (!this.inputActive) this.refreshStatus();
    }, 30_000);
    this.refreshStatus();

    // ── Main input loop ──
    while (this.running) {
      try {
        const text = await this.promptInput();
        if (!this.running) break;
        if (text.trim() === "") continue;
        await this.dispatch(text);
        this.refreshStatus();
      } catch {
        if (!this.running) break;
      }
    }
  }

  // ── Input ──

  private promptInput(): Promise<string> {
    return new Promise((resolve) => {
      this.inputActive = true;
      const y = this.screen.inputRowY;

      // Draw prompt directly — no saveCursor/restoreCursor (inputField owns cursor)
      term.moveTo(1, y);
      term.eraseLine();
      term.bold("❯ ");
      term.styleReset();

      term.inputField(
        {
          history: this.history,
          autoCompleteMenu: false,
          x: 3,
          y,
        },
        (error: any, input: string | undefined) => {
          this.inputActive = false;
          if (error || !input) {
            resolve("");
            return;
          }
          const text = input.trim();
          if (text) {
            this.history.push(text);
            if (this.history.length > 50) this.history = this.history.slice(-50);
          }
          resolve(text);
        },
      );
    });
  }

  // ── Command / chat dispatch ──

  private async dispatch(text: string): Promise<void> {
    // Echo the user's command to log
    this.screen.showOutput(`\x1b[36m❯\x1b[0m ${text}`);
    this.screen.processing = true;

    if (text.startsWith("/")) {
      const parts = text.slice(1).split(/\s+/);
      const cmdName = parts[0].toLowerCase();
      const args = parts.slice(1);
      const ctx: CommandContext = {
        config: this.config,
        walletSolBalance: this.walletSolBalance,
        walletTokenBalances: this.walletTokenBalances,
        sessionId: "tui",
      };

      try {
        const result = await dispatchCommand(cmdName, ctx, args);
        if (result.text === "__QUIT__") {
          this.shutdown();
          return;
        }
        this.screen.showOutput(
          result.text.split("\n").map((l) => `  ${l}`).join("\n") + "\n",
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.screen.showOutput(`  \x1b[31mError:\x1b[0m ${msg}\n`);
      }
    } else {
      try {
        const response = await handleChatMessage(
          "tui", text, this.config,
          this.walletSolBalance, this.walletTokenBalances,
        );
        this.screen.showOutput(
          response.split("\n").map((l) => `  ${l}`).join("\n") + "\n",
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.screen.showOutput(`  \x1b[31mError:\x1b[0m ${msg}\n`);
      }
    }

    this.screen.processing = false;
  }

  // ── Status ──

  private refreshStatus(): void {
    try {
      const state: AgentState = {
        status: agentIsPaused() ? "PAUSED" : "RUNNING",
        solBalance: this.walletSolBalance,
        positions: getOpenPositions().length,
        maxPositions: this.config?.risk?.maxPositions || 5,
        jobs: listJobs().length,
      };
      this.screen.drawStatusBar(state);
    } catch {
      // DB may not be ready yet
    }
  }

  // ── Shutdown ──

  shutdown(): void {
    if (!this.running) return;
    this.running = false;
    if (this.spinnerInterval) { clearInterval(this.spinnerInterval); this.spinnerInterval = null; }
    if (this.statusInterval) { clearInterval(this.statusInterval); this.statusInterval = null; }
    term.styleReset();
    term.showCursor();
    term.grabInput(false);
    term.fullscreen(false);
    term.processExit(0);
  }
}
