/**
 * Reads a server token from a one-time link like `http://127.0.0.1:8787/#token=…`.
 * The hash never reaches the server or its logs, and the token stays out of the web bundle.
 */
export function tokenFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const token = params.get('token')?.trim();
  return token ? token : null;
}

/** On web, takes the token from the address bar and removes it so it isn't left in history or shared by copying the URL. */
export function takeLinkToken(): string | null {
  if (typeof location === 'undefined' || typeof history === 'undefined') return null;
  const token = tokenFromHash(location.hash);
  if (token) history.replaceState(null, '', location.pathname + location.search);
  return token;
}
