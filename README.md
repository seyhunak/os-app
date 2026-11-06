# OS

[![CI](https://github.com/seyhunak/os-app/actions/workflows/ci.yml/badge.svg)](https://github.com/seyhunak/os-app/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/seyhunak/os-app)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/seyhunak/os-app?style=flat)](https://github.com/seyhunak/os-app/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/seyhunak/os-app)](https://github.com/seyhunak/os-app/issues)
[![Last commit](https://img.shields.io/github/last-commit/seyhunak/os-app)](https://github.com/seyhunak/os-app/commits/main)
[![Built with Claude Code](https://img.shields.io/badge/Built%20with-Claude%20Code-D97757?logo=claude&logoColor=white)](https://claude.com/claude-code)

A short daily brief from your own tools: what matters, what to drop, and what to do next.

OS reads your email, calendar and work tools through [Composio](https://composio.dev), uses an AI model through [OpenRouter](https://openrouter.ai) or [Ollama](https://ollama.com) to rank what it finds against your goals, and writes a brief on a schedule you choose. You run the server yourself, and read your briefs on the web, iPhone or Android.

**Fewer things. Better choices. More execution. Clear evidence.**

## How it works

1. **Authorize Composio.** The app opens Composio in your browser, and you paste your API key once. Composio has no sign-in that can hand a key to an app. It handles sign-in to your tools, so OS never sees those passwords.
2. **Choose your tools.** Gmail, Outlook, Google Calendar, Calendly, Google Tasks, Google Drive, Notion, Slack, GitHub, GitLab, Jira, Linear, Asana, Trello, Todoist, HubSpot and Hacker News.
3. **Get a brief.** An AI model ranks each item against your goals and drops the noise. Choose OpenRouter or Ollama in Settings, along with the model. Without a model, you get a plain summary of what was read.
4. **Choose a schedule.** Pick morning or evening briefs, the time, the days and the timezone. The server writes them, and any device can read them.

## What a brief looks like

Every brief, morning or evening, runs in the same order:

1. **Focus:** the one thing to do first, the goal it moves and what to ignore.
2. **Signals:** at most 3 things to do, highest priority first, each showing its source and the goal it serves.
3. **Goals:** where each of your goals stands, and the next action.
4. **Sources:** a sentence or two on what each tool added up to, never a long list, and anything that failed.
5. **Left out:** the noise that was dropped and why. It starts collapsed.
6. **Note for next brief:** what the next brief should pick up first. It's passed on automatically.

Tap **Update** at the top of the app any time to log what you've done. Updates go into a ledger, which can only be added to. Every brief reads the last 14 days of it, so your signals and goal status reflect work your tools can't see.

## Quick start

You need Node 22.13 or newer, and a [Composio API key](https://composio.dev). An [OpenRouter API key](https://openrouter.ai/keys) or [Ollama](https://ollama.com) is optional.

```bash
git clone https://github.com/seyhunak/os-app.git
cd os-app
npm run setup
npm run build:web
npm start
```

The first start prints your server token and saves it in `~/.os-app/token`. Open <http://127.0.0.1:8787>, paste the token, and follow the steps.

To keep it running on a Mac and reach it from your other devices, follow [SETUP.md](SETUP.md). It covers the background service, Tailscale, web and mobile.

### Try it without any accounts

This runs the real server and app against fake tool data. Build the web app first, as above:

```bash
npm run dev:fake
```

The token is printed when it starts. Nothing is saved after you stop it.

### Mobile

The web app already works in a phone's browser. For the native app, you need Xcode for iOS or Android Studio for Android:

```bash
cd app
export LANG=en_US.UTF-8
npx expo run:ios
```

Use `npx expo run:android` for Android. In the app, enter your server's address and token. A phone can't use `127.0.0.1` to reach your computer, so see [Reaching your server from your phone](#reaching-your-server-from-your-phone).

## What gets read, and where it goes

| Tool | What OS reads |
|---|---|
| Gmail | Sender, subject, date, unread state and a short preview of your last 5 emails from the last 3 days |
| Google Calendar | Titles, times and attendee names for the rest of this week (through Sunday), on your primary calendar |
| GitHub | Open issues and pull requests assigned to you |
| Slack | The 10 latest messages in up to 5 channels you belong to |
| Todoist | Your open tasks |
| Google Tasks | Open tasks, due dates and notes from up to 10 task lists |
| Linear | Your 50 latest issues |
| Outlook | Sender, subject, date, unread state and a short preview of your last 5 inbox emails from the last 3 days |
| Calendly | Event names, times and invitee names for bookings this week |
| Notion | Titles of pages changed in the last 7 days |
| Google Drive | Names and owners of files changed in the last 7 days |
| Asana | Your open tasks and due dates |
| Trello | Open cards assigned to you and their due dates |
| Jira | Unresolved issues assigned to you |
| GitLab | Open issues and merge requests assigned to you |
| HubSpot | Names, stages, close dates and amounts of open deals |
| Hacker News | AI-related stories from the front page |

- **Read-only.** OS only calls read operations. It can't send, post or delete anything.
- **Stored on your server.** Summaries are cached in SQLite for 7 days. Briefs and your updates stay until you delete the database.
- **Sent through OpenRouter, if it's your provider and you add a key.** Those summaries, your goals, your recent updates and the last brief's note go to OpenRouter and the model provider it picks. OS only allows providers that don't train on or store prompts for that purpose. With no model set up, nothing is sent.
- **Sent through Ollama, if you choose it.** The same data goes to the Ollama address you set. A model on your own machine keeps it there. Models ending in `cloud`, and the `https://ollama.com` address, run on Ollama's servers, so your data is sent there. Settings marks which is which.
- **Sent to Composio.** Your tool requests go through Composio, under your own account.
- **Redacted.** Meeting links, passcodes and common token formats are removed before anything is stored or sent.

## Rules OS follows

- **One read per tool per day.** The first morning brief reads your tools, and later briefs reuse that data. "Refetch" is the only way to read again.
- **No extra Composio calls.** Your list of connected accounts is also kept for a day, so a fully cached brief or opening Settings calls nothing. A tool that fails is left alone for an hour.
- **Evening briefs never read.** They use the day's data, so schedule a morning brief as well.
- **A rate limit stops that tool until tomorrow.** OS doesn't retry.
- **No invented data.** Which tools were read and how each one went comes from code, not from the AI, and a failed or unconnected tool is named in the brief. The model is told to write "insufficient evidence" rather than guess.
- **Summaries, not lists.** Each source gets a sentence or two from the AI. If it skips one, or there's no model, OS writes a plain one from the data.
- **Email is treated as untrusted.** The model has no tools, so a message saying "ignore your instructions" can't make OS do anything. At worst it could influence the wording of a brief.

## Choosing an AI model

Go to **Settings → Model** and choose a provider, its key and a model. Your next brief uses it, and each provider remembers its own model.

| Provider | Key | Models you see |
|---|---|---|
| OpenRouter (default) | Required | The ones your key's guardrails allow, cheapest first, with prices |
| Ollama | Only for `https://ollama.com` | Whatever your Ollama has that can write text, with your own machine's models first |

For Ollama, the address defaults to `http://127.0.0.1:11434` as seen from the server. To keep your data on your machine, pull a chat model and choose one that doesn't end in `cloud`. An Ollama key is only ever sent over HTTPS.

If a model fails, you still get a plain brief that explains why, such as a model your plan doesn't include.

## Reaching your server from your phone

The server listens on `127.0.0.1` by default. To use it from other devices, put it behind HTTPS. [Tailscale](https://tailscale.com) is the simplest way, and keeps it private to your own devices:

```bash
tailscale serve --bg --https=8443 8787
```

Use `tailscale serve`, not `tailscale funnel`, which would put it on the public internet. Any device signed in to your tailnet can then open the web app at `https://<machine>.<tailnet>.ts.net:8443`, and that same address works in the mobile app.

To prefill the address in the mobile app, put it in `app/.env` before building:

```bash
EXPO_PUBLIC_OS_URL=https://<machine>.<tailnet>.ts.net:8443
```

The address is built into the app, so don't publish a build made this way. Never put your token in that file, because `.env` also feeds the web build, which the server hands out without a login.

To prefill the token too, on a build only for your own phone, set it just for that build command:

```bash
EXPO_PUBLIC_OS_TOKEN="$(cat ~/.os-app/token)" npx expo run:ios --device
```

Anyone who gets that build can read the token from it, so never share it.

The app refuses plain `http://` for any address outside your local network, so your token isn't sent unencrypted.

## Offline

Your server runs on your own machine, so it can be out of reach. Web and mobile keep working when it is:

- **Read:** your last 30 briefs, goals, schedules and updates are saved on each device.
- **Write:** updates and goal edits made offline are queued on the device. Updates keep the time you wrote them, and are never saved twice. If two devices edit goals offline, the last one to sync wins.
- **Status:** Settings → Server shows the machine's name and whether it's online. The app checks every 30 seconds, so a lost connection can take up to about 40 seconds to show. Expand it to see the full address and token.
- **Reconnect:** the app checks for your server every 10 seconds while offline. When it's back, it sends what's queued and fetches anything new, such as briefs written on schedule.
- **Needs your server:** writing a new brief, and changing schedules, tools or keys.

Saved content is stored in the app's own storage, or in the browser's on web, without extra encryption. "Disconnect this device" removes it.

## Configuration

Everything is optional. Copy [.env.example](.env.example) to `server/.env`, which is git-ignored and loaded at startup, or add your keys in the app. Each brief is capped at 4,000 output tokens. `OS_MODEL` sets the OpenRouter model until you choose one in Settings. If your connected accounts already exist in Composio under another user ID, set `OS_COMPOSIO_USER_ID` to match it.

Schedules only run while the server is running, and a brief missed during downtime isn't made up later. On a Mac, `sh scripts/install-macos-service.sh` keeps it running, including after restarts. Elsewhere, use `systemd` or similar.

## Project layout

```
server/   Hono API, SQLite, scheduler, Composio, OpenRouter and Ollama. Also hosts the web app.
app/      Expo app for web, iOS and Android.
```

To add a tool, add an entry to `TOOLKITS` in [server/src/collectors.ts](server/src/collectors.ts). A collector only reads, returns short facts rather than raw API responses, and can sum up what it read in a sentence or two.

## Development

```bash
npm test
npm run typecheck
```

`npm run setup` also turns on a commit check that blocks `.env` files, databases, and anything that looks like an API key or a private Tailscale address.

Reporting a security problem? See [SECURITY.md](SECURITY.md).

## Current limits

- One person per server. There are no user accounts.
- Android builds haven't been tested yet. Web and iOS have.
- The default AI model is very cheap and can misjudge goal status, so check it before acting. Choose a better one in Settings.
- No push notifications yet, so you open the app to read a scheduled brief.
- Google Drive, Trello, Jira and GitLab haven't been tried on real accounts yet, and neither have Calendly and HubSpot with real bookings or deals. A tool that fails is named in the brief.
- Calendars cover this week only, through Sunday, so next week's meetings don't appear until Monday. Email covers your last 5 from the last 3 days.
- You can select tools from the list above. Other Composio tools need a collector first.
- OS never disconnects your accounts. Manage those at [composio.dev](https://composio.dev).

## License

[MIT](LICENSE)

The app bundles the [Newsreader](https://fonts.google.com/specimen/Newsreader) and [Libre Franklin](https://fonts.google.com/specimen/Libre+Franklin) fonts, under the SIL Open Font License.
