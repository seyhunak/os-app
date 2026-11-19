# Setting up OS on your phone

OS runs entirely on your iPhone or Android phone. You build it once from this repo onto your phone, and after that it needs nothing else: no server, no Mac left running, no Tailscale.

You need:

- Node 22.13 or newer, to build the app
- Xcode and an Apple ID for iPhone, or Android Studio for Android
- A [Composio API key](https://composio.dev). An [OpenRouter API key](https://openrouter.ai/keys) is optional

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
2. **Tools.** Choose what your brief reads, and connect each tool through Composio.
3. **First brief.** Paste your goals and, optionally, an OpenRouter key, then write your first brief.
4. **Schedule.** Add a schedule and allow notifications. At each time, the phone reminds you, and the brief is written when you open it. See [Schedules](README.md#schedules).

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
| A plain brief instead of an AI one | The brief says why: no OpenRouter key, the key is out of credit, or every model was busy |
| No reminder at a scheduled time | Allow notifications for OS in the phone's Settings. The brief is still written the next time you open the app |
| A scheduled brief didn't appear | Schedules write the brief when you open the reminder or the app, not in the background |
| `xcodebuild` fails with a signing error | Choose your team in Xcode, as in the iPhone steps |
| The app won't install on your iPhone | Unlock the phone and try again. The first try sometimes fails |
| The app crashes at start after updating | Run `npx expo prebuild --platform ios` again, then rebuild, since new native modules were added |
