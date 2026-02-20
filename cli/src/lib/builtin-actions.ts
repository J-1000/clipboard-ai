import type { ActionDefinition } from "./action-types.js";

export const builtinActions: ActionDefinition[] = [
  {
    id: "summary",
    aliases: ["summarize", "sum"],
    description: "Summarize clipboard content",
    progressMessage: "Summarizing clipboard content...",
    outputTitle: "Summary",
    run: ({ ai, text }) => ai.summarize(text),
  },
  {
    id: "explain",
    description: "Explain clipboard content (good for code)",
    progressMessage: "Explaining clipboard content...",
    outputTitle: "Explanation",
    run: ({ ai, text }) => ai.explain(text),
  },
  {
    id: "translate",
    description: "Translate clipboard to target language",
    progressMessage: "Translating clipboard content...",
    outputTitle: "Translation",
    run: ({ ai, text, args }) => ai.translate(text, args[0] ?? "English"),
  },
  {
    id: "improve",
    description: "Improve writing in clipboard",
    progressMessage: "Improving writing...",
    outputTitle: "Improved",
    run: ({ ai, text }) => ai.improve(text),
  },
  {
    id: "extract",
    description: "Extract structured data from clipboard",
    progressMessage: "Extracting structured data...",
    outputTitle: "Extracted Data",
    run: ({ ai, text }) => ai.extractData(text),
  },
  {
    id: "tldr",
    description: "Get a very brief summary (1-2 sentences)",
    outputTitle: "TL;DR",
    run: async ({ ai, text }) => {
      const response = await ai.generate(
        `Give a very brief TL;DR (1-2 sentences max) of this:\n\n${text}`,
        "You provide extremely brief summaries. Be concise."
      );
      return response.content;
    },
  },
  {
    id: "classify",
    description: "Classify clipboard content by type",
    progressMessage: "Classifying clipboard content...",
    outputTitle: "Classification",
    run: ({ ai, text }) => ai.classify(text),
  },
];
