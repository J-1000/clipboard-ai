import type { ActionDefinition } from "./action-types.js";
import { extractSummaryInput } from "./summarize-url.js";

export const builtinActions: ActionDefinition[] = [
  {
    id: "summary",
    aliases: ["summarize", "sum"],
    description: "Summarize clipboard content",
    inputTypes: ["text"],
    progressMessage: "Summarizing clipboard content...",
    outputTitle: "Summary",
    run: ({ ai, text }) => ai.summarize(text),
  },
  {
    id: "explain",
    description: "Explain clipboard content (good for code)",
    inputTypes: ["text"],
    progressMessage: "Explaining clipboard content...",
    outputTitle: "Explanation",
    run: ({ ai, text }) => ai.explain(text),
  },
  {
    id: "translate",
    description: "Translate clipboard to target language",
    inputTypes: ["text"],
    progressMessage: "Translating clipboard content...",
    outputTitle: "Translation",
    run: ({ ai, text, args }) => ai.translate(text, args[0] ?? "English"),
  },
  {
    id: "improve",
    description: "Improve writing in clipboard",
    inputTypes: ["text"],
    progressMessage: "Improving writing...",
    outputTitle: "Improved",
    run: ({ ai, text }) => ai.improve(text),
  },
  {
    id: "extract",
    description: "Extract structured data from clipboard",
    inputTypes: ["text"],
    progressMessage: "Extracting structured data...",
    outputTitle: "Extracted Data",
    run: ({ ai, text }) => ai.extractData(text),
  },
  {
    id: "tldr",
    description: "Get a very brief summary (1-2 sentences)",
    inputTypes: ["text"],
    progressMessage: "Summarizing (TL;DR)...",
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
    inputTypes: ["text"],
    progressMessage: "Classifying clipboard content...",
    outputTitle: "Classification",
    run: ({ ai, text }) => ai.classify(text),
  },
  {
    id: "summarize_url",
    aliases: ["summarize-url"],
    description: "Fetch a URL from the clipboard and summarize its contents",
    inputTypes: ["text"],
    progressMessage: "Fetching and summarizing URL...",
    outputTitle: "URL Summary",
    run: async ({ ai, text }) => {
      const { url, text: extracted } = await extractSummaryInput(text);
      const response = await ai.generate(
        `Summarize the following text from ${url}:\n\n${extracted}`,
        "You are a helpful assistant. Provide concise summaries."
      );
      return response.content;
    },
  },
  {
    id: "caption",
    aliases: ["describe", "describe-image"],
    description: "Generate a caption for a clipboard image",
    inputTypes: ["image"],
    progressMessage: "Captioning clipboard image...",
    outputTitle: "Caption",
    run: ({ ai, imageBase64, imageMime }) => {
      if (!imageBase64) {
        throw new Error("No image available on clipboard");
      }
      return ai.captionImage(imageBase64, imageMime);
    },
  },
  {
    id: "ocr",
    aliases: ["extract-text"],
    description: "Extract text from a clipboard image",
    inputTypes: ["image"],
    progressMessage: "Extracting text from image...",
    outputTitle: "OCR",
    run: ({ ai, imageBase64, imageMime }) => {
      if (!imageBase64) {
        throw new Error("No image available on clipboard");
      }
      return ai.ocrImage(imageBase64, imageMime);
    },
  },
];
