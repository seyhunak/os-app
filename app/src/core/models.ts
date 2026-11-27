/**
 * Every OpenRouter chat call names one preset, os-chat, instead of a model. The preset lives in
 * your OpenRouter account (openrouter.ai/settings/presets) and holds the models, their order and
 * the provider rules, so OpenRouter picks the model and falls back on its own.
 */

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1';

export const PRESET = 'os-chat';
/** What goes in a request's `model` field to use the preset. */
export const PRESET_MODEL = `@preset/${PRESET}`;

/** The preset's main model. A brief written by any other says which backup wrote it. */
export const MAIN_MODEL = 'qwen/qwen3-30b-a3b-instruct-2507';
/** Tried in this order when the main model can't answer. */
export const BACKUP_MODELS = ['mistralai/mistral-small-24b-instruct-2501', 'google/gemma-3-12b-it'] as const;
export const PRESET_MODELS = [MAIN_MODEL, ...BACKUP_MODELS] as const;

/**
 * The preset's provider rules, as set in OpenRouter. Kept here so Settings, the docs and the tests
 * say the same thing. The request doesn't send them: the preset does.
 * - Cheapest provider first, across all models.
 * - Only providers that support every parameter sent.
 * - Only providers that don't keep or train on prompts, since tool data can include email.
 * - At most $0.20 per million prompt tokens and $0.60 per million completion tokens.
 */
export const PRESET_PROVIDER = {
  sort: { by: 'price', partition: 'none' },
  require_parameters: true,
  data_collection: 'deny',
  max_price: { prompt: 0.2, completion: 0.6 },
} as const;

/** Room for the brief. None of the preset's models think, so all of it goes to the answer. */
export const BRIEF_TOKENS = 5_000;

/** "qwen/qwen3-30b-a3b-instruct-2507" reads as "qwen3-30b-a3b-instruct-2507". */
export const modelName = (id: string) => id.split('/').pop() ?? id;

/** OpenRouter may answer with a dated or suffixed id, such as "google/gemma-3-12b-it:free". */
export const isMainModel = (id: string | null | undefined) => !id || id.split(':')[0] === MAIN_MODEL;
