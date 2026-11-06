/** Meeting links, passcodes and credentials never get stored or shown. */
const RULES: Array<[RegExp, string]> = [
  [/https?:\/\/[^\s)"'>]*(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com|webex\.com|whereby\.com)[^\s)"'>]*/gi, '[meeting link removed]'],
  [/\b(?:passcode|password|pwd|meeting id|pin)\s*[:=]\s*\S+/gi, '[credential removed]'],
  [/\b(?:sk-(?:or|ant)-[\w-]{8,}|ak_[\w-]{16,}|ghp_\w{20,}|gho_\w{20,}|github_pat_\w{20,}|xox[abprs]-[\w-]{10,}|ak_[\w-]{16,}|AIza[\w-]{30,})\b/g, '[token removed]'],
  [/\bBearer\s+[\w.~+/-]{16,}=*/gi, '[token removed]'],
];

export function redact(text: string): string {
  return RULES.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map(redactDeep) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)])) as T;
  }
  return value;
}
