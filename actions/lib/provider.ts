export function isOpenAICompatibleProvider(providerType: string): boolean {
  return providerType !== "anthropic";
}

export function openAICompatibilityError(providerType: string): string {
  return `Provider type "${providerType}" is not supported. Use an OpenAI-compatible endpoint or switch providers.`;
}
