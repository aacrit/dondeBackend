export interface ClaudeResponse {
  content: Array<{ type: string; text?: string }>;
}

/**
 * Call Claude with optional system prompt caching.
 * When systemPrompt is provided, it's sent via the `system` field with
 * cache_control for Anthropic's prompt caching (5-min server-side TTL).
 *
 * Timeout: Each fetch attempt is guarded by an AbortController (default 8s).
 * Retry: One retry on 5xx/network errors with 1s delay (down from 2s).
 */
export async function callClaude(
  userPrompt: string,
  systemPrompt?: string,
  options?: { maxTokens?: number; temperature?: number; model?: string; timeoutMs?: number }
): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const perCallTimeout = options?.timeoutMs ?? 8000;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };

  const body: Record<string, unknown> = {
    model: options?.model ?? "claude-haiku-4-5-20251001",
    max_tokens: options?.maxTokens ?? 512,
    temperature: options?.temperature ?? 0.7,
    messages: [{ role: "user", content: userPrompt }],
  };

  if (systemPrompt) {
    // Enable prompt caching for the system prompt
    headers["anthropic-beta"] = "prompt-caching-2024-07-31";
    body.system = [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ];
  }

  // Enhancement 19 Tier 3: Retry once on 5xx/timeout errors
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), perCallTimeout);
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const status = response.status;
        // Only retry on 5xx server errors
        if (status >= 500 && attempt === 0) {
          lastError = new Error(`Claude API error ${status}: ${errorText}`);
          console.warn(`Claude API returned ${status}, retrying in 1s...`);
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        throw new Error(`Claude API error ${status}: ${errorText}`);
      }

      const data: ClaudeResponse = await response.json();
      const block = data.content[0];
      return block.type === "text" && block.text ? block.text : "";
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      if (isAbort) {
        lastError = new Error(`Claude API timed out after ${perCallTimeout}ms`);
        if (attempt === 0) {
          console.warn(`Claude API timed out (${perCallTimeout}ms), retrying in 1s...`);
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        throw lastError;
      }
      if (attempt === 0 && !(err instanceof Error && err.message.includes("Claude API error 4"))) {
        // Retry on network/timeout errors, not on 4xx
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn("Claude API call failed, retrying in 1s...");
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error("Claude API failed after retries");
}

export function parseClaudeJson<T>(text: string): T {
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  return JSON.parse(cleaned);
}
