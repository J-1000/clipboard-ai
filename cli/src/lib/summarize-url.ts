import { lookup } from "dns/promises";
import { BlockList, isIP } from "net";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_FETCH_BYTES = 2 << 20; // 2 MB streaming cap
// Prompt budget: a 2 MB page would blow the model's context and cost, so the
// extracted text is truncated before it reaches the LLM (see also max_tokens).
const MAX_PROMPT_CHARS = 12_000;
const ALLOWED_CONTENT_TYPES = ["text/html", "text/plain"] as const;

export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

export interface FetchedURLText {
  body: string;
  contentType: AllowedContentType;
}

// Injectable DNS resolver so the SSRF guard is testable without real network.
export type HostResolver = (host: string) => Promise<string[]>;

const defaultResolver: HostResolver = async (host) => {
  const results = await lookup(host, { all: true });
  return results.map((r) => r.address);
};

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

// Address ranges we refuse to fetch from, to prevent SSRF against loopback, the
// cloud metadata endpoint, and internal networks. net.BlockList compares real
// address bytes, so every textual form of an address is covered — including
// IPv4-mapped IPv6 such as ::ffff:7f00:1, which is checked against the IPv4
// rules.
const NON_PUBLIC_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. 169.254.169.254 metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  NON_PUBLIC_ADDRESSES.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 96], // unspecified, loopback, IPv4-compatible
  ["64:ff9b::", 96], // NAT64 (embeds an IPv4 address)
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard-only
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 (embeds an IPv4 address)
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
] as const) {
  NON_PUBLIC_ADDRESSES.addSubnet(network, prefix, "ipv6");
}

// isBlockedAddress reports whether an IP literal is one we refuse to fetch
// from. Anything that is not an IP literal returns false; the caller resolves
// hostnames first and checks each resulting address.
export function isBlockedAddress(ip: string): boolean {
  const address = ip.split("%")[0]; // strip an IPv6 zone id
  const family = isIP(address);
  if (family === 4) {
    return NON_PUBLIC_ADDRESSES.check(address, "ipv4");
  }
  if (family === 6) {
    return NON_PUBLIC_ADDRESSES.check(address, "ipv6");
  }
  return false;
}

// assertPublicURL throws if the URL targets a non-public host. Hostnames are
// resolved and every returned address is checked.
export async function assertPublicURL(url: URL, resolver: HostResolver = defaultResolver): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  const lowered = host.toLowerCase();
  if (lowered === "localhost" || lowered.endsWith(".localhost")) {
    throw new Error(`Refusing to fetch internal host: ${host}`);
  }

  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new Error(`Refusing to fetch non-public address: ${host}`);
    }
    return;
  }

  let addresses: string[];
  try {
    addresses = await resolver(host);
  } catch {
    throw new Error(`Could not resolve host: ${host}`);
  }
  if (addresses.length === 0) {
    throw new Error(`Could not resolve host: ${host}`);
  }
  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      throw new Error(`Refusing to fetch host resolving to non-public address: ${host} -> ${address}`);
    }
  }
}

export async function fetchURLText(url: URL, resolver: HostResolver = defaultResolver): Promise<FetchedURLText> {
  await assertPublicURL(url, resolver);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      // Transparent redirects could send us inward (public URL -> 30x ->
      // 169.254.169.254); reject them rather than re-resolving each hop.
      redirect: "manual",
      headers: { Accept: "text/html,text/plain" },
    });

    if (response.status >= 300 && response.status < 400) {
      throw new Error("URL responded with a redirect; refusing to follow it");
    }
    if (!response.ok) {
      throw new Error(`URL fetch failed with status ${response.status}`);
    }

    const contentTypeHeader = response.headers.get("content-type") ?? "";
    const contentType = ALLOWED_CONTENT_TYPES.find((type) =>
      contentTypeHeader.toLowerCase().startsWith(type)
    );
    if (!contentType) {
      throw new Error("URL response must be text/html or text/plain");
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_FETCH_BYTES) {
      throw new Error("URL response exceeds 2 MB limit");
    }

    return { body: await readResponseBody(response, MAX_FETCH_BYTES), contentType };
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
    if (done) break;
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

// htmlToText strips boilerplate containers and tags, then decodes entities.
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return decodeHTMLEntities(stripped);
}

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, dec: string) => safeFromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => safeFromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
    return "";
  }
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

export interface SummarizeUrlText {
  url: URL;
  text: string;
}

// extractSummaryInput resolves the clipboard text into a fetched, cleaned, and
// budget-truncated body ready to send to the model.
export async function extractSummaryInput(
  clipboardText: string,
  resolver: HostResolver = defaultResolver
): Promise<SummarizeUrlText> {
  const url = parseSingleURL(clipboardText);
  if (!url) {
    throw new Error("Clipboard text must be a single http(s) URL");
  }
  const fetched = await fetchURLText(url, resolver);
  let text = fetched.contentType === "text/html" ? htmlToText(fetched.body) : fetched.body.trim();
  if (text.length === 0) {
    throw new Error("Fetched URL did not contain readable text");
  }
  if (text.length > MAX_PROMPT_CHARS) {
    text = `${text.slice(0, MAX_PROMPT_CHARS)} …[truncated]`;
  }
  return { url, text };
}

export { MAX_PROMPT_CHARS, MAX_FETCH_BYTES };
