import OpenAI from "openai";
import { defaultProviderEndpoint } from "./provider-endpoints.js";

export interface AIConfig {
  type: string;
  endpoint: string;
  model: string;
  apiKey?: string;
  maxTokens?: number;
  onToken?: (token: string) => void;
}

const DEFAULT_MAX_TOKENS = 1024;

export interface AIResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export class AIClient {
  private client: OpenAI;
  private model: string;
  private providerType: string;
  private maxTokens: number;
  private onToken?: (token: string) => void;
  private usage = { promptTokens: 0, completionTokens: 0 };

  constructor(config: AIConfig) {
    this.model = config.model;
    this.providerType = config.type;
    this.maxTokens = config.maxTokens && config.maxTokens > 0 ? config.maxTokens : DEFAULT_MAX_TOKENS;
    this.onToken = config.onToken;

    // Configure for different providers
    const baseURL = this.getBaseURL(config);
    const apiKey = config.apiKey || "dummy-key-for-local";

    this.client = new OpenAI({
      baseURL,
      apiKey,
    });
  }

  private accumulateUsage(usage?: { promptTokens: number; completionTokens: number }): void {
    if (usage) {
      this.usage.promptTokens += usage.promptTokens;
      this.usage.completionTokens += usage.completionTokens;
    }
  }

  // getUsage returns the cumulative token usage across this client's calls.
  getUsage(): { promptTokens: number; completionTokens: number } {
    return { ...this.usage };
  }

  // OpenAI's current chat models reject `max_tokens` (they require
  // `max_completion_tokens`) and any non-default `temperature`. Other
  // OpenAI-compatible servers — Ollama, Anthropic's compatibility endpoint,
  // local proxies — still expect the classic parameter names.
  private samplingParams(temperature: number): {
    temperature?: number;
    max_tokens?: number;
    max_completion_tokens?: number;
  } {
    if (this.providerType === "openai") {
      return { max_completion_tokens: this.maxTokens };
    }
    return { temperature, max_tokens: this.maxTokens };
  }

  private getBaseURL(config: AIConfig): string {
    if (config.endpoint) {
      return config.endpoint;
    }
    return defaultProviderEndpoint(config.type);
  }

  async generate(prompt: string, systemPrompt?: string): Promise<AIResponse> {
    if (this.onToken) {
      return this.generateStream(prompt, systemPrompt, this.onToken);
    }

    const messages = completionMessages(prompt, systemPrompt);
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      ...this.samplingParams(0.7),
    });

    warnIfTruncated(response.choices?.[0]?.finish_reason, this.maxTokens);

    const usage = usageFrom(response.usage);
    this.accumulateUsage(usage);

    return {
      content: completionContent(response),
      model: response.model,
      usage,
    };
  }

  async generateStream(
    prompt: string,
    systemPrompt?: string,
    onToken?: (token: string) => void
  ): Promise<AIResponse> {
    const messages = completionMessages(prompt, systemPrompt);
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      ...this.samplingParams(0.7),
      stream: true,
      // Ask for a final usage chunk so streamed runs are counted in stats.
      stream_options: { include_usage: true },
    });

    let content = "";
    let model = this.model;
    let finishReason: string | null | undefined;
    let usage: AIResponse["usage"];

    for await (const chunk of stream) {
      if (chunk.model) {
        model = chunk.model;
      }
      usage = usageFrom(chunk.usage) ?? usage;
      finishReason = chunk.choices?.[0]?.finish_reason ?? finishReason;
      const token = chunk.choices?.[0]?.delta?.content;
      if (!token) {
        continue;
      }
      content += token;
      onToken?.(token);
    }

    warnIfTruncated(finishReason, this.maxTokens);

    this.accumulateUsage(usage);

    if (content === "") {
      throw new Error("provider returned no completion choices");
    }

    return { content, model, usage };
  }

  async generateWithImage(
    prompt: string,
    imageBase64: string,
    imageMime = "image/png",
    systemPrompt?: string
  ): Promise<AIResponse> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }

    const imageUrl = `data:${imageMime};base64,${imageBase64}`;
    messages.push({
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    });

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      ...this.samplingParams(0.2),
    });

    warnIfTruncated(response.choices?.[0]?.finish_reason, this.maxTokens);

    const usage = usageFrom(response.usage);
    this.accumulateUsage(usage);

    return {
      content: completionContent(response),
      model: response.model,
      usage,
    };
  }

  async summarize(text: string): Promise<string> {
    const response = await this.generate(
      `Summarize the following text concisely:\n\n${text}`,
      "You are a helpful assistant that provides clear, concise summaries."
    );
    return response.content;
  }

  async explain(text: string): Promise<string> {
    const response = await this.generate(
      `Explain the following:\n\n${text}`,
      "You are a helpful assistant that explains things clearly. If this looks like code, explain what it does."
    );
    return response.content;
  }

  async translate(text: string, targetLang: string): Promise<string> {
    const response = await this.generate(
      `Translate the following to ${targetLang}:\n\n${text}`,
      "You are a translator. Only output the translation, nothing else."
    );
    return response.content;
  }

  async improve(text: string): Promise<string> {
    const response = await this.generate(
      `Improve the following writing for clarity and style:\n\n${text}`,
      "You are an editor. Improve the text while preserving its meaning. Only output the improved text."
    );
    return response.content;
  }

  async extractData(text: string): Promise<string> {
    const response = await this.generateJSON(
      `Extract structured data from the following text as JSON:\n\n${text}`,
      "You are a data extraction assistant. Extract key information as a JSON object."
    );
    return validateJSON(response.content, "data extraction");
  }

  async classify(text: string): Promise<string> {
    const response = await this.generateJSON(
      `Classify this content:\n\n${text}`,
      'You are a content classifier. Categorize the given text into exactly one of these categories: email, code, url, log, article, chat, command, data, error, other. Respond with JSON only: {"category": "...", "confidence": 0.0-1.0, "reasoning": "..."}'
    );
    const content = validateJSON(response.content, "classification");
    const parsed = JSON.parse(content) as { category?: unknown };
    if (typeof parsed.category !== "string") {
      throw new Error("classifier response is missing a 'category' field");
    }
    return content;
  }

  // generateJSON requests a JSON object via response_format, falling back to a
  // plain completion only when the provider rejects that parameter.
  async generateJSON(prompt: string, systemPrompt?: string): Promise<AIResponse> {
    const messages = completionMessages(prompt, systemPrompt);
    let response;
    try {
      response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        ...this.samplingParams(0.2),
        response_format: { type: "json_object" },
      });
    } catch (err) {
      // "Bad request"-class statuses mean the provider does not support
      // response_format. Anything else (auth, rate limit, network, server
      // error) would fail again, so let it surface instead of retrying.
      const status = (err as { status?: unknown }).status;
      if (status === 400 || status === 404 || status === 422 || status === 501) {
        return this.generate(prompt, systemPrompt);
      }
      throw err;
    }

    warnIfTruncated(response.choices?.[0]?.finish_reason, this.maxTokens);
    const usage = usageFrom(response.usage);
    this.accumulateUsage(usage);
    return {
      content: completionContent(response),
      model: response.model,
      usage,
    };
  }

  async captionImage(imageBase64: string, imageMime?: string): Promise<string> {
    const response = await this.generateWithImage(
      "Write a concise caption for this image.",
      imageBase64,
      imageMime,
      "You are a helpful assistant that captions images clearly and concisely."
    );
    return response.content;
  }

  async ocrImage(imageBase64: string, imageMime?: string): Promise<string> {
    const response = await this.generateWithImage(
      "Extract all readable text from this image. Return only the text.",
      imageBase64,
      imageMime,
      "You are an OCR assistant. Extract text exactly as it appears. Do not add commentary."
    );
    return response.content;
  }
}

function completionMessages(
  prompt: string,
  systemPrompt?: string
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }

  messages.push({ role: "user", content: prompt });
  return messages;
}

// warnIfTruncated alerts (on stderr) when the model stopped because it hit the
// token cap, so a silently-cut summary/OCR/extraction is at least visible.
export function warnIfTruncated(finishReason: string | null | undefined, maxTokens: number): void {
  if (finishReason === "length") {
    console.error(
      `Warning: output was truncated at max_tokens=${maxTokens}. Raise max_tokens (settings or per-action) for a complete result.`
    );
  }
}

function usageFrom(
  usage: { prompt_tokens?: number; completion_tokens?: number } | null | undefined
): AIResponse["usage"] {
  if (!usage) {
    return undefined;
  }
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
  };
}

// validateJSON ensures a model response is parseable JSON, returning a clear
// error (rather than raw text) when it isn't.
function validateJSON(content: string, label: string): string {
  try {
    JSON.parse(content);
    return content;
  } catch {
    throw new Error(`${label} did not return valid JSON`);
  }
}

function completionContent(response: OpenAI.Chat.ChatCompletion): string {
  const content = response.choices?.[0]?.message?.content;
  if (content === undefined || content === null) {
    throw new Error("provider returned no completion choices");
  }
  return content;
}
