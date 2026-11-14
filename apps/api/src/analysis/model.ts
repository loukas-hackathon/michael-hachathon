import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";

// The one place that talks to the model. The analysis depends on the `ModelClient` interface, so
// tests (and machines with no key) run the whole flow with `FakeModelClient`.

export interface ModelRequest {
  /** The coach instructions. Stable, so the API can serve them from its prompt cache. */
  system: string;
  /** The brief for this run. */
  user: string;
  /** JSON schema the answer must follow. */
  schema: Record<string, unknown>;
  /** How hard the model thinks. Default `medium`; the specialists ask for `low`. */
  effort?: "low" | "medium" | "high";
}

export interface ModelReply {
  /** The answer's text: one JSON document. */
  text: string;
  /** The model that wrote it. With fallbacks this can differ from the one that was asked. */
  model: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number | null;
    cache_creation_input_tokens: number | null;
  };
}

export interface ModelClient {
  /** The model that will be asked. Stored on the run when no reply names another. */
  readonly model: string;
  complete(request: ModelRequest): Promise<ModelReply>;
}

export type ModelFailure = "refusal" | "truncated" | "empty" | "api";

/** Anything that stopped the model from answering. The message is safe to store on the run. */
export class ModelError extends Error {
  constructor(
    public kind: ModelFailure,
    message: string,
  ) {
    super(message);
  }
}

/** Thrown before any work is done when the server has no key. */
export class ModelNotConfiguredError extends Error {
  constructor() {
    super("The analysis is not configured: ANTHROPIC_API_KEY is not set on this server.");
  }
}

const DEFAULT_MODEL = "claude-opus-5-5";

// Room for the answer (a few hundred tokens) and for thinking, which counts towards the limit
// even though its text is not returned. Small enough that no streaming is needed.
const MAX_TOKENS = 16000;

export class AnthropicModelClient implements ModelClient {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    /** Tests pass their own `fetch` to read the request and answer it without a network. */
    options: { fetch?: typeof fetch } = {},
  ) {
    // The key is passed in, so the SDK never looks for other credentials on the machine.
    this.client = new Anthropic({ apiKey, maxRetries: 1, timeout: 120_000, fetch: options.fetch });
  }

  async complete(request: ModelRequest): Promise<ModelReply> {
    let response: Anthropic.Beta.BetaMessage;
    try {
      // The beta namespace because of `fallbacks`; everything else is the standard Messages API.
      response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        // Thinking is always on for this model; depth is set with effort. `medium` is the model's
        // default, written out so a later default change cannot move it.
        thinking: { type: "adaptive" },
        output_config: {
          effort: request.effort ?? "medium",
          format: { type: "json_schema", schema: request.schema },
        },
        // If a safety classifier declines the request, the API retries it on the model Anthropic
        // recommends for that case, inside the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // One breakpoint at the end of the instructions: they never change, the brief always does.
        system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: request.user }],
      });
    } catch (err) {
      throw new ModelError("api", describeApiError(err));
    }

    // A refusal is a normal 200 with no usable content: look at why it stopped before reading it.
    if (response.stop_reason === "refusal") {
      const category = response.stop_details?.category ?? "no category";
      throw new ModelError("refusal", `the model declined to answer (${category})`);
    }
    if (response.stop_reason === "max_tokens") {
      throw new ModelError("truncated", "the model's answer was cut off at the token limit");
    }
    const text = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("")
      .trim();
    if (!text)
      throw new ModelError("empty", `the model returned no text (stop reason ${response.stop_reason})`);

    return {
      text,
      model: response.model,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens,
      },
    };
  }
}

/** A short reason with no request content in it. */
function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "the model API rejected the key (401)";
  if (err instanceof Anthropic.PermissionDeniedError) return "the model API denied access to the model (403)";
  if (err instanceof Anthropic.NotFoundError) return "the model API does not know this model (404)";
  if (err instanceof Anthropic.RateLimitError) return "the model API is rate limiting us (429)";
  if (err instanceof Anthropic.BadRequestError)
    return `the model API rejected the request (400): ${err.message}`;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "the model API timed out";
  if (err instanceof Anthropic.APIConnectionError) return "the model API could not be reached";
  if (err instanceof Anthropic.APIError) return `the model API failed (${err.status ?? "no status"})`;
  return "the model call failed";
}

/** Answers from a script, for tests. Records what it was asked. */
export class FakeModelClient implements ModelClient {
  readonly model = "fake-model";
  readonly requests: ModelRequest[] = [];

  constructor(private readonly script: (ModelReply | string | Error)[]) {}

  async complete(request: ModelRequest): Promise<ModelReply> {
    this.requests.push(request);
    const next = this.script[Math.min(this.requests.length - 1, this.script.length - 1)];
    if (next === undefined) throw new ModelError("empty", "the fake model has nothing to say");
    if (next instanceof Error) throw next;
    return typeof next === "string" ? { text: next, model: this.model } : next;
  }
}

let override: ModelClient | null = null;
let real: ModelClient | null = null;

/** Tests swap the model here; `null` puts the real one back. */
export function useModelClient(client: ModelClient | null) {
  override = client;
}

/** The model for this server. Throws ModelNotConfiguredError when there is no key. */
export function modelClient(): ModelClient {
  if (override) return override;
  if (!env.ANTHROPIC_API_KEY) throw new ModelNotConfiguredError();
  real ??= new AnthropicModelClient(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL || DEFAULT_MODEL);
  return real;
}
