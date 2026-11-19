# Security

Please report vulnerabilities through [GitHub's private reporting](https://github.com/seyhunak/os-app/security/advisories/new), not in a public issue.

## How your data is protected

- **Everything stays on your phone.** There's no OS server. Your briefs, updates, goals, schedules and the 7-day cache of what was read are in the app's own SQLite database, protected by the phone's storage encryption and app sandbox.
- **API keys.** Your Composio and OpenRouter keys are kept in the iOS Keychain or Android Keystore, readable only by this app on this device. The app shows only their last 4 characters.
- **On the network.** The app talks only to Composio (`backend.composio.dev`), to read your tools, and to OpenRouter (`openrouter.ai`), to write the brief, both over HTTPS. It sends no telemetry.
- **What leaves the phone.** Tool requests go to Composio under your own account. With an OpenRouter key, summaries of what was read, your goals and your recent updates go to OpenRouter, which only uses providers that don't train on or store prompts. Meeting links, passcodes and common token formats are removed first.
- **Erasing.** Settings → Your data → "Erase everything on this phone" removes your keys and all saved data, and cancels reminders. Deleting the app does the same.
- **Untrusted content.** Email and other tool data is kept apart from the model's instructions, and the model has no tools. Brief text renders without live links.
