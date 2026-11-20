# OS

[![CI](https://github.com/seyhunak/os-app/actions/workflows/ci.yml/badge.svg)](https://github.com/seyhunak/os-app/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/seyhunak/os-app)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/seyhunak/os-app?style=flat)](https://github.com/seyhunak/os-app/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/seyhunak/os-app)](https://github.com/seyhunak/os-app/issues)
[![Last commit](https://img.shields.io/github/last-commit/seyhunak/os-app)](https://github.com/seyhunak/os-app/commits/main)
[![Built with Claude Code](https://img.shields.io/badge/Built%20with-Claude%20Code-D97757?logo=claude&logoColor=white)](https://claude.com/claude-code)

A short daily brief from your own tools: what matters, what to drop, and what to do next.

OS reads your email, calendar and work tools through [Composio](https://composio.dev), uses free AI models through [OpenRouter](https://openrouter.ai), with a cheap paid one as backup, to rank what it finds against your goals, and writes a brief on a schedule you choose. It runs entirely on your iPhone or Android phone. There's no server to run, and no Mac or VPN to keep on.

**Fewer things. Better choices. More execution. Clear evidence.**

## Architecture

```
 Your phone (iPhone or Android)
┌──────────────────────────────────────────┐
│ Expo app (app/)                          │
│ - Keychain / Keystore: your two API keys │      ┌──────────────────────────┐
│ - SQLite: briefs, ledger, goals,         │ ───▶ │ Composio: your tools,    │
│   schedules, 7-day pull cache            │ HTTPS│ read-only                │
│ - local reminders at schedule times      │      ├──────────────────────────┤
│ - brief rules, collectors, ranking       │ ───▶ │ OpenRouter: the brief    │
└──────────────────────────────────────────┘      └──────────────────────────┘
```

- **Everything is on the phone.** The app holds your keys in the system keychain and keeps its data in SQLite on the device. Its core (`app/src/core/`) reads your tools, writes briefs and keeps the once-a-day budget.
- **Two services, both over HTTPS.** The phone calls Composio's REST API to read your tools and OpenRouter to write the brief. Nothing else is contacted.
- **Schedules use reminders.** A phone can't run a job at an exact time, so at each scheduled time you get a notification, and the brief is written when you open it or the app. See [Schedules](#schedules).

## How it works

1. **Authorize Composio.** The app opens Composio in your browser, and you paste your API key once. Composio has no sign-in that can hand a key to an app. It handles sign-in to your tools, so OS never sees those passwords.
2. **Choose your tools.** Gmail, Outlook, Google Calendar, Calendly, Google Tasks, Google Drive, Notion, Slack, GitHub, GitLab, Jira, Linear, Asana, Trello, Todoist, ClickUp, Microsoft To Do, Microsoft Teams, Zoom, Sentry, HubSpot, Salesforce and Hacker News. Only the tools you select are read; the rest are skipped.
3. **Get a brief.** An AI model ranks each item against your goals and drops the noise. Choose the model in Settings, where cheap models that write well are recommended. Without a key, you get a plain summary of what was read.
4. **Choose a schedule.** Pick morning, afternoon, evening or night briefs, the time and the days. At that time the phone reminds you, and the brief is written when you open it.

## What a brief looks like

Every brief opens with a greeting for its kind: good morning, good afternoon, good evening or good night. Then, in this order:

1. **Focus:** the 3 most important things to do, drawn from your goals and your tools, each with its source and the goal it moves.
2. **Signals:** items scored against your goals, highest first, each with its source. Shown open.
3. **Noise:** what scored too low to matter, and why. It starts collapsed.
4. **Goal progress:** the health of each goal (on track, needs attention, at risk or no evidence) and its next action.
5. **Sources:** a list with a sentence or two on what each tool added up to, and anything that failed.

A second section carries over to the next brief:

- **Note for next brief:** what the next brief should pick up first. It's passed on automatically.
- **Latest updates:** the last 3 updates in your ledger.

Tap **Update** at the top of the app any time to log what you've done. Updates go into a ledger, which can only be added to. Every brief reads the last 14 days of it, so your signals and goal status reflect work your tools can't see.

## Quick start

You need Node 22.13 or newer, Xcode for iOS or Android Studio for Android, and a [Composio API key](https://composio.dev). An [OpenRouter API key](https://openrouter.ai/keys) is optional.

```bash
git clone https://github.com/seyhunak/os-app.git
cd os-app
npm run setup
npm run ios
```

Use `npm run android` for Android. The app walks you through pasting your Composio key, choosing tools and writing your first brief. [SETUP.md](SETUP.md) covers building onto your own phone.

### Coming from the Mac server

Earlier versions ran a server on your Mac, reached over Tailscale. The app no longer needs either. On first launch after updating, it moves what it had saved from your server into its own store: your last 30 briefs, your updates, goals, tools, model, schedules and the OpenRouter key. Anything still waiting to sync is brought along too. Then:

- **Paste your Composio key once more.** The old phone app never held it, only the server did. Your tool connections live in your Composio account, so they carry over as they are.
- **Turn the old server off.** See [SETUP.md](SETUP.md#turning-off-the-old-mac-server).

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
| Salesforce | Names, stages, close dates and amounts of open opportunities you own |
| ClickUp | Open tasks assigned to you, their lists and due dates |
| Microsoft To Do | Open tasks and due dates from up to 10 lists |
| Microsoft Teams | The latest message in each chat active in the last 7 days, as plain text |
| Zoom | Topics and times of your meetings this week |
| Sentry | Unresolved issues assigned to you, seen in the last 14 days |
| Hacker News | AI-related stories from the front page |

- **Read-only.** OS only calls read operations. It can't send, post or delete anything.
- **Stored on your phone.** Summaries are cached in the app's SQLite database for 7 days. Briefs and your updates stay until you delete them or erase the app's data in Settings.
- **Sent through OpenRouter, if you add a key.** Those summaries, your goals, your recent updates and the last brief's note go to OpenRouter and the model provider it picks. OS only allows providers that don't train on or store prompts for that purpose. With no key, nothing is sent.
- **Sent to Composio.** The phone's tool requests go to Composio, under your own account.
- **Redacted.** Meeting links, passcodes and common token formats are removed before anything is stored or sent.

## Today's brief, automatically

If the newest brief on the Today screen is from yesterday or earlier, in your phone's local time, the app writes today's morning brief on its own. You keep reading the old one, marked "Writing today's brief…", until the new one arrives.

- **Same budget as any brief.** It's written through the same code as a manual one, so each tool is still read at most once a day and today's cached data is reused.
- **Never twice.** Briefs are written one at a time. Before writing, the app checks for a brief from today and uses that one if there is one. A failed attempt waits 5 minutes before trying again.

## Schedules

iOS and Android don't let an app run a job at an exact time, so a schedule works in two halves:

1. **A reminder.** At each scheduled time and day, the phone shows a local notification, such as "Morning brief: Open OS to write it." The app asks for permission to send them when you add your first schedule.
2. **The brief.** When you tap the reminder, or open the app any time after the scheduled time, the brief for that schedule is written straight away, with the banner "Writing your scheduled brief…".

- **One per schedule per day.** A schedule that has already written today's brief doesn't write it again.
- **No catching up.** A missed day isn't made up later. Opening the app after a week away writes one brief, not seven.
- **The latest wins.** If several schedules are due when you open the app, the latest one is written, since it reads the freshest picture of the day.
- **Phone time.** Schedules use your phone's timezone.
- **Without notifications.** If you turn reminders off, schedules still work. The brief is written the next time you open the app after its time.

## Rules OS follows

- **One read per tool per day.** The first morning brief reads your tools, and later briefs reuse that data. "Refetch" is the only way to read again.
- **No extra Composio calls.** Your list of connected accounts is also kept for a day, so a fully cached brief or opening Settings calls nothing. A tool that fails is left alone for an hour.
- **Evening and night briefs never read.** They use the day's data, so schedule a morning brief as well.
- **A rate limit stops that tool until tomorrow.** OS doesn't retry.
- **No invented data.** Which tools were read and how each one went comes from code, not from the AI, and a failed or unconnected tool is named in the brief. The model is told to write "insufficient evidence" rather than guess.
- **Summaries, not lists.** Each source gets a sentence or two from the AI. If it skips one, or there's no model, OS writes a plain one from the data.
- **Email is treated as untrusted.** The model has no tools, so a message saying "ignore your instructions" can't make OS do anything. At worst it could influence the wording of a brief.

## Choosing an AI model

OS uses [OpenRouter](https://openrouter.ai) only. Ollama was removed, since its cloud models are no longer free and a local model is too slow for a brief on most machines.

Go to **Settings → Model**, paste your OpenRouter key once, and pick a paid model. Each brief tries free models first and uses yours only when none of them can write it (see [Free models first](#free-models-first)).

- **Recommended first.** The list opens on one model per major lab (OpenAI, Google, Anthropic, DeepSeek, Qwen, Mistral, Meta, Z.ai, Moonshot, MiniMax, xAI): the cheapest general writing model of at least 14B parameters, under $3 per million tokens in and out. Coding, safety, image, audio and batch models are skipped. The rule picks up new models as they appear, with no list of names to maintain. The cheapest is marked "Best value".
- **Cheapest to most expensive.** "Show all models" lists every model your key's guardrails allow, sorted by price, with the cost per million tokens in and out. Type to search them.
- **Only models that can write a brief.** Models that output anything but text, batch-only models, and models with under 32K tokens of context are left out. A model with an unknown price is left out too.
- **Free models are listed but not recommended.** They're often rate limited, so OS tries them for you on every brief anyway, with your model as the backup.

The default paid model is `qwen/qwen3.7-flash`, at well under a cent per brief.

- **No hidden thinking.** Reasoning is turned off (`reasoning: {enabled: false}`), because a thinking model can spend the 4,000-token cap on thoughts and never finish the brief. Models that can't turn it off are asked for low effort and to keep it out of the answer. Some ignore that and think for 3,000 tokens or more anyway, so a free model like that gets 12,000 output tokens to finish in. Paid models always keep the 4,000 cap.
- **Other failures.** You still get a plain brief that explains why, such as a model your guardrails don't allow.

### Free models first

Each brief tries models in this order until one writes it:

1. **Free models your key allows**, up to five, from `GET /api/v1/models/user`, so your guardrails apply. Models from the labs above come first. Ones made for code or other single jobs, and ones under 14B parameters, are skipped. Like the recommended list, this is picked by rule, with no names to keep up to date.
2. **`openrouter/free`**, OpenRouter's own router, which picks whichever free model is up. It's always tried, even if your models can't be listed.
3. **Your model**, the paid one you chose in Settings.
4. **Two paid fallbacks**, the recommended models closest to yours in price.

How the chain behaves:

- **Busy models are skipped at once.** A rate-limited, overloaded, slow or failed model hands over to the next one, with no wait. An answer that runs out of tokens, comes back empty, or is cut off partway (`finish_reason: "error"`) counts as a failure too.
- **One more pass when everything was only busy.** If every model was just rate limited, OS waits 3 seconds and goes round once more. If anything else went wrong, it doesn't go round again.
- **Some failures stop it at once.** A rejected key, or a guardrail that flags prompt injection, would fail the same way on every model, so nothing else is tried.
- **Works with no credit.** Free models work on a key whose account has a $0 balance. Paid models need credit. Without it, OpenRouter answers them with 402.
- **Free models have a daily limit.** OpenRouter allows 50 free requests a day on accounts that haven't bought credits. One brief uses up to six, and twice that if it goes round a second time.
- **The same privacy rules apply.** Every request still asks for providers that don't keep or train on prompts (`provider: {data_collection: "deny"}`). Free models whose providers do aren't used.
- **You can see who wrote it.** A brief written by any model other than yours says so under its title, such as "Written by baidu/ernie-5.5-flash-preview:free, a free model."
- **The reason is given when every model fails.** You get a plain brief that says why, such as "the free models were busy or unavailable, and the OpenRouter key is out of credit or over its budget for paid models."

## Offline

Everything you've saved is on the phone, so your briefs, updates, goals and schedules are always readable. Writing a brief needs the internet, to read your tools and reach OpenRouter.

- **No internet:** tools you've already read today are reused from the cache. The others are named as failed in the brief, and OS waits an hour before calling them again. If OpenRouter can't be reached, you get a plain brief in the same layout that says why.
- **Updates and goals:** saved on the phone at once, with or without a connection.

## Your data

Settings → Your data → "Erase everything on this phone" removes your keys, goals, updates, briefs and schedules from the device, and cancels its reminders. Your tool connections stay in your Composio account. Manage those at [composio.dev](https://composio.dev).

## Project layout

```
app/              Expo app for iOS and Android.
app/src/core/     What runs a brief: the SQLite store, collectors, Composio and OpenRouter calls, schedules.
app/src/screens/  The Today, Schedule and Settings screens, and onboarding.
```

To add a tool, add an entry to `TOOLKITS` in [app/src/core/collectors.ts](app/src/core/collectors.ts). A collector only reads, returns short facts rather than raw API responses, and can sum up what it read in a sentence or two.

## Development

```bash
npm test
npm run typecheck
```

`npm run setup` also turns on a commit check that blocks `.env` files, databases, and anything that looks like an API key.

`npm test` runs the app tests (`node:test` through `tsx`). The core's store runs on `node:sqlite` in the tests and on `expo-sqlite` on the phone, with the same SQL.

## Contributing

Issues and pull requests are welcome. Please:

- Run `npm run setup` once, so the commit check is on.
- Keep `npm test` and `npm run typecheck` passing, and add a test for new behaviour.
- Keep tool reads within the once-a-day budget, and never add write operations to a collector.
- Never include real keys, `.env` files, databases or briefs, even in issues.

Reporting a security problem? See [SECURITY.md](SECURITY.md).

## Current limits

- One person per phone. Briefs don't sync between devices.
- No web app. A browser has no safe place to keep your API keys.
- Scheduled briefs are written when you open the app or its reminder, not in the background.
- Android builds haven't been tested yet. iOS has.
- Free models and the default paid model are cheap and can misjudge goal status, so check it before acting. The model that wrote each brief is named when it isn't yours.
- Google Drive, Trello, Jira and GitLab haven't been tried on real accounts yet, and neither have Calendly and HubSpot with real bookings or deals. Salesforce, ClickUp, Microsoft To Do, Microsoft Teams, Zoom and Sentry are new and untested on real accounts. A tool that fails is named in the brief.
- Calendars cover this week only, through Sunday, so next week's meetings don't appear until Monday. Email covers your last 5 from the last 3 days.
- You can select tools from the list above. Other Composio tools need a collector first.
- OS never disconnects your accounts. Manage those at [composio.dev](https://composio.dev).

## License

[MIT](LICENSE)

The app uses Hallmark's Console theme and bundles the [Host Grotesk](https://fonts.google.com/specimen/Host+Grotesk) and [Atkinson Hyperlegible Mono](https://fonts.google.com/specimen/Atkinson+Hyperlegible+Mono) fonts, under the SIL Open Font License.
