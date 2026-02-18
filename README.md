# MiissRose Moderation Bot (Node.js + Telegraf)

A production-ready, fully featured Telegram **group/supergroup moderation bot** inspired by Rose/MissRose, built as a **real Bot API bot** (no userbot/session string), with:

- Telegraf
- MongoDB (mongoose)
- Express (Render-ready health server)
- Polling mode only
- Per-group settings and moderation data

## Features

### Administration Commands
All required commands are implemented:

- `.ban [reply/user_id]`
- `.unban [user_id]`
- `.kick [reply/user_id]`
- `.promote [reply/user_id] [role]`
- `.demote [reply/user_id]`
- `.roles`
- `.pin [reply]`
- `.unpin [reply]`
- `.vc`
- `.mute [reply/user_id] [time]`
- `.unmute [reply/user_id]`
- `.warn [reply/user_id]`
- `.warnings [user_id]`
- `.purge [reply]`
- `.del [reply]`
- `.lock [permission]`
- `.unlock [permission]`
  - supported: stickers, gifs, photos, videos, links, voice, documents, polls
- `.admins`
- `.bots`
- `.users`
- `.zombies`
- `.delservice [on/off]`
- `.keepservice [service_type]`
- `.servicestatus`
- `.settitle [new_title]`
- `.restoretitle`
- `.welcome [on/off] [message]`
- `.goodbye [on/off] [message]`
- `.filter [trigger] [response]`
- `.filters`
- `.stop [trigger]`

### Extra Operational Commands
- `.setlog [channel_id]` (optional log channel per group)
- `.clearlog`
- `.whitelist [reply/user_id]`
- `.unwhitelist [reply/user_id]`

### Private DM Control Center
- `/start`, `/help`, `/commands`, `/admin` in private chat
- Admin panel buttons for broadcast, welcome editing, filter toggle, and stats
- Broadcast targets all tracked groups
- Welcome template preview with variables: `{first}`, `{username}`, `{chat}`
- Group-only moderation flow (DM ignores moderation commands)

### Auto Moderation & Security
- Anti-spam
- Anti-flood
- Anti-link (Telegram + external)
- Bad word filter (DB-backed)
- Auto delete spam/forbidden messages
- Whitelisted users bypass moderation

### CAPTCHA / Verification
- New users are muted until verification
- Inline button verification
- Timeout-based auto kick if not verified

### Logging System
- Logs are saved in MongoDB (`Logs` collection)
- Optional log channel output per group
- Logs include bans, mutes, kicks, warnings, joins, leaves

### MongoDB Collections
- `Groups`: settings/locks/welcome/captcha/log settings
- `Users`: warnings, mute/verification status, tracked members
- `Filters`: per-group trigger-response filters
- `Logs`: moderation/audit events

## Project Structure

```text
/src
 ├── index.js
 ├── bot.js
 ├── config.js
 ├── handlers/
 ├── middleware/
 ├── models/
 ├── utils/
```

## Setup

1. Clone the repo.
2. Install dependencies:

```bash
npm install
```

3. Create `.env`:

```env
BOT_TOKEN=123456:ABCDEF...
MONGO_URI=mongodb+srv://...
PORT=3000
BOT_USERNAME=your_bot_username
WARNING_LIMIT=3
CAPTCHA_TIMEOUT_SECONDS=120
FLOOD_WINDOW_MS=8000
FLOOD_MESSAGE_LIMIT=6
```

4. Start bot:

```bash
npm start
```

## Deployment on Render (FREE Web Service)

1. Create a new **Web Service** from your repo.
2. Runtime: Node
3. Build command:

```bash
npm install
```

4. Start command:

```bash
npm start
```

5. Add all env vars from `.env` in Render Dashboard.
6. Ensure MongoDB is reachable from Render.

The app starts Express on `process.env.PORT` and runs Telegram bot in **polling mode**.

## Notes

- Bot must be admin with sufficient rights for moderation actions.
- Some Bot API features (like `.vc`) depend on Telegram API support and available permissions.
- `.users` uses tracked users from DB (seen via messages/joins), since Bot API does not provide full member export for bots.
