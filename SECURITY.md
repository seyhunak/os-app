# Security

Please report vulnerabilities through [GitHub's private reporting](https://github.com/seyhunak/os-app/security/advisories/new), not in a public issue.

## How your data is protected

- **Server token.** Every API call needs it. It's random, stored with owner-only file permissions, and sent only in the `Authorization` header.
- **API keys.** Stored encrypted with AES-256-GCM. The encryption key is a separate owner-only file in the data directory, so a copy of the database alone doesn't reveal them. Someone who can read your whole data directory can read your keys. The API never returns a key.
- **On devices.** iOS and Android keep the server token in the system keychain. The web app uses `localStorage`, so only use it in a browser you trust.
- **Offline copies.** Each device keeps recent briefs and updates so they stay readable offline. These can include email subjects, and they rely on the device's own protection. Disconnecting a device removes them.
- **On the network.** The server listens on `127.0.0.1` by default. Put HTTPS in front of it before reaching it from another device.
- **Untrusted content.** Email and other tool data is kept apart from the model's instructions, and the model has no tools. Brief text renders without live links.
