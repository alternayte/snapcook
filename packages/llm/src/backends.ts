import { generateText, type LanguageModel, type ModelMessage, Output } from "ai";
import { z } from "zod";

export type StructuredInput = { system?: string; prompt?: string; messages?: ModelMessage[] };

export type StructuredResult = {
  object: unknown;
  prompt_tokens: number;
  completion_tokens: number;
  /** US dollars. Anything but a number fails the call. */
  cost: unknown;
};

/** One way to get an object that matches a schema out of a model. */
export type StructuredBackend = {
  model: string;
  generate(input: StructuredInput, schema: z.ZodType): Promise<StructuredResult>;
};

/** A model reached through the AI SDK. Cost comes from OpenRouter's usage accounting. */
export function aiSdkBackend(model: Exclude<LanguageModel, string>): StructuredBackend {
  return {
    model: model.modelId,
    async generate(input, schema) {
      const result = await generateText({
        model,
        output: Output.object({ schema }),
        ...input,
      } as Parameters<typeof generateText>[0]);
      const metadata = result.providerMetadata as
        | { openrouter?: { usage?: { cost?: unknown } } }
        | undefined;
      return {
        object: result.output,
        prompt_tokens: result.usage.inputTokens ?? 0,
        completion_tokens: result.usage.outputTokens ?? 0,
        cost: metadata?.openrouter?.usage?.cost,
      };
    },
  };
}

export const CLAUDE_CODE_PREFIX = "claude-code/";

const ClaudeCodeResult = z.object({
  is_error: z.boolean(),
  subtype: z.string(),
  result: z.string().nullish(),
  structured_output: z.unknown(),
  total_cost_usd: z.number(),
  usage: z.object({
    input_tokens: z.number(),
    cache_creation_input_tokens: z.number().default(0),
    cache_read_input_tokens: z.number().default(0),
    output_tokens: z.number(),
  }),
});

export class ClaudeCodeError extends Error {}

/** Reads the JSON that `claude -p --output-format json` prints. */
export function parseClaudeCodeResult(stdout: string): StructuredResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new ClaudeCodeError(`claude printed no JSON: ${stdout.slice(0, 300)}`);
  }
  const parsed = ClaudeCodeResult.parse(raw);
  if (parsed.is_error || parsed.structured_output === undefined) {
    throw new ClaudeCodeError(`claude call failed (${parsed.subtype}): ${parsed.result ?? ""}`);
  }
  const { usage } = parsed;
  return {
    object: parsed.structured_output,
    prompt_tokens:
      usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens,
    completion_tokens: usage.output_tokens,
    // The CLI reports list price. On a subscription no money moves; the figure sizes the work.
    cost: parsed.total_cost_usd,
  };
}

const CLAUDE_CODE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * A Claude model reached through the local Claude Code CLI and its login.
 * Text prompts only. Runs with no tools, no settings and no project context.
 */
export function claudeCodeBackend(model: string): StructuredBackend {
  return {
    model: `${CLAUDE_CODE_PREFIX}${model}`,
    async generate(input, schema) {
      if (input.prompt === undefined || input.messages !== undefined) {
        throw new ClaudeCodeError("the Claude Code backend takes a text prompt only");
      }
      // The CLI rejects a schema that names its own dialect.
      const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(schema);
      const proc = Bun.spawn(
        [
          "claude",
          "-p",
          input.prompt,
          "--model",
          model,
          "--output-format",
          "json",
          "--json-schema",
          JSON.stringify(jsonSchema),
          "--system-prompt",
          input.system ?? "Answer with the requested JSON only.",
          "--tools",
          "",
          "--setting-sources",
          "",
          "--strict-mcp-config",
          "--disable-slash-commands",
          "--no-session-persistence",
        ],
        { cwd: "/", stdout: "pipe", stderr: "pipe", timeout: CLAUDE_CODE_TIMEOUT_MS },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (code !== 0 && stdout.trim() === "") {
        throw new ClaudeCodeError(`claude exited with ${code}: ${stderr.slice(0, 300)}`);
      }
      return parseClaudeCodeResult(stdout);
    },
  };
}
