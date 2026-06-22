// Single source of truth for provider default endpoints so the AI client and
// `cbai doctor` probe the exact same URL (a trailing-slash mismatch previously
// made doctor check a different URL than the client actually used).
export function defaultProviderEndpoint(type: string): string {
  switch (type) {
    case "openai":
      return "https://api.openai.com/v1";
    case "anthropic":
      return "https://api.anthropic.com/v1/";
    case "ollama":
    default:
      return "http://localhost:11434/v1";
  }
}
