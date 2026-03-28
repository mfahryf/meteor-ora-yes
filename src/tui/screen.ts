// src/tui/screen.ts
// Pure render target — owns NO input events. TuiApp calls draw methods.

import { terminal as term } from "terminal-kit";

export interface AgentState {
  status: "RUNNING" | "PAUSED";
  solBalance: number;
  positions: number;
  maxPositions: number;
  jobs: number;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Layout (bottom-up, 1-indexed):
 *
 *   row H        │ status bar
 *   row H-1      │ ── separator
 *   row H-2      │ ❯ input prompt
 *   row H-3      │ ── separator
 *   row H-4      │ spinner / idle (cleared when not processing)
 *   row H-5      │ ── separator
 *   row 1..H-6   │ log area
 */
export class Screen {
  private lines: string[] = [];
  private maxVisible = 0;
  private scrollOffset = 0;

  // Row positions (set in layout)
  private statusRow = 0;
  private inputRow = 0;
  private spinnerRow = 0;
  private logStart = 1;

  private spinnerIdx = 0;
  private lastState: AgentState | null = null;
  private _processing = false;

  get processing(): boolean { return this._processing; }
  set processing(v: boolean) { this._processing = v; }

  /** Recalculate layout. Call on start and resize. */
  layout(): void {
    const H = term.height;
    this.statusRow  = H;
    this.inputRow   = H - 2;
    this.spinnerRow = H - 4;
    this.logStart   = 1;
    // log area = rows 1 through H-6 (inclusive), which is H-6 rows
    this.maxVisible = Math.max(0, H - 6);
  }

  /** Full redraw. */
  redraw(): void {
    this.drawSeparators();
    if (this.lastState) this.drawStatusBar(this.lastState);
    this.drawLog();
    this.drawInputPrompt();
  }

  // ── Draw helpers (all save/restore cursor) ──

  private drawSeparators(): void {
    const H = term.height;
    const w = term.width;
    const sep = "─".repeat(w);

    term.saveCursor();
    term.styleReset();
    term.dim();

    // Row H-5: above spinner
    term.moveTo(1, H - 5);
    term.eraseLine();
    term(sep);

    // Row H-3: above input (between spinner and input)
    term.moveTo(1, H - 3);
    term.eraseLine();
    term(sep);

    // Row H-1: below input (between input and status)
    term.moveTo(1, H - 1);
    term.eraseLine();
    term(sep);

    term.styleReset();
    term.restoreCursor();
  }

  drawStatusBar(state: AgentState): void {
    this.lastState = state;
    const H = term.height;

    term.saveCursor();
    term.moveTo(1, H);
    term.styleReset();
    term.eraseLine();

    const sc = state.status === "RUNNING" ? "\x1b[32m" : "\x1b[33m";
    const left = `\x1b[31m►►\x1b[0m \x1b[35mDLMM Agent\x1b[0m \x1b[2m(${sc}${state.status}\x1b[0m\x1b[2m)\x1b[0m`;
    const right = `\x1b[33mSOL: ${state.solBalance.toFixed(4)} | Pos: ${state.positions}/${state.maxPositions} | Jobs: ${state.jobs}\x1b[0m`;

    const leftLen = left.replace(/\x1b\[[0-9;]*m/g, "").length;
    const rightLen = right.replace(/\x1b\[[0-9;]*m/g, "").length;
    const pad = Math.max(1, term.width - leftLen - rightLen - 2);
    term(left + " ".repeat(pad) + right);
    term.restoreCursor();
  }

  drawSpinner(): void {
    const H = term.height;
    // spinnerRow = H - 4
    const row = H - 4;

    term.saveCursor();
    term.moveTo(1, row);
    term.eraseLine();

    if (this._processing) {
      const frame = SPINNER_FRAMES[this.spinnerIdx];
      term(`\x1b[2m${frame} Thinking...\x1b[0m`);
      this.spinnerIdx = (this.spinnerIdx + 1) % SPINNER_FRAMES.length;
    }
    // else: already erased → blank

    term.restoreCursor();
  }

  private drawLog(): void {
    if (this.maxVisible <= 0) return;
    const H = term.height;
    // Log area = rows 1 through H-6
    const logEnd = H - 6;

    term.saveCursor();

    const endIdx = Math.max(0, this.lines.length - this.scrollOffset);
    const startIdx = Math.max(0, endIdx - this.maxVisible);
    const visible = this.lines.slice(startIdx, endIdx);

    for (let i = 0; i < this.maxVisible; i++) {
      const y = 1 + i;
      term.moveTo(1, y);
      term.eraseLine();
      if (i < visible.length) {
        term(visible[i]);
      }
    }

    term.restoreCursor();
  }

  drawInputPrompt(): void {
    const H = term.height;
    // inputRow = H - 2
    term.saveCursor();
    term.moveTo(1, H - 2);
    term.eraseLine();
    term.bold("❯ ");
    term.styleReset();
    term.restoreCursor();
  }

  // ── Public mutations ──

  appendLine(text: string): void {
    this.lines.push(text);
    if (this.lines.length > 5000) this.lines = this.lines.slice(-3000);
    if (this.scrollOffset === 0) {
      this.drawLog();
    } else {
      this.scrollOffset++;
    }
  }

  showOutput(text: string): void {
    for (const line of text.split("\n")) {
      this.lines.push(line);
    }
    this.lines.push("");
    this.scrollOffset = 0;
    this.drawLog();
  }

  clearLog(): void {
    this.lines = [];
    this.scrollOffset = 0;
    this.drawLog();
  }

  scrollUp(amount: number): void {
    this.scrollOffset = Math.min(this.scrollOffset + amount, this.lines.length);
    this.drawLog();
  }

  scrollDown(amount: number): void {
    this.scrollOffset = Math.max(this.scrollOffset - amount, 0);
    this.drawLog();
  }

  get inputRowY(): number {
    return this.inputRow;
  }
}
