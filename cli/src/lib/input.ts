import { readFileSync, unlinkSync } from "fs";
import { getClipboard } from "./client.js";

export interface InputPayload {
  text: string;
  rtf?: string;
  imageBase64?: string;
  imageMime?: string;
  type?: string;
}

export async function getInput(): Promise<InputPayload> {
  const envType = process.env.CBAI_INPUT_TYPE;

  if (process.env.CBAI_INPUT_STDIN === "json") {
    const payload = parseStdinInput(readFileSync(0, "utf8"));
    return { ...payload, type: envType };
  }

  // Legacy environment payloads remain readable so a newly updated CLI still
  // works with older agents. Current agents use the bounded stdin envelope.
  const envText = process.env.CBAI_INPUT_TEXT;
  const envRtf = process.env.CBAI_INPUT_RTF;
  const envImageBase64 = process.env.CBAI_INPUT_IMAGE_BASE64;
  const envImageMime = process.env.CBAI_INPUT_IMAGE_MIME;
  const envImagePath = process.env.CBAI_INPUT_IMAGE_PATH;

  if (
    envText !== undefined ||
    envRtf !== undefined ||
    envImageBase64 !== undefined ||
    envImagePath !== undefined
  ) {
    let imageBase64 = envImageBase64;
    if (!imageBase64 && envImagePath) {
      const buffer = readFileSync(envImagePath);
      imageBase64 = buffer.toString("base64");
      try {
        unlinkSync(envImagePath);
      } catch {
        // ignore cleanup errors
      }
    }

    return {
      text: envText ?? "",
      rtf: envRtf,
      imageBase64,
      imageMime: envImageMime,
      type: envType,
    };
  }

  const clipboard = await getClipboard();
  return {
    text: clipboard.text,
    rtf: clipboard.rtf,
    imageBase64: clipboard.image_base64,
    imageMime: clipboard.image_mime,
    type: clipboard.type,
  };
}

function parseStdinInput(raw: string): Pick<InputPayload, "text" | "rtf"> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Invalid clipboard input received from agent stdin");
  }

  if (!value || typeof value !== "object") {
    throw new Error("Invalid clipboard input received from agent stdin");
  }

  const text = "text" in value ? (value as { text?: unknown }).text : "";
  const rtf = "rtf" in value ? (value as { rtf?: unknown }).rtf : undefined;
  if (typeof text !== "string" || (rtf !== undefined && typeof rtf !== "string")) {
    throw new Error("Invalid clipboard input received from agent stdin");
  }

  return { text, rtf };
}
