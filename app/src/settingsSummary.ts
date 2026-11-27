import type { Status } from './api';

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
