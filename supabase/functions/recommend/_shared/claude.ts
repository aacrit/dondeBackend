export interface ClaudeResponse {
  content: Array<{ type: string; text?: string }>;
}

/**
 * Call Claude with optional system prompt caching.
 * When systemPrompt is provided, it's sent via the `system` field with
 * cache_control for Anthropic's prompt caching (5-min server-side TTL).
 */
export async function callClaude(
  userPrompt: string,
  systemPrompt?: string
): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };

  const body: Record<string, unknown> = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    temperature: 0.7,
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

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errorText}`);
  }

  const data: ClaudeResponse = await response.json();
  const block = data.content[0];
  return block.type === "text" && block.text ? block.text : "";
}

export function parseClaudeJson<T>(text: string): T {
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  return JSON.parse(cleaned);
}
