import type { Status } from './api';
import type { AiRoute } from './core/compose';
import { MAIN_MODEL, modelName, PRESET } from './core/models';

export interface SectionState {
  /** Set up and working, so the section starts collapsed. */
  configured: boolean;
  /** Shown beside the title while collapsed. */
  summary: string;
}

/** Composio needs only its key. */
export function composioState(status: Pick<Status, 'composio'>): SectionState {
  return status.composio ? { configured: true, summary: 'Composio connected' } : { configured: false, summary: 'Composio key needed' };
}

/** OpenRouter needs only its key: the preset picks the model. Without it, briefs fall back to a plain digest, so it starts open. */
export function modelState(status: Pick<Status, 'openrouter' | 'preset'>): SectionState {
  return status.openrouter ? { configured: true, summary: `OpenRouter · ${status.preset}` } : { configured: false, summary: 'OpenRouter key needed' };
}

/** What Settings knows about the AI router: the last call's route and the credit left. */
export interface RouterStatus {
  lastRoute: (AiRoute & { at: string }) | null;
  credit: number | null;
  creditError: string | null;
  keyRejected: boolean;
}

export interface RouterHealth {
  level: 'ok' | 'warn' | 'down' | 'unknown';
  /** One short line, such as "Healthy" or "No credit: using free models". */
  label: string;
  /** Where the next request goes. */
  next: string;
  /** Which model answered last, how, and when. */
  last: string;
  credit: string;
}

const VIA: Record<AiRoute['via'], string> = { preset: 'main model', backup: 'preset backup', free: 'free router', failed: 'failed' };

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function ago(at: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(at)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

/** Credit under a cent can't pay for a brief, so it counts as none. */
const hasCredit = (credit: number | null) => credit !== null && credit >= 0.01;

/**
 * The router's health in a few words. The next request goes to the preset while there's credit,
 * and to the free router without it. The last call says whether the main model, a backup, a free
 * model or nothing answered.
 */
export function routerHealth(s: RouterStatus, now: Date = new Date()): RouterHealth {
  const r = s.lastRoute;
  const next = s.keyRejected
    ? 'Nothing: the key was rejected'
    : s.credit === null
      ? `${PRESET} preset, or the free router without credit`
      : hasCredit(s.credit) ? `${PRESET} preset · ${modelName(MAIN_MODEL)}` : 'Free router · no credit for the preset';
  const last = r
    ? r.via === 'failed'
      ? `Failed ${ago(r.at, now)}${r.reason ? `: ${r.reason}` : ''}`
      : `${r.model ? modelName(r.model) : 'Unknown model'} · ${VIA[r.via]} · ${ago(r.at, now)}`
    : 'Not used yet';
  const credit = s.credit === null ? (s.creditError ? "Couldn't check" : '—') : `$${s.credit.toFixed(2)}`;

  const health = (level: RouterHealth['level'], label: string): RouterHealth => ({ level, label, next, last, credit });
  if (s.keyRejected) return health('down', 'Key rejected');
  if (r?.via === 'failed') return health('down', 'Last request failed');
  if (s.credit !== null && !hasCredit(s.credit)) return health('warn', 'No credit: using free models');
  if (r?.via === 'free') return health('warn', 'Last answer came from a free model');
  if (r?.via === 'backup') return health('warn', 'Main model was unavailable last time');
  if (s.credit === null && s.creditError) return health('unknown', "Couldn't check OpenRouter");
  return health('ok', 'Healthy');
}
