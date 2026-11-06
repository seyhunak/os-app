# Setting up OS on a Mac

This guide runs the OS server on your Mac all the time, makes it private to your devices with Tailscale, and connects the web and mobile apps.

| Part | Where it runs | What you get |
|---|---|---|
| Server | Your Mac, as a background service | Briefs on schedule, even when no app is open |
| Tailscale | Your Mac and your other devices | A private HTTPS address that works on any network |
| Web app | Any browser on your tailnet | Nothing to install |
| Mobile app | iPhone or Android | Your briefs in a native app, including offline |

## 1. Install OS

You need Node 22.13 or newer.

```bash
git clone https://github.com/seyhunak/os-app.git
```

```bash
cd os-app
```

```bash
npm run setup
```

```bash
npm run build:web
```

The server hosts the web app from `app/dist`, so build it even if you mostly plan to use your phone.

Keep the repo somewhere like `~/Projects`. macOS can block background services from reading `~/Documents`, `~/Desktop` and `~/Downloads`.

## 2. Run the server as a background service

```bash
sh scripts/install-macos-service.sh
```

This installs a macOS LaunchAgent called `dev.osapp.server`. It starts the server now and at every login, and restarts it if it stops. If `npm start` is already running, stop that first, because both use port 8787.

Check that it's running:

```bash
curl -s http://127.0.0.1:8787/health
```

You should see `{"ok":true}`.

The first start creates your server token in `~/.os-app/token`. This copies it without showing it on screen:

```bash
pbcopy < ~/.os-app/token
```

Open <http://127.0.0.1:8787>, paste the token, and follow the steps to add your keys, tools, goals and schedule. Keys are stored encrypted in `~/.os-app`, not in the service.

### Managing the service

Restart it, for example after updating OS:

```bash
launchctl kickstart -k "gui/$(id -u)/dev.osapp.server"
```

Follow the logs:

```bash
tail -f ~/.os-app/server.log
```

Stop it. It stays stopped until your next login, or until you run the install script again:

```bash
launchctl bootout "gui/$(id -u)/dev.osapp.server"
```

Remove it completely. Your data in `~/.os-app` stays:

```bash
launchctl bootout "gui/$(id -u)/dev.osapp.server" && rm ~/Library/LaunchAgents/dev.osapp.server.plist
```

Run the install script again if you move the repo or switch to a Node installed somewhere else, because the service saves both paths.

### Keeping schedules on time

A scheduled brief only runs if your Mac is awake and you're logged in. A brief that's missed isn't made up later, so:

- **Stop your Mac from sleeping.** Go to **System Settings → Battery → Options** and turn on **Prevent automatic sleeping on power adapter when the display is off**. The wording varies by Mac. A closed laptop can still sleep.
- **Log in after a restart.** The service starts at login, not at power on.

## 3. Reach it from your other devices with Tailscale

The server only listens on `127.0.0.1`, so other devices can't reach it directly. [Tailscale](https://tailscale.com) gives it a private HTTPS address. You don't need to be on the same Wi-Fi, because this works on any network, including cellular.

1. Install Tailscale on your Mac and your other devices, and sign in to the same account on each.
2. On your Mac, share the server with your tailnet:

```bash
tailscale serve --bg --https=8443 8787
```

If Tailscale says HTTPS or MagicDNS isn't enabled, follow the link it prints. `--bg` keeps the setting after a restart.

3. Check it:

```bash
tailscale serve status
```

It should list your address as `https://<machine>.<tailnet>.ts.net:8443`, marked `tailnet only`. That's the address for all your devices.

Always use `tailscale serve`. `tailscale funnel` would put your server on the public internet.

To stop sharing:

```bash
tailscale serve --https=8443 off
```

Avoid `tailscale serve reset` unless you mean it, because it removes everything this Mac shares, not just OS.

## 4. Use the web app

On any device signed in to your tailnet, open:

```text
https://<machine>.<tailnet>.ts.net:8443
```

Enter your token. On your Mac, <http://127.0.0.1:8787> works too, even with Tailscale off.

When you change the app's code, run `npm run build:web` again. To work on it with live reload, use `npm run dev:server` and `npm run dev:app` instead of the service.

## 5. Install the mobile app

You build the app yourself from the `app` folder. The first build generates the `ios` or `android` folder, which is git-ignored. Set this first, or CocoaPods can fail:

```bash
cd app
```

```bash
export LANG=en_US.UTF-8
```

### iOS Simulator

You need Xcode.

```bash
npx expo run:ios
```

In the app, enter `http://127.0.0.1:8787` and your token. The simulator shares your Mac's network, so this address works without Tailscale. This build needs the Expo dev server that the command starts.

### iPhone

You need Xcode and an Apple ID.

1. Connect your iPhone, unlock it and trust your Mac. Turn on **Settings → Privacy & Security → Developer Mode** if it's offered.
2. Generate the iOS project once:

```bash
npx expo prebuild --platform ios
```

3. Set up signing. Open `ios/OS.xcworkspace` in Xcode, select the **OS** target, and choose your team under **Signing & Capabilities**. If the bundle ID is taken, set `ios.bundleIdentifier` in `app/app.json` to your own, such as `com.yourname.os`, then generate the project again with the command above.
4. Build and install. A Release build doesn't need your Mac running afterward:

```bash
npx expo run:ios --device --configuration Release
```

5. The first time it opens, iOS may ask you to trust the developer. Go to **Settings → General → VPN & Device Management**.
6. Install Tailscale on the iPhone, sign in and turn it on.
7. In the app, enter `https://<machine>.<tailnet>.ts.net:8443` and your token.

With a free Apple ID, the app stops opening after 7 days until you build it again. A paid Apple Developer account lasts about a year.

### Android

Android builds haven't been tested yet. You need Android Studio.

```bash
npx expo run:android --variant release
```

Install Tailscale on the phone, then enter your Tailscale address and token in the app.

### Prefilling the address and token

To avoid typing the address, put it in `app/.env` before you build:

```bash
EXPO_PUBLIC_OS_URL=https://<machine>.<tailnet>.ts.net:8443
```

Never put your token in that file, because `.env` also feeds the web build, which the server hands out without a login. On a build only for your own phone, set the token just for that command:

```bash
EXPO_PUBLIC_OS_TOKEN="$(cat ~/.os-app/token)" npx expo run:ios --device --configuration Release
```

Anyone who gets a build made this way can read the address and token from it, so never share or publish it.

## Updating OS

From the repo folder:

```bash
git pull
```

```bash
npm run setup
```

```bash
npm run build:web
```

```bash
launchctl kickstart -k "gui/$(id -u)/dev.osapp.server"
```

Rebuild the mobile app if anything under `app/` changed.

## If something goes wrong

Settings → Server shows the machine's name and whether it's online. If it's offline, the app keeps working with saved content and syncs when the server returns. See [Offline](README.md#offline).

| What you see | What to check |
|---|---|
| `curl` to `/health` fails | Read `~/.os-app/server.log`. If port 8787 is taken, stop `npm start`, then run the restart command above |
| The service keeps restarting | Run `npm run setup` in case `node_modules` is missing, then run the install script again |
| The app is offline on your phone only | Turn on Tailscale on the phone, and check it's signed in to the same account as the Mac |
| The app is offline on every device | Your Mac may be asleep or logged out. Wake it, then check `/health` |
| The Tailscale address returns a 502 error | Tailscale is fine, but the server isn't running. Check `/health` |
| The Tailscale address doesn't load | Run `tailscale serve status`, and run the `tailscale serve` command again if the address isn't listed |
| The web app shows `404 Not Found` | Run `npm run build:web` |
| The app rejects your token | Copy it again from `~/.os-app/token`. A build with a prefilled token needs a new build if the token changed |
| A scheduled brief didn't appear | Your Mac was asleep or logged out at that time. Open the app and create a brief |
| `xcodebuild` fails with a signing error | Choose your team in Xcode, as in the iPhone steps |
| The app won't install on your iPhone | Unlock the phone and try again. The first try sometimes fails |
