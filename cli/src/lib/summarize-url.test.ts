import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  assertPublicURL,
  extractSummaryInput,
  fetchURLText,
  htmlToText,
  isBlockedAddress,
  parseSingleURL,
  MAX_PROMPT_CHARS,
} from "./summarize-url.js";

const publicResolver = async () => ["93.184.216.34"]; // example.com

afterEach(() => {
  mock.restore();
});

describe("parseSingleURL", () => {
  it("accepts a single http(s) URL", () => {
    expect(parseSingleURL("https://example.com/page")?.toString()).toBe("https://example.com/page");
    expect(parseSingleURL("  http://example.com  ")?.hostname).toBe("example.com");
  });

  it("rejects multi-token text, non-http schemes, and junk", () => {
    expect(parseSingleURL("read https://example.com")).toBeNull();
    expect(parseSingleURL("ftp://example.com")).toBeNull();
    expect(parseSingleURL("file:///etc/passwd")).toBeNull();
    expect(parseSingleURL("not a url")).toBeNull();
    expect(parseSingleURL("")).toBeNull();
  });
});

describe("isBlockedAddress", () => {
  it("blocks loopback, link-local/metadata, and private ranges", () => {
    for (const ip of ["127.0.0.1", "169.254.169.254", "10.0.0.5", "172.16.9.9", "192.168.1.1", "0.0.0.0", "100.64.0.1"]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
    expect(isBlockedAddress("::1")).toBe(true);
    expect(isBlockedAddress("fc00::1")).toBe(true);
    expect(isBlockedAddress("fe80::1")).toBe(true);
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("allows public addresses", () => {
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    expect(isBlockedAddress("1.1.1.1")).toBe(false);
    expect(isBlockedAddress("93.184.216.34")).toBe(false);
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
  });
});

describe("assertPublicURL", () => {
  it("rejects localhost and literal internal IPs without DNS", async () => {
    await expect(assertPublicURL(new URL("http://localhost:11434/"))).rejects.toThrow(/internal host/);
    await expect(assertPublicURL(new URL("http://169.254.169.254/latest/meta-data/"))).rejects.toThrow(
      /non-public address/
    );
    await expect(assertPublicURL(new URL("http://127.0.0.1:9159/"))).rejects.toThrow(/non-public/);
  });

  it("rejects hostnames that resolve to internal addresses", async () => {
    const rebind = async () => ["169.254.169.254"];
    await expect(assertPublicURL(new URL("http://evil.example.com/"), rebind)).rejects.toThrow(
      /non-public address/
    );
  });

  it("allows hostnames resolving only to public addresses", async () => {
    await expect(assertPublicURL(new URL("https://example.com/"), publicResolver)).resolves.toBeUndefined();
  });
});

describe("fetchURLText", () => {
  function mockFetch(impl: () => Response | Promise<Response>) {
    globalThis.fetch = mock(impl) as unknown as typeof fetch;
  }

  it("refuses to follow redirects", async () => {
    mockFetch(() => new Response("", { status: 302, headers: { location: "http://169.254.169.254/" } }));
    await expect(fetchURLText(new URL("https://example.com/"), publicResolver)).rejects.toThrow(/redirect/);
  });

  it("rejects disallowed content types", async () => {
    mockFetch(() => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    await expect(fetchURLText(new URL("https://example.com/"), publicResolver)).rejects.toThrow(
      /text\/html or text\/plain/
    );
  });

  it("rejects oversized content-length", async () => {
    mockFetch(
      () =>
        new Response("hi", {
          status: 200,
          headers: { "content-type": "text/plain", "content-length": String(5 * 1024 * 1024) },
        })
    );
    await expect(fetchURLText(new URL("https://example.com/"), publicResolver)).rejects.toThrow(/2 MB/);
  });

  it("returns body and content type on success", async () => {
    mockFetch(() => new Response("<p>hello</p>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));
    const result = await fetchURLText(new URL("https://example.com/"), publicResolver);
    expect(result.contentType).toBe("text/html");
    expect(result.body).toContain("hello");
  });

  it("does not fetch when SSRF guard blocks the target", async () => {
    const fetchSpy = mock(() => new Response("x"));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await expect(fetchURLText(new URL("http://127.0.0.1/"))).rejects.toThrow(/non-public/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("htmlToText", () => {
  it("strips boilerplate containers and decodes entities", () => {
    const html =
      "<nav>menu</nav><header>top</header><script>evil()</script>" +
      "<p>Caf&#233; &amp; tea &#x1F600;</p><footer>bottom</footer>";
    const text = htmlToText(html);
    expect(text).not.toContain("menu");
    expect(text).not.toContain("evil");
    expect(text).not.toContain("bottom");
    expect(text).toContain("Café & tea");
  });
});

describe("extractSummaryInput", () => {
  it("throws for non-URL clipboard text", async () => {
    await expect(extractSummaryInput("just some words")).rejects.toThrow(/single http\(s\) URL/);
  });

  it("truncates extracted text to the prompt budget", async () => {
    const big = "x".repeat(MAX_PROMPT_CHARS + 5000);
    globalThis.fetch = mock(
      () => new Response(big, { status: 200, headers: { "content-type": "text/plain" } })
    ) as unknown as typeof fetch;
    const { text } = await extractSummaryInput("https://example.com/big", publicResolver);
    expect(text.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS + 20);
    expect(text.endsWith("…[truncated]")).toBe(true);
  });
});
