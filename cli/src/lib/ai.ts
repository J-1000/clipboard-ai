import OpenAI from "openai";

export interface AIConfig {
  type: string;
  endpoint: string;
  model: string;
  apiKey?: string;
}

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

  constructor(config: AIConfig) {
    if (config.type === "anthropic") {
      throw new Error(
        'Provider type "anthropic" is not supported. Use an OpenAI-compatible endpoint or switch providers.'
      );
    }

    this.model = config.model;

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
        return "https://api.anthropic.com/v1";
      default:
        return "http://localhost:11434/v1";
    }
  }

  async generate(prompt: string, systemPrompt?: string): Promise<AIResponse> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }

    messages.push({ role: "user", content: prompt });

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: 0.7,
      max_tokens: 1024,
    });

    const choice = response.choices[0];
    return {
      content: choice.message.content || "",
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
}
