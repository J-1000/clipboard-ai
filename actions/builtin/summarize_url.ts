import type { Action, ActionContext, ActionResult } from "../lib/types.js";
import { executeAIAction } from "../lib/execute.js";

const fetchTimeoutMs = 10_000;
const maxFetchBytes = 2 << 20;
const allowedContentTypes = ["text/html", "text/plain"];

export const summarizeUrl: Action = {
  metadata: {
    id: "summarize_url",
    name: "Summarize URL",
    description: "Fetch and summarize a URL from clipboard text",
    triggers: [],
  },

  async execute(ctx: ActionContext): Promise<ActionResult> {
    const url = parseSingleURL(ctx.text);
    if (!url) {
      return {
        success: false,
        error: "Clipboard text must be a single http(s) URL",
      };
    }

    try {
      const fetched = await fetchURLText(url);
      const text =
        fetched.contentType === "text/html"
          ? htmlToText(fetched.body)
          : fetched.body.trim();

      if (text.length === 0) {
        return {
          success: false,
          error: "Fetched URL did not contain readable text",
        };
      }

      return executeAIAction(ctx, {
        systemPrompt: "You are a helpful assistant. Provide concise summaries.",
        userPrompt: `Summarize the following text from ${url.toString()}:\n\n${text}`,
        maxTokens: 512,
      });
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
      };
    }
  },
};

export default summarizeUrl;

export interface FetchedURLText {
  body: string;
  contentType: "text/html" | "text/plain";
}

export function parseSingleURL(text: string): URL | null {
  const trimmed = text.trim();
  if (trimmed === "" || /\s/.test(trimmed)) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export async function fetchURLText(url: URL): Promise<FetchedURLText> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "text/html,text/plain",
      },
    });

    if (!response.ok) {
      throw new Error(`URL fetch failed with status ${response.status}`);
    }

    const contentTypeHeader = response.headers.get("content-type") ?? "";
    const contentType = allowedContentTypes.find((type) =>
      contentTypeHeader.toLowerCase().startsWith(type)
    );
    if (!contentType) {
      throw new Error("URL response must be text/html or text/plain");
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > maxFetchBytes) {
      throw new Error("URL response exceeds 2 MB limit");
    }

    return {
      body: await readResponseBody(response, maxFetchBytes),
      contentType: contentType as "text/html" | "text/plain",
    };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error("URL fetch timed out after 10s");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    return await response.text();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let body = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      await reader.cancel();
      throw new Error("URL response exceeds 2 MB limit");
    }
    body += decoder.decode(value, { stream: true });
  }

  body += decoder.decode();
  return body;
}

export function htmlToText(html: string): string {
  return decodeHTMLEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
