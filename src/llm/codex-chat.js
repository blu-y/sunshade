// Minimal Codex (ChatGPT backend) responses caller.
// Uses ChatGPT OAuth access token + account id to hit the codex backend endpoint.

const fs = require("fs");
const path = require("path");

const CODEX_URL = "https://chatgpt.com/backend-api/codex/responses";
const DEFAULT_MODEL = "gpt-5.1-codex";
const DEFAULT_INSTRUCTIONS =
  "You are Sunshade, a concise research assistant. Answer clearly and cite only when confident.";
const INSTRUCTIONS_PATH = path.join(__dirname, "prompts.json");

async function codexChatCompletion(accessToken, accountId, question, instructionOverride) {
  if (!accessToken) throw new Error("Missing access token");
  if (!accountId) throw new Error("Missing ChatGPT account id");
  if (!question) throw new Error("Question is empty");

  const body = {
    model: DEFAULT_MODEL,
    instructions: instructionOverride || loadInstructions(),
    // Responses API shape (similar to OpenAI Responses), stream required by backend
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

  const json = await sseToJson(res);
  const reply = extractText(json);
  if (!reply) throw new Error("No reply received from Codex backend");
  return { reply, model: json.model || DEFAULT_MODEL, usage: json.usage };
}

async function sseToJson(response) {
  if (!response.body) throw new Error("Empty response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let final = null;
  const filteredForLog = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    full += decoder.decode(value, { stream: true });
  }

  const lines = full.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const event = JSON.parse(payload);
      // Keep small log but skip noisy delta events
      if (event.type === "response.completed") {
        filteredForLog.push(payload);
      }

      // Use only response.completed payload as the final response
      if (event.type === "response.completed") {
        final = event.response || event;
      } else if (!final && event.type === "response.output_text.done" && typeof event.text === "string") {
        final = { output_text: [event.text] };
      }
      // All other event types are ignored intentionally
    } catch {
      // ignore malformed lines
    }
  }

  if (filteredForLog.length) {
    // Log only the final response.completed event for debugging
    console.log("[codex] sse (completed):", filteredForLog.join("\n"));
  }

  // Prefer full final response if present
  if (final) {
    return final;
  }
  throw new Error("Failed to parse Codex SSE response (no response.completed event)");
}

function extractText(obj) {
  if (!obj || typeof obj !== "object") return null;

  // Common shapes: {output_text: ["..."]}, {output:[{content:[{text:""}]}]}, {message:{content:[{text:""}]}}, {content:[{text:""}]}
  if (Array.isArray(obj.output_text) && obj.output_text.length) {
    return obj.output_text.join("");
  }

  if (Array.isArray(obj.output)) {
    for (const item of obj.output) {
      if (Array.isArray(item.content)) {
        const text = item.content.map((p) => p.text || p.value || "").filter(Boolean).join("");
        if (text) return text;
      }
    }
  }

  if (obj.message?.content) {
    const parts = obj.message.content;
    const text = Array.isArray(parts)
      ? parts.map((p) => p.text || p.value || "").filter(Boolean).join("")
      : typeof parts === "string"
        ? parts
        : "";
    if (text) return text;
  }

  if (Array.isArray(obj.content)) {
    const text = obj.content.map((p) => p.text || "").filter(Boolean).join("");
    if (text) return text;
  }

  // Fallback: pick the first string found in any nested 'text' field
  const found = deepFindText(obj);
  return found || null;
}

function deepFindText(node) {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return null;
  if (node.text && typeof node.text === "string") return node.text;
  for (const key of Object.keys(node)) {
    const v = node[key];
    const res = deepFindText(v);
    if (res) return res;
  }
  return null;
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

module.exports = { codexChatCompletion };
