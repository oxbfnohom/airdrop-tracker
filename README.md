# Airdrop Tracker

A self-hosted web app for keeping airdrop work in one place. You add a project once, and the app builds the task list, watches the project's news, tracks the TGE date, and checks the on-chain tasks every 30 minutes. It also reads the Telegram alpha groups you already follow, archives the messages, and turns anything relevant into a project update or a new opportunity with a tier.

Everything runs on your own machine or a cheap VPS. Storage is a single SQLite file. There is no account system except one optional PIN, and no data leaves your server except the calls you configure (your LLM endpoint, Telegram, Etherscan).

## What you need before starting

- Node.js 20 or 22 LTS. Use one of those two. Node 24 does not have a prebuilt binary for `better-sqlite3` 13 yet, so `npm install` tries to compile it and stops with a `node-gyp` error unless Visual Studio Build Tools are installed. On Windows with Node 24, install "Desktop development with C++" from the Visual Studio Build Tools installer first, or switch to Node 22
- A Telegram account you can log into with a phone number, for reading groups
- A Telegram bot from @BotFather, for notifications
- An Etherscan API key, free, for EVM task checks
- Optionally, an OpenAI-compatible LLM endpoint. Turn this off if you do not want to pay for tokens. The app still runs, you fill checklists by hand

## Install

```bash
git clone https://github.com/<your-user>/airdrop-tracker.git
cd airdrop-tracker
npm ci --ignore-scripts
cp .env.example .env.local
```

`--ignore-scripts` skips the automatic `node-gyp` step that npm runs for `better-sqlite3`. Version 13 already ships compiled binaries for Windows, macOS, and Linux, so nothing needs to compile here. Drop the flag if you have a C++ toolchain and prefer to build from source.

Open `.env.local` and fill the values in the table below. Then:

```bash
npm run build
npm run start
```

The app listens on port 3000 by default. Open `http://localhost:3000`.

If you use the included PM2 config, it starts on port 3111 instead:

```bash
pm2 start ecosystem.config.js
pm2 save
```

## What to fill in `.env.local`

Start with the LLM block. If you leave `LLM_ENABLED=0`, skip the first three rows, the app works without them.

| Variable | Required | Where to get it | What it does |
|---|---|---|---|
| `LLM_BASE_URL` | for research | Your provider's OpenAI-compatible URL, for example `https://api.openai.com/v1`. It must be reachable from where the app runs, so not `127.0.0.1` if the app is on a VPS | Sends research prompts for project summaries and task checklists |
| `LLM_API_KEY` | for research | Your provider dashboard | Authenticates the LLM calls |
| `LLM_MODEL` | for research | Your provider's model list | Which model to call |
| `LLM_ENABLED` | no | `1` or `0` | `0` disables every LLM call. Checklists stay empty until you write them yourself |
| `LLM_DAILY_BUDGET` | no | A number | Hard cap on LLM calls per day |
| `TELEGRAM_BOT_TOKEN` | for alerts | @BotFather, `/newbot` | Sends pushes to your Telegram |
| `TELEGRAM_CHAT_ID` | for alerts | Send `/start` to your bot, then read `getUpdates`, or ask @userinfobot | Which chat receives the pushes |
| `TG_API_ID` | for group reading | my.telegram.org, API development tools | Logs in the userbot that reads your groups |
| `TG_API_HASH` | for group reading | Same page as above | Second half of the userbot login |
| `ETHERSCAN_API_KEY` | for on-chain checks | etherscan.io, free account, one key works across EVM chains | Reads wallet activity for tasks marked on-chain |
| `SOLANA_RPC_URL` | no | Any Solana RPC. Public mainnet is the default | Solana balance and transaction reads |
| `APP_PIN` | on a public server | You pick it | Web login. Empty means anyone who finds the URL gets in |
| `CRON_TOKEN` | no | You pick a random string | Lets an external scheduler call `/api/cron/*` with a bearer token |
| `PORT` | no | A port number | Defaults to 3000 |
| `TZ` | no | For example `Asia/Jakarta` | Decides when the daily digest fires |
| `NEWS_FEEDS` | no | Comma separated RSS URLs | Extra sources for the news feed |

## First run

1. Open the app and go to the Telegram user panel. Log in once with the phone number tied to `TG_API_ID`. Telegram sends a login code, then your 2FA password if you have one. The session is stored in the database, so you do not repeat this.
2. Join the airdrop groups you actually read. The group list is not shipped with the repo and there is nothing to configure by hand: the app archives every chat this Telegram account has joined, so the sources are the ones you pick yourself. Leave a group and it stops being read.
3. Paste an airdrop link (Galxe, Zealy, Layer3, or a project site) into the add box. The app detects the platform, creates the project, and writes the task list. With the LLM enabled this takes a minute or two; with it disabled, add tasks yourself.
4. Register the wallet addresses you use for tasks. On-chain tasks only get checked once a wallet is registered.

## Daily use

The app has four working tabs.

Tasks: everything you marked as work in progress, with streaks on daily items. One-off tasks never reset.

Opportunities: new leads pulled from group messages, sorted into tiers S, A, B, C. You either adopt one, which creates a project with tasks, or skip it. The tier is a suggestion from the LLM, so read the message before adopting.

TGE: confirmed token generation events with dates. The app shows a warning when a project you hold has a TGE within seven days.

News: per-project updates from the project's own Telegram channel, its blog RSS, and general feeds you added. Items are tagged as TGE, snapshot, mainnet, listing, claim, deadline, tokenomics, or funding.

Two background jobs run on their own. The digest goes out at 07:00 in your configured timezone and lists what is still open. The on-chain check runs every 30 minutes.

## Backups

The app creates `data/airdrop.db` on the first request. Nothing is committed with the repo, so the first start gives you an empty database. The app copies it to `data/backups/` at 04:30 each day and keeps seven days. Copy that file anywhere to back up. Stop the app first, or copy the `-wal` file with it, otherwise the copy can miss recent writes.

## Deploy on a VPS

```bash
git clone https://github.com/<your-user>/airdrop-tracker.git
cd airdrop-tracker
npm ci --ignore-scripts
cp .env.example .env.local
nano .env.local
npm run build
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Set `APP_PIN` before the server is reachable from the internet. Check the health endpoint after a minute:

```bash
curl http://<vps-ip>:3111/api/health
```

A healthy response has `ok: true`. If `poll_stale` stays true, the Telegram poller is stuck. Run `pm2 logs airdrop-tracker` and look for the last poll timestamp.

To keep the process alive after a reboot, `pm2 startup` prints a command you run once as root. Do not skip it.

## When something breaks

No tasks appear after adding a project. With `LLM_ENABLED=0` this is expected, the app does not invent tasks without the LLM. Turn the LLM on or write the tasks yourself.

The Telegram poller stops. Sessions break when the same account logs in somewhere else. Open the user panel and log in again. The app resumes reading from the last saved offset.

Notifications never arrive. Check `TELEGRAM_CHAT_ID` first. A wrong chat ID fails silently because Telegram returns success for messages you cannot see. Send a test from the panel.

`npm install` stops at `better-sqlite3` with a `node-gyp` error. You are on Node 24 without C++ build tools. Switch to Node 20 or 22 LTS, or install Visual Studio Build Tools with the "Desktop development with C++" workload and run the install again.

On-chain checks always fail. Check that `ETHERSCAN_API_KEY` is valid and the wallet is registered for the right chain. Etherscan V2 uses one key for all EVM chains, older single-chain keys will not work.

The LLM bill gets large. Set `LLM_DAILY_BUDGET`. The app stops calling the model once the counter reaches the limit and picks up again the next day.
