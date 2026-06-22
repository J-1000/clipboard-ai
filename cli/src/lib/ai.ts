import OpenAI from "openai";

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
  private maxTokens: number;
  private onToken?: (token: string) => void;

  constructor(config: AIConfig) {
    this.model = config.model;
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

  private getBaseURL(config: AIConfig): string {
    if (config.endpoint) {
      return config.endpoint;
    }

    switch (config.type) {
      case "ollama":
        return "http://localhost:11434/v1";
      case "openai":
        return "https://api.openai.com/v1";
      case "anthropic":
        return "https://api.anthropic.com/v1/";
      default:
        return "http://localhost:11434/v1";
    }
  }

  async generate(prompt: string, systemPrompt?: string): Promise<AIResponse> {
    if (this.onToken) {
      return this.generateStream(prompt, systemPrompt, this.onToken);
    }

    const messages = completionMessages(prompt, systemPrompt);
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: 0.7,
      max_tokens: this.maxTokens,
    });

    warnIfTruncated(response.choices?.[0]?.finish_reason, this.maxTokens);

    return {
      content: completionContent(response),
      model: response.model,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
          }
        : undefined,
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
      temperature: 0.7,
      max_tokens: this.maxTokens,
      stream: true,
    });

    let content = "";
    let model = this.model;
    let finishReason: string | null | undefined;

    for await (const chunk of stream) {
      if (chunk.model) {
        model = chunk.model;
      }
      finishReason = chunk.choices?.[0]?.finish_reason ?? finishReason;
      const token = chunk.choices?.[0]?.delta?.content;
      if (!token) {
        continue;
      }
      content += token;
      onToken?.(token);
    }

    warnIfTruncated(finishReason, this.maxTokens);

    return { content, model };
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
      temperature: 0.2,
      max_tokens: this.maxTokens,
    });

    warnIfTruncated(response.choices?.[0]?.finish_reason, this.maxTokens);

    return {
      content: completionContent(response),
      model: response.model,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
          }
        : undefined,
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
    const response = await this.generate(
      `Extract structured data from the following text. Output as JSON if applicable:\n\n${text}`,
      "You are a data extraction assistant. Extract key information in a structured format."
    );
    return response.content;
  }

  async classify(text: string): Promise<string> {
    const response = await this.generate(
      `Classify this content:\n\n${text}`,
      'You are a content classifier. Categorize the given text into exactly one of these categories: email, code, url, log, article, chat, command, data, error, other. Respond with JSON only: {"category": "...", "confidence": 0.0-1.0, "reasoning": "..."}'
    );
    return response.content;
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

function completionContent(response: OpenAI.Chat.ChatCompletion): string {
  const content = response.choices?.[0]?.message?.content;
  if (content === undefined || content === null) {
    throw new Error("provider returned no completion choices");
  }
  return content;
}
