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

/** OpenRouter needs a key and a model. Without them, briefs fall back to a plain digest, so it starts open. */
export function modelState(status: Pick<Status, 'openrouter' | 'openrouterModel' | 'model'>): SectionState {
  const model = (status.openrouterModel ?? status.model)?.trim();
  const configured = Boolean(status.openrouter) && Boolean(model);
  return { configured, summary: configured ? `OpenRouter · ${model}` : 'No model set up' };
}
