#!/usr/bin/env node
/**
 * OpenRouter MCP Server
 *
 * Provides tools for interacting with the OpenRouter API:
 * chat completions, model discovery, generation stats,
 * credit balance, and API key management.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios, { AxiosError } from "axios";

// ── Constants ──────────────────────────────────────────────────

const API_BASE_URL = "https://openrouter.ai/api/v1";
const CHARACTER_LIMIT = 25000;

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error("OPENROUTER_API_KEY environment variable is required");
  }
  return key;
}

// ── Shared Utilities ───────────────────────────────────────────

async function apiRequest<T>(
  endpoint: string,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
  data?: unknown,
  params?: Record<string, unknown>
): Promise<T> {
  const response = await axios({
    method,
    url: `${API_BASE_URL}/${endpoint}`,
    data,
    params,
    timeout: 120000,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    },
  });
  return response.data as T;
}

function handleApiError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response) {
      const status = error.response.status;
      const detail =
        typeof error.response.data === "object" && error.response.data !== null
          ? JSON.stringify(error.response.data, null, 2)
          : String(error.response.data ?? "");
      switch (status) {
        case 400:
          return `Error 400: Bad request.\n${detail}\nCheck your parameters and try again.`;
        case 401:
          return "Error 401: Invalid API key. Check your OPENROUTER_API_KEY.";
        case 402:
          return "Error 402: Insufficient credits. Top up at https://openrouter.ai/credits";
        case 403:
          return "Error 403: Permission denied. Your key may lack the required scope.";
        case 404:
          return `Error 404: Not found.\n${detail}`;
        case 429:
          return "Error 429: Rate limited. Wait a moment and retry.";
        case 502:
        case 503:
          return `Error ${status}: The upstream model provider is temporarily unavailable. Try a different model or retry shortly.`;
        default:
          return `Error ${status}: ${detail}`;
      }
    } else if (error.code === "ECONNABORTED") {
      return "Error: Request timed out. The model may need more time — try a shorter prompt or a faster model.";
    }
  }
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return (
    text.slice(0, CHARACTER_LIMIT) +
    "\n\n… [Response truncated. Use pagination or filters to reduce output.]"
  );
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text: truncate(text) }] };
}

function errorResult(error: unknown) {
  return { content: [{ type: "text" as const, text: handleApiError(error) }] };
}

// ── Server Setup ───────────────────────────────────────────────

const server = new McpServer({
  name: "openrouter-mcp-server",
  version: "1.0.0",
});

// ── Tool: Chat Completion ──────────────────────────────────────

const ChatCompletionSchema = z
  .object({
    model: z
      .string()
      .describe(
        'Model ID, e.g. "google/gemini-2.5-flash", "openai/gpt-4o", "anthropic/claude-sonnet-4". Use openrouter_list_models to discover available models.'
      ),
    messages: z
      .array(
        z.object({
          role: z
            .enum(["system", "user", "assistant", "tool"])
            .describe("Message role"),
          content: z.string().describe("Message content"),
        })
      )
      .min(1)
      .describe("Conversation messages"),
    max_tokens: z
      .number()
      .int()
      .min(1)
      .max(128000)
      .optional()
      .describe("Maximum tokens to generate"),
    temperature: z
      .number()
      .min(0)
      .max(2)
      .optional()
      .describe("Sampling temperature (0 = deterministic, 2 = creative)"),
    top_p: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Nucleus sampling threshold"),
    stream: z
      .literal(false)
      .optional()
      .describe("Streaming is not supported in MCP — always false"),
    response_format: z
      .object({
        type: z.enum(["text", "json_object"]).describe("Response format type"),
      })
      .optional()
      .describe("Force JSON output when type is json_object"),
    stop: z
      .array(z.string())
      .max(4)
      .optional()
      .describe("Up to 4 stop sequences"),
    frequency_penalty: z.number().min(-2).max(2).optional(),
    presence_penalty: z.number().min(-2).max(2).optional(),
    seed: z.number().int().optional().describe("Deterministic seed for reproducibility"),
  })
  .strict();

server.registerTool(
  "openrouter_chat_completion",
  {
    title: "Chat Completion",
    description: `Send a chat completion request to any model on OpenRouter.

Supports 400+ models from OpenAI, Anthropic, Google, Meta, Mistral, and more — all through one unified API.

Args:
  - model: Model ID (e.g. "google/gemini-2.5-flash", "anthropic/claude-sonnet-4")
  - messages: Array of {role, content} message objects
  - max_tokens: Max tokens to generate (optional)
  - temperature: 0-2, controls randomness (optional)
  - response_format: Set type to "json_object" for JSON mode (optional)

Returns:
  The model's response text, plus metadata (model used, tokens, generation ID for cost lookup).`,
    inputSchema: ChatCompletionSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (params) => {
    try {
      const body: Record<string, unknown> = {
        model: params.model,
        messages: params.messages,
        stream: false,
      };
      if (params.max_tokens !== undefined) body.max_tokens = params.max_tokens;
      if (params.temperature !== undefined) body.temperature = params.temperature;
      if (params.top_p !== undefined) body.top_p = params.top_p;
      if (params.response_format) body.response_format = params.response_format;
      if (params.stop) body.stop = params.stop;
      if (params.frequency_penalty !== undefined)
        body.frequency_penalty = params.frequency_penalty;
      if (params.presence_penalty !== undefined)
        body.presence_penalty = params.presence_penalty;
      if (params.seed !== undefined) body.seed = params.seed;

      const data = await apiRequest<Record<string, unknown>>(
        "chat/completions",
        "POST",
        body
      );

      const choices = data.choices as Array<{
        message?: { content?: string; role?: string };
        finish_reason?: string;
      }>;
      const usage = data.usage as {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      } | undefined;

      const responseText = choices?.[0]?.message?.content ?? "(no content)";
      const meta = [
        `Model: ${data.model ?? params.model}`,
        `Finish: ${choices?.[0]?.finish_reason ?? "unknown"}`,
      ];
      if (usage) {
        meta.push(
          `Tokens: ${usage.prompt_tokens ?? "?"} in / ${usage.completion_tokens ?? "?"} out / ${usage.total_tokens ?? "?"} total`
        );
      }
      if (data.id) meta.push(`Generation ID: ${data.id}`);

      return textResult(`${responseText}\n\n---\n${meta.join(" | ")}`);
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ── Tool: List Models ──────────────────────────────────────────

const ListModelsSchema = z
  .object({
    search: z
      .string()
      .optional()
      .describe(
        "Filter models by name/ID substring (case-insensitive). E.g. 'gemini', 'claude', 'llama'"
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe("Max models to return (default 20)"),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Skip N models for pagination"),
  })
  .strict();

server.registerTool(
  "openrouter_list_models",
  {
    title: "List Available Models",
    description: `List models available on OpenRouter with optional search filter.

Returns model ID, name, context length, pricing (prompt/completion per million tokens), and supported features. Use search to filter by name.

Args:
  - search: Filter by name substring (optional)
  - limit: Max results, 1-100, default 20
  - offset: Pagination offset, default 0

Returns:
  Paginated list of models with pricing and capabilities.`,
    inputSchema: ListModelsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async (params) => {
    try {
      const data = await apiRequest<{ data: Array<Record<string, unknown>> }>(
        "models"
      );

      let models = data.data ?? [];

      if (params.search) {
        const q = params.search.toLowerCase();
        models = models.filter(
          (m) =>
            String(m.id ?? "")
              .toLowerCase()
              .includes(q) ||
            String(m.name ?? "")
              .toLowerCase()
              .includes(q)
        );
      }

      const total = models.length;
      const sliced = models.slice(params.offset, params.offset + params.limit);

      const lines = [`# Models (${sliced.length} of ${total})`, ""];
      for (const m of sliced) {
        const pricing = m.pricing as {
          prompt?: string;
          completion?: string;
        } | undefined;
        const promptPrice = pricing?.prompt
          ? `$${(parseFloat(pricing.prompt) * 1_000_000).toFixed(2)}/M`
          : "free";
        const compPrice = pricing?.completion
          ? `$${(parseFloat(pricing.completion) * 1_000_000).toFixed(2)}/M`
          : "free";
        lines.push(`## ${m.name ?? m.id}`);
        lines.push(`- **ID**: \`${m.id}\``);
        lines.push(`- **Context**: ${m.context_length ?? "?"} tokens`);
        lines.push(`- **Pricing**: ${promptPrice} in / ${compPrice} out`);
        if (m.top_provider) {
          const tp = m.top_provider as { max_completion_tokens?: number };
          if (tp.max_completion_tokens)
            lines.push(`- **Max output**: ${tp.max_completion_tokens} tokens`);
        }
        lines.push("");
      }

      if (total > params.offset + params.limit) {
        lines.push(
          `*${total - params.offset - params.limit} more models available. Use offset=${params.offset + params.limit} to see next page.*`
        );
      }

      return textResult(lines.join("\n"));
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ── Tool: Get Generation Stats ─────────────────────────────────

const GenerationStatsSchema = z
  .object({
    generation_id: z
      .string()
      .describe(
        "Generation ID from a chat completion response (the 'id' field)"
      ),
  })
  .strict();

server.registerTool(
  "openrouter_get_generation",
  {
    title: "Get Generation Stats",
    description: `Look up token usage and cost for a specific generation.

Use the generation ID returned from openrouter_chat_completion to check exact token counts, cost breakdown, and which model/provider served the request.

Args:
  - generation_id: The ID from a prior chat completion response

Returns:
  Token counts, cost in USD, model used, provider, and latency.`,
    inputSchema: GenerationStatsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const data = await apiRequest<{ data: Record<string, unknown> }>(
        "generation",
        "GET",
        undefined,
        { id: params.generation_id }
      );
      return textResult(JSON.stringify(data.data ?? data, null, 2));
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ── Tool: Get Credits / Key Info ───────────────────────────────

server.registerTool(
  "openrouter_get_credits",
  {
    title: "Get Credit Balance",
    description: `Check your OpenRouter account credit balance and rate limit status.

Returns:
  Current credit balance, usage, rate limits, and key label.`,
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    try {
      const data = await apiRequest<{ data: Record<string, unknown> }>(
        "auth/key"
      );
      const info = data.data ?? data;
      const lines = ["# OpenRouter Account", ""];
      if (info.label) lines.push(`**Key**: ${info.label}`);
      if (info.limit !== undefined && info.limit !== null)
        lines.push(`**Credit Limit**: $${info.limit}`);
      if (info.usage !== undefined)
        lines.push(`**Usage**: $${info.usage}`);
      if (info.limit !== undefined && info.limit !== null && info.usage !== undefined) {
        const remaining =
          (info.limit as number) - (info.usage as number);
        lines.push(`**Remaining**: $${remaining.toFixed(4)}`);
      }
      if (info.is_free_tier !== undefined)
        lines.push(`**Free Tier**: ${info.is_free_tier ? "Yes" : "No"}`);
      if (info.rate_limit)
        lines.push(
          `**Rate Limit**: ${JSON.stringify(info.rate_limit)}`
        );
      return textResult(lines.join("\n"));
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ── Tool: List API Keys ────────────────────────────────────────

const ListKeysSchema = z
  .object({
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Pagination offset"),
  })
  .strict();

server.registerTool(
  "openrouter_list_keys",
  {
    title: "List API Keys",
    description: `List all API keys on your OpenRouter account.

Requires a provisioning-level API key. Returns key hashes, names, limits, and usage stats.

Args:
  - offset: Pagination offset (default 0)

Returns:
  Array of API key objects with metadata.`,
    inputSchema: ListKeysSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const data = await apiRequest<{ data: Array<Record<string, unknown>> }>(
        "keys",
        "GET",
        undefined,
        { offset: params.offset }
      );
      const keys = data.data ?? data;
      return textResult(JSON.stringify(keys, null, 2));
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ── Tool: Create API Key ───────────────────────────────────────

const CreateKeySchema = z
  .object({
    name: z.string().min(1).max(200).describe("Display name for the new key"),
    limit: z
      .number()
      .optional()
      .describe("Credit limit in USD for this key (optional)"),
  })
  .strict();

server.registerTool(
  "openrouter_create_key",
  {
    title: "Create API Key",
    description: `Create a new OpenRouter API key.

Requires a provisioning-level API key.

Args:
  - name: Display name for the key
  - limit: Optional credit limit in USD

Returns:
  The new API key string and metadata. Store the key securely — it cannot be retrieved again.`,
    inputSchema: CreateKeySchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const body: Record<string, unknown> = { name: params.name };
      if (params.limit !== undefined) body.limit = params.limit;
      const data = await apiRequest<Record<string, unknown>>(
        "keys",
        "POST",
        body
      );
      return textResult(JSON.stringify(data, null, 2));
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ── Tool: Update API Key ───────────────────────────────────────

const UpdateKeySchema = z
  .object({
    key_hash: z.string().describe("Hash of the key to update"),
    name: z.string().optional().describe("New display name"),
    disabled: z.boolean().optional().describe("Disable or enable the key"),
    limit: z.number().optional().describe("New credit limit in USD"),
  })
  .strict();

server.registerTool(
  "openrouter_update_key",
  {
    title: "Update API Key",
    description: `Update an existing OpenRouter API key's name, limit, or status.

Args:
  - key_hash: Hash of the key to update (from openrouter_list_keys)
  - name: New display name (optional)
  - disabled: true to disable, false to enable (optional)
  - limit: New credit limit in USD (optional)

Returns:
  Updated key metadata.`,
    inputSchema: UpdateKeySchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const body: Record<string, unknown> = {};
      if (params.name !== undefined) body.name = params.name;
      if (params.disabled !== undefined) body.disabled = params.disabled;
      if (params.limit !== undefined) body.limit = params.limit;
      const data = await apiRequest<Record<string, unknown>>(
        `keys/${params.key_hash}`,
        "PATCH",
        body
      );
      return textResult(JSON.stringify(data, null, 2));
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ── Tool: Delete API Key ───────────────────────────────────────

const DeleteKeySchema = z
  .object({
    key_hash: z.string().describe("Hash of the key to delete"),
  })
  .strict();

server.registerTool(
  "openrouter_delete_key",
  {
    title: "Delete API Key",
    description: `Permanently delete an OpenRouter API key.

This action cannot be undone. The key will immediately stop working.

Args:
  - key_hash: Hash of the key to delete (from openrouter_list_keys)

Returns:
  Confirmation of deletion.`,
    inputSchema: DeleteKeySchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      await apiRequest<unknown>(`keys/${params.key_hash}`, "DELETE");
      return textResult("API key deleted successfully.");
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ── Tool: Get Model Details ────────────────────────────────────

const GetModelSchema = z
  .object({
    model_id: z
      .string()
      .describe(
        'Full model ID, e.g. "google/gemini-2.5-flash" or "anthropic/claude-sonnet-4"'
      ),
  })
  .strict();

server.registerTool(
  "openrouter_get_model",
  {
    title: "Get Model Details",
    description: `Get detailed information about a specific model on OpenRouter.

Returns pricing, context length, supported parameters, top providers, and architecture details.

Args:
  - model_id: Full model identifier (e.g. "google/gemini-2.5-flash")

Returns:
  Complete model metadata including pricing, capabilities, and provider info.`,
    inputSchema: GetModelSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async (params) => {
    try {
      const data = await apiRequest<Record<string, unknown>>(
        `models/${params.model_id}`
      );
      const m = (data as { data?: Record<string, unknown> }).data ?? data;

      const pricing = m.pricing as {
        prompt?: string;
        completion?: string;
      } | undefined;

      const lines = [`# ${m.name ?? m.id}`, ""];
      lines.push(`**ID**: \`${m.id}\``);
      if (m.description)
        lines.push(`**Description**: ${m.description}`);
      lines.push(`**Context**: ${m.context_length ?? "?"} tokens`);
      if (pricing) {
        const promptPrice = pricing.prompt
          ? `$${(parseFloat(pricing.prompt) * 1_000_000).toFixed(2)}/M`
          : "free";
        const compPrice = pricing.completion
          ? `$${(parseFloat(pricing.completion) * 1_000_000).toFixed(2)}/M`
          : "free";
        lines.push(`**Pricing**: ${promptPrice} in / ${compPrice} out`);
      }
      if (m.top_provider) {
        const tp = m.top_provider as Record<string, unknown>;
        if (tp.max_completion_tokens)
          lines.push(`**Max output**: ${tp.max_completion_tokens} tokens`);
        if (tp.is_moderated !== undefined)
          lines.push(`**Moderated**: ${tp.is_moderated}`);
      }
      if (m.architecture) {
        const arch = m.architecture as Record<string, unknown>;
        lines.push(
          `**Architecture**: ${arch.modality ?? "?"} | ${arch.tokenizer ?? "?"} | instruct: ${arch.instruct_type ?? "?"}`
        );
      }
      if (m.supported_parameters) {
        const sp = m.supported_parameters as string[];
        lines.push(`**Supported params**: ${sp.join(", ")}`);
      }

      return textResult(lines.join("\n"));
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ── Start ──────────────────────────────────────────────────────

async function main() {
  try {
    getApiKey();
  } catch {
    console.error(
      "ERROR: OPENROUTER_API_KEY environment variable is required.\n" +
        "Set it before running: export OPENROUTER_API_KEY=sk-or-v1-..."
    );
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("OpenRouter MCP server running via stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
