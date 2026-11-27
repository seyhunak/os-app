# Setting up OS on your phone

OS runs entirely on your iPhone or Android phone. You build it once from this repo onto your phone, and after that it needs nothing else: no server, no Mac left running, no Tailscale.

You need:

- Node 22.13 or newer, to build the app
- Xcode and an Apple ID for iPhone, or Android Studio for Android
- A [Composio API key](https://composio.dev). An [OpenRouter API key](https://openrouter.ai/keys), with credit, and the `os-chat` preset is optional: without it, briefs are a plain digest

## 1. Get the code

```bash
git clone https://github.com/seyhunak/os-app.git
```

```bash
cd os-app
```

```bash
npm run setup
```

## 2. Build it onto your phone

### iOS Simulator

```bash
npm run ios
```

This builds a development version and starts the Expo dev server it needs.

### iPhone

1. Connect your iPhone, unlock it and trust your Mac. Turn on **Settings → Privacy & Security → Developer Mode** if it's offered.
2. Generate the iOS project. Run it again after updating, since the app now uses SQLite and notifications:

```bash
cd app && npx expo prebuild --platform ios
```

3. Set up signing. Open `app/ios/OS.xcworkspace` in Xcode, select the **OS** target, and choose your team under **Signing & Capabilities**. If the bundle ID is taken, set `ios.bundleIdentifier` in `app/app.json` to your own, such as `com.yourname.os`, then generate the project again with the command above.
4. Build and install a Release build, which runs on its own without your Mac:

```bash
npx expo run:ios --device --configuration Release
```

5. The first time it opens, iOS may ask you to trust the developer. Go to **Settings → General → VPN & Device Management**.

With a free Apple ID, the app stops opening after 7 days until you build it again. A paid Apple Developer account lasts about a year.

### Android

Android builds haven't been tested yet. You need Android Studio.

```bash
cd app && npx expo run:android --variant release
```

## 3. Set it up in the app

1. **Composio.** Paste your Composio API key. It's checked with Composio, then kept in the phone's Keychain or Keystore.
2. **Tools.** Choose what your brief reads, and connect each tool through Composio. Tools are grouped by category, A to Z, and only the ones you tick are read.
3. **First brief.** If you use OpenRouter, create the [preset](#openrouter-preset) and add your key, then write your first brief. Then set this week's goal in the Goals tab, with WOOP.
4. **Schedule.** Add a schedule and allow notifications. At each time, the phone reminds you, and the brief is written when you open it. See [Schedules](README.md#schedules).

## OpenRouter preset

Every AI call goes to an OpenRouter preset named `os-chat`, so it has to exist in the account your key belongs to.

1. Open [openrouter.ai/settings/presets](https://openrouter.ai/settings/presets) and create a preset with the slug `os-chat`.
2. Models, in this order: `qwen/qwen3-30b-a3b-instruct-2507` first, then `mistralai/mistral-small-24b-instruct-2501` and `google/gemma-3-12b-it` as backups.
3. Provider settings:

   ```json
   {
     "sort": { "by": "price", "partition": "model" },
     "allow_fallbacks": true,
     "require_parameters": true,
     "data_collection": "deny",
     "max_price": { "prompt": 0.20, "completion": 0.60 }
   }
   ```

   In the form, that's **Include Provider Preferences** ticked, **sort** set to price, **How to route between models** left on **Fallback** (OpenRouter saves this as `partition: null`), **data_collection** set to deny, **max_price** 0.20 and 0.60, and **Require parameters** set to Yes. Don't choose **Sort** for routing: it would send most requests to the cheapest model, Gemma, instead of Qwen.
4. Save it, and add some credit to the account. These models aren't free. Without credit, OS falls back to a free model through OpenRouter's free router when one that doesn't keep prompts is up, and says so at the top of the brief.

Leave the system prompt empty: OS sends its own.

## Turning off the old Mac server

Earlier versions ran a server on your Mac and reached it through Tailscale. Update the app on your phone first and open it once, so it imports what it saved from the server. Then, on the Mac:

1. Stop the background service and remove it:

```bash
launchctl bootout "gui/$(id -u)/dev.osapp.server"; rm -f ~/Library/LaunchAgents/dev.osapp.server.plist
```

2. Stop Tailscale from serving it:

```bash
tailscale serve --https=8443 off
```

3. When you're sure the phone has everything, delete the server's data. It holds your keys, so delete it rather than leaving it around. This can't be undone:

```bash
rm -rf ~/.os-app
```

You can uninstall Tailscale from the Mac and your phone too, unless you use it for something else. `app/.env` and its `EXPO_PUBLIC_OS_URL` are no longer read, so you can delete that file.

## Updating OS

From the repo folder:

```bash
git pull
```

```bash
npm run setup
```

Then build onto your phone again, as in step 2. Your data stays on the phone across updates.

## If something goes wrong

| What you see | What to check |
|---|---|
| "Composio didn't accept that key" | Copy the key again from Composio's Settings → Project Settings → API Keys |
| A tool shows as failed in the brief | Reconnect it in Settings → Tools, or at [composio.dev](https://composio.dev). OS waits an hour before trying a failed tool again, unless you tap Refetch |
| A plain brief instead of an AI one | The brief says why: no OpenRouter key, or both the `os-chat` preset and the free fallback failed, such as no credit and no privacy-safe free provider, or today's free requests used up |
| "Written by …, a free model from OpenRouter's free router" | The preset couldn't answer, and the line says why. Usually the key needs credit |
| "OpenRouter has no preset named os-chat" | Create it as in [OpenRouter preset](#openrouter-preset), in the same account as the key |
| No reminder at a scheduled time | Allow notifications for OS in the phone's Settings. The brief is still written the next time you open the app |
| A scheduled brief didn't appear | Schedules write the brief when you open the reminder or the app, not in the background |
| `xcodebuild` fails with a signing error | Choose your team in Xcode, as in the iPhone steps |
| The app won't install on your iPhone | Unlock the phone and try again. The first try sometimes fails |
| `pod install` fails with `Unicode Normalization not appropriate for ASCII-8BIT` | Your shell has no UTF-8 locale. Run the build again with `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` in front of it |
| The app crashes at start after updating Run `npx expo prebuild --platform ios` again, then rebuild, since new native modules were added |
