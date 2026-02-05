// Minimal Codex (ChatGPT backend) responses caller.
// Uses ChatGPT OAuth access token + account id to hit the codex backend endpoint.

const fs = require("fs");
const path = require("path");

const CODEX_URL = "https://chatgpt.com/backend-api/codex/responses";
const DEFAULT_MODEL = "gpt-5.1-codex";
const DEFAULT_INSTRUCTIONS =
  "You are Sunshade, a concise research assistant. Answer clearly and cite only when confident.";
const INSTRUCTIONS_PATH = path.join(__dirname, "prompts.json");

/**
 * Streaming completion: yields chunks of text as they arrive.
 */
async function* codexChatCompletionStream(accessToken, accountId, question, instructionOverride, modelOverride) {
  if (!accessToken) throw new Error("Missing access token");
  if (!accountId) throw new Error("Missing ChatGPT account id");
  if (!question) throw new Error("Question is empty");

  const body = {
    model: modelOverride || DEFAULT_MODEL,
    instructions: instructionOverride || loadInstructions(),
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: question }],
      },
    ],
    stream: true,
    store: false,
  };

  const res = await fetch(CODEX_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "chatgpt-account-id": accountId,
      "OpenAI-Beta": "responses=experimental",
      originator: "codex_cli_rs",
      "Content-Type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Codex error ${res.status}: ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      
      const lines = buffer.split("\n");
      // Process all complete lines
      buffer = lines.pop() || ""; // Keep the last partial line

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        try {
          const event = JSON.parse(payload);
          
          // Case 1: response.output_text.delta (streaming text)
          if (event.type === "response.output_text.delta" && event.delta) {
             yield event.delta;
          }
          // Case 2: response.text.delta (sometimes used)
          else if (event.type === "response.text.delta" && event.delta) {
            yield event.delta;
          }
        } catch {
          // ignore malformed lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Keep the non-streaming version for compatibility if needed (wraps the stream)
async function codexChatCompletion(accessToken, accountId, question, instructionOverride, modelOverride) {
  let fullText = "";
  for await (const chunk of codexChatCompletionStream(accessToken, accountId, question, instructionOverride, modelOverride)) {
    fullText += chunk;
  }
  return { reply: fullText, model: modelOverride || DEFAULT_MODEL };
}

function loadInstructions() {
  try {
    const content = fs.readFileSync(INSTRUCTIONS_PATH, "utf8");
    const json = JSON.parse(content);
    const instruction =
      (typeof json.system === "string" && json.system) ||
      (typeof json.default === "string" && json.default) ||
      null;
    if (instruction && instruction.trim()) return instruction.trim();
  } catch {
    return DEFAULT_INSTRUCTIONS;
  }
  return DEFAULT_INSTRUCTIONS;
}

module.exports = { codexChatCompletion, codexChatCompletionStream };
