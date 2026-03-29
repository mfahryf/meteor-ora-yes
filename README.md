# ☄️ Meteor-ora-yes 

**Autonomous DLMM Liquidity Management Agent**  
*A high-performance algorithmic trading agent, purpose-built for Meteora DLMM (Concentrated Liquidity) on Solana.*

![Meteor-ora-yes](https://img.shields.io/badge/Status-Simulation_Ready-green) ![Platform](https://img.shields.io/badge/Platform-Solana%20%7C%20Meteora-blue) ![Runtime](https://img.shields.io/badge/Runtime-Bun-black)

---

## 🎯 Overview

**Meteor-ora-yes** is an autonomous trading agent that continuously scans DexScreener and Meteora for high-yield DLMM pools, evaluates them using a multi-agent AI debate system, and dynamically manages shadow/live liquidity positions to maximize accumulated fees while minimizing impermanent loss.

This repository features an independently designed trading architecture, supercharged with a highly visual CLI Simulator and Telegram integration.

## ✨ Key Features & Enhancements

- **🧠 Multi-Agent Bull/Bear Debate:** Before deploying capital, the system runs a 3-step LLM debate (Bull vs. Bear) judged by an AI Arbiter to filter out manipulated or unsafe pools.
- **📈 Advanced Shadow Simulator:** Run risk-free, infinite loop simulations (`--cycles 0`) using real-world market data to test your config. Features real-time ASCII UI visualizers for price ranges and accurate PnL vs. Fee calculations.
- **📱 Telegram Live Broadcast & Control:** Let the simulator or live agent run on a VPS, while you receive real-time updates straight to your phone. Includes commands like `/sim`, `/pnl`, `/pause`, and `/resume`.
- **🛡️ Dynamic Risk Guardrails:** Fully automated lifecycle management with hard-close rules for Out-of-Range timeouts, Stop-Loss hits, Take-Profit targets, and Max Hold Duration limits.
- **⚡ Pre-Loaded Pre-Screening:** Optimizes LLM token usage by pre-fetching the Top 5 candidates algorithmically before hitting the AI brain.

---

## 🚀 Quick Start

### 1. Requirements
Ensure you have [Bun](https://bun.sh/) installed.

### 2. Setup
Clone the repository and install dependencies:
```bash
git clone <repository_url>
cd meteor-ora-yes
bun install
```

Copy the `.env` template and fill in your keys:
```bash
cp .env.example .env
```
*(Make sure to add your `TELEGRAM_BOT_TOKEN`, `LLM_API_KEY`, and `TELEGRAM_CHAT_ID` if you want remote notifications).*

### 3. Run the Shadow Simulator (Recommended)
Simulate trading with 1.0 Virtual SOL, evaluating pools every 5 minutes in an infinite loop:
```bash
bun run src/simulation/run-simulation.ts --cycles 0 --interval 5 --balance 1.0
```
> **Tip:** Add `--reset` at the end to wipe the local SQLite database and start fresh!

### 4. Run Live Trading (Caution)
*Ensure your `SOLANA_PRIVATE_KEY` has actual funds before running.*
```bash
bun run src/main.ts
```

---

## 📊 Shadow Simulator CLI Output
The CLI output features a compact interface that visualizes whether the real-time price is staying safely inside the Concentrated Liquidity boundaries (`IN RNG`, `UPR EDG`):

```text
  📡 LLM Manager Evaluation (Simulated):
  [██████████] IN RNG  | +0.17% / ±1.2%   | CAPTCHA/SOL | Age: 84m  | PnL:  +0.17% | Fees: 0.0002 SOL | Val: 0.1002 SOL | 🤖 No Debate
  [████████░░] UPR EDG | +3.45% / ±4.0%   | SEND/SOL    | Age: 5m   | PnL:  +3.45% | Fees: 0.0010 SOL | Val: 0.1035 SOL | 🤖 Arb: 82/100
  [░░░░░░░░░░] OUT RNG | -6.50% / ±4.0%   | TRASH/SOL   | Age: 25m  | PnL:  -5.50% | Fees: 0.0006 SOL | Val: 0.0945 SOL | 🤖 Arb: 71/100
```

---

## 📱 Telegram Commands

When the Bot receives messages from your `TELEGRAM_CHAT_ID`, it acts as a personal financial advisor:
- `/sim` — Displays current shadow portfolio stats
- `/pause` — Pauses automated deployment
- `/resume` — Resumes operations
- `/set <pair> <instruction>` — Sets manual LLM instructions for a specific pool

---

## ⚠️ Disclaimer
This code is experimental and deals with real financial assets when in `LIVE` mode. The developers are not responsible for any financial losses or bugs that result in liquidations/impermanent loss. **Always test thoroughly in the shadow simulator before granting access to a live wallet.**
