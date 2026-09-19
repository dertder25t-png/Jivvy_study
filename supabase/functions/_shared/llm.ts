// The ONLY file that knows which LLM provider is in use. Everything else calls
// `getLlm().completeJson(...)`. Swapping providers or models is a change here (and
// env vars) — never a codebase-wide refactor. Prices and models shift constantly.
import Anthropic from 'npm:@anthropic-ai/sdk';

export type LlmContent =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; base64: string }
  | { type: 'pdf'; base64: string };

export interface JsonRequest {
  model: string;
  system: string;
  user: string | LlmContent[];
  /** JSON Schema the output must satisfy (structured-outputs subset: closed objects, no min/max). */
  schema: Record<string, unknown>;
  maxTokens: number;
  /** Optional depth control for models that support it (not Haiku). */
  effort?: 'low' | 'medium' | 'high';
}

export interface JsonResult<T> {
  data: T;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface LlmClient {
  completeJson<T>(req: JsonRequest): Promise<JsonResult<T>>;
}

export class LlmError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
  }
}

// ---------------------------------------------------------------- Anthropic
function anthropicClient(): LlmClient {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new LlmError('ANTHROPIC_API_KEY is not set for this function');
  const client = new Anthropic({ apiKey });

  const toBlocks = (user: string | LlmContent[]) =>
    typeof user === 'string'
      ? user
      : user.map((c) => {
          if (c.type === 'text') return { type: 'text' as const, text: c.text };
          if (c.type === 'image') {
            return { type: 'image' as const, source: { type: 'base64' as const, media_type: c.mediaType, data: c.base64 } };
          }
          return {
            type: 'document' as const,
            source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: c.base64 },
          };
        });

  return {
    async completeJson<T>(req: JsonRequest): Promise<JsonResult<T>> {
      let msg;
      try {
        msg = await client.messages.create({
          model: req.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: [{ role: 'user', content: toBlocks(req.user) }],
          output_config: {
            ...(req.effort ? { effort: req.effort } : {}),
            format: { type: 'json_schema', schema: req.schema },
          },
        // deno-lint-ignore no-explicit-any
        } as any);
      } catch (e) {
        const status = (e as { status?: number }).status;
        throw new LlmError(`LLM request failed${status ? ` (${status})` : ''}`, status === 429 || (status ?? 0) >= 500);
      }

      if (msg.stop_reason === 'refusal') throw new LlmError('The model declined to process this document');
      if (msg.stop_reason === 'max_tokens') throw new LlmError('The document was too large to read in one pass');

      const block = msg.content.find((b: { type: string }) => b.type === 'text') as { text: string } | undefined;
      if (!block) throw new LlmError('The model returned no text');
      try {
        return {
          data: JSON.parse(block.text) as T,
          model: msg.model,
          usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens },
        };
      } catch {
        throw new LlmError('The model returned malformed JSON', true);
      }
    },
  };
}

// ---------------------------------------------------------------- selection
/**
 * Provider switch. Add another `case` (e.g. an OpenAI-compatible adapter) and set
 * LLM_PROVIDER; nothing else in the codebase changes.
 */
export function getLlm(): LlmClient {
  switch ((Deno.env.get('LLM_PROVIDER') ?? 'anthropic').toLowerCase()) {
    case 'anthropic':
      return anthropicClient();
    default:
      throw new LlmError(`Unknown LLM_PROVIDER "${Deno.env.get('LLM_PROVIDER')}"`);
  }
}

/** Model per job. Syllabus parsing is the highest-leverage step and is cached across students, so it gets the stronger model. */
export const models = {
  parse: () => Deno.env.get('LLM_MODEL_PARSE') ?? 'claude-sonnet-5',
  cards: () => Deno.env.get('LLM_MODEL_CARDS') ?? 'claude-haiku-4-5',
  /** Set to "" to omit (required if you point LLM_MODEL_PARSE at Haiku, which has no effort control). */
  parseEffort: (): 'low' | 'medium' | 'high' | undefined => {
    const v = Deno.env.get('LLM_PARSE_EFFORT') ?? 'medium';
    return v === 'low' || v === 'medium' || v === 'high' ? v : undefined;
  },
};
