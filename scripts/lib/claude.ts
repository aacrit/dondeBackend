import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** Remove unpaired UTF-16 surrogates that would produce invalid JSON */
export function sanitizeUnicode(str: string): string {
  let result = "";
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate — keep only if followed by a low surrogate
      const next = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += str[i] + str[i + 1];
        i++; // skip the low surrogate we already consumed
      }
      // else: drop the orphaned high surrogate
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // Orphaned low surrogate — drop it
    } else {
      result += str[i];
    }
  }
  return result;
}

export async function askClaude(
  prompt: string,
  options?: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
  }
): Promise<string> {
  const response = await client.messages.create({
    model: options?.model ?? "claude-haiku-4-5-20251001",
    max_tokens: options?.maxTokens ?? 4096,
    temperature: options?.temperature ?? 0.3,
    messages: [{ role: "user", content: sanitizeUnicode(prompt) }],
  });

  const block = response.content[0];
  return block.type === "text" ? block.text : "";
}

export function parseJsonResponse<T>(text: string): T {
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  // Extract the first complete JSON object by matching balanced braces
  const start = cleaned.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in response");

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return JSON.parse(cleaned.substring(start, i + 1));
      }
    }
  }

  // Fallback: try parsing the whole cleaned string
  return JSON.parse(cleaned);
}
