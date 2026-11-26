/**
 * Which free models OpenRouter offers today, which of them is best for a brief, and whether it
 * answers. Asked before every brief, so a model OpenRouter adds or drops is picked up on its own.
 */

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1';

/** What a brief needs to know about one free model. */
export interface FreeModel {
  id: string;
  /** Unix seconds, from OpenRouter. Newer wins a tie. */
  created: number;
  context: number;
  maxOutput: number | null;
  /** Billions of parameters, when the id says, such as "550b". */
  size: number | null;
  /** Mandatory: thinking can't be turned off. On by default: it thinks unless told not to. */
  reasoning: { mandatory: boolean; defaultOn: boolean; efforts: string[] };
}

/** OpenRouter's own router to whatever free model is up. The last resort, since you can't tell which model writes. */
export const FREE_ROUTER = 'openrouter/free';

/** A brief's prompt plus its answer fits in this, with room to spare. */
const MIN_CONTEXT = 32_000;
/** Below this size a model writes a poor brief, so it isn't used. */
const MIN_SIZE_B = 7;

interface CatalogEntry {
  id: string;
  created?: number;
  context_length?: number;
  pricing?: Record<string, string | undefined>;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  top_provider?: { max_completion_tokens?: number | null };
  supported_parameters?: string[];
  expiration_date?: string | null;
  reasoning?: { mandatory?: boolean; default_enabled?: boolean; supported_efforts?: string[] } | null;
}

const sizeOf = (id: string): number | null => {
  // "nemotron-3-ultra-550b-a55b" is 550b, the total. "a55b" is how many are active, so it's skipped.
  const match = id.split('/').pop()!.match(/(?:^|[-_])(\d+(?:\.\d+)?)b(?=$|[-_:])/i);
  return match ? Number(match[1]) : null;
};

const isFree = (pricing: CatalogEntry['pricing']) =>
  Boolean(pricing) && Object.values(pricing!).every((price) => price === undefined || Number(price) === 0);

/** Turns OpenRouter's catalog into the free, text-writing models worth asking for a brief. */
export function freeModelsFrom(catalog: CatalogEntry[], now: Date = new Date()): FreeModel[] {
  return catalog
    .filter((m) => m.id !== FREE_ROUTER && isFree(m.pricing))
    .filter((m) => {
      const out = m.architecture?.output_modalities ?? ['text'];
      return out.length === 1 && out[0] === 'text' && (m.architecture?.input_modalities ?? ['text']).includes('text');
    })
    .filter((m) => (m.context_length ?? 0) >= MIN_CONTEXT)
    .filter((m) => !m.expiration_date || Date.parse(m.expiration_date) > now.getTime())
    .filter((m) => !m.supported_parameters || m.supported_parameters.includes('max_tokens'))
    .map((m): FreeModel => ({
      id: m.id,
      created: m.created ?? 0,
      context: m.context_length ?? 0,
      maxOutput: m.top_provider?.max_completion_tokens ?? null,
      size: sizeOf(m.id),
      reasoning: {
        mandatory: m.reasoning?.mandatory ?? false,
        defaultOn: m.reasoning?.default_enabled ?? false,
        efforts: m.reasoning?.supported_efforts ?? [],
      },
    }))
    .filter((m) => m.size === null || m.size >= MIN_SIZE_B);
}

/**
 * Best first. A model that can stop thinking comes before one that can't, since thinking spends the
 * answer's room. Then the biggest, by the size in its id, and the newest. A model with no size in its
 * id goes after those with one, since its size is a guess.
 */
export function rankFreeModels(models: FreeModel[]): FreeModel[] {
  return [...models].sort((a, b) =>
    Number(a.reasoning.mandatory) - Number(b.reasoning.mandatory)
    || Number(a.size === null) - Number(b.size === null)
    || (b.size ?? 0) - (a.size ?? 0)
    || b.created - a.created
    || a.id.localeCompare(b.id));
}

/** Your model first when OpenRouter still has it, then the rest best first. */
export function orderFor(models: FreeModel[], preferred: string | null): FreeModel[] {
  const ranked = rankFreeModels(models);
  const mine = ranked.find((m) => m.id === preferred);
  return mine ? [mine, ...ranked.filter((m) => m !== mine)] : ranked;
}

/** OpenRouter's catalog is public, so this sends no key and nothing of yours. */
export async function fetchFreeModels(signal: AbortSignal, now?: Date): Promise<FreeModel[]> {
  const response = await fetch(`${OPENROUTER_URL}/models`, { signal });
  if (!response.ok) throw new Error(`OpenRouter's model list returned HTTP ${response.status}`);
  const data = (await response.json()) as { data?: CatalogEntry[] };
  if (!Array.isArray(data.data)) throw new Error("OpenRouter's model list came back empty");
  return freeModelsFrom(data.data, now);
}

/**
 * The five free models the app shipped with, as OpenRouter described them on 26 Nov 2026.
 * Used only when OpenRouter's list can't be read and no copy of it was kept.
 */
export const BUILT_IN_MODELS: FreeModel[] = [
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', created: 1780551208, context: 1_000_000, maxOutput: 65_536, size: 550, reasoning: { mandatory: false, defaultOn: true, efforts: ['high', 'medium', 'none'] } },
  { id: 'nvidia/nemotron-3.5-super-vl:free', created: 1792076662, context: 1_000_000, maxOutput: 131_072, size: null, reasoning: { mandatory: false, defaultOn: false, efforts: [] } },
  { id: 'nvidia/nemotron-3.5-lightning:free', created: 1786452751, context: 1_000_000, maxOutput: 65_536, size: null, reasoning: { mandatory: false, defaultOn: false, efforts: [] } },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', created: 1777393095, context: 256_000, maxOutput: 65_536, size: 30, reasoning: { mandatory: false, defaultOn: true, efforts: [] } },
  { id: 'baidu/ernie-5.5-flash-preview:free', created: 1794333533, context: 1_024_000, maxOutput: 921_600, size: null, reasoning: { mandatory: true, defaultOn: true, efforts: ['high'] } },
];

/** What we know about a model by id, for one that isn't in the list, such as in a test. */
export const describeModel = (id: string, known: FreeModel[] = BUILT_IN_MODELS): FreeModel =>
  known.find((m) => m.id === id) ?? { id, created: 0, context: 0, maxOutput: null, size: sizeOf(id), reasoning: { mandatory: false, defaultOn: false, efforts: [] } };

/** Room for the brief itself, when thinking is off. */
export const BRIEF_TOKENS = 5_000;
/** Room for thinking and then the brief, for a model that thinks anyway. Free, so the room costs nothing. */
export const THINKING_TOKENS = 16_000;
const LIGHT_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'];

/**
 * How to ask one model. Thinking is off where it can be, since it spends the room the brief needs.
 * A model that must think is asked for its lightest effort, to keep thinking out of the answer, and
 * given the room to finish. `roomy` asks the second way, for a model that ran out of room the first.
 */
export function requestFor(model: FreeModel, roomy = false): { reasoning: Record<string, string | boolean>; maxTokens: number } {
  const { mandatory, efforts } = model.reasoning;
  const cap = (n: number) => (model.maxOutput ? Math.min(model.maxOutput, n) : n);
  if (!mandatory && !roomy) return { reasoning: efforts.includes('none') ? { effort: 'none' } : { enabled: false }, maxTokens: cap(BRIEF_TOKENS) };
  const lightest = LIGHT_EFFORTS.filter((e) => e !== 'none').find((e) => efforts.includes(e)) ?? 'low';
  return { reasoning: { effort: lightest, exclude: true }, maxTokens: cap(THINKING_TOKENS) };
}
