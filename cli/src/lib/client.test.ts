import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { createServer, type Server } from "http";
import { unlinkSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

// We need to test the client against a real Unix socket server
// since the module uses Node's http.request with socketPath

const TEST_ROOT = join("/tmp", `clipboard-ai-client-${process.pid}`);
const TEST_SOCKET = join(TEST_ROOT, ".clipboard-ai", "agent.sock");

function startMockServer(
  handler: (req: { method: string; url: string; body: string }) => {
    status?: number;
    body: unknown;
  }
): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const result = handler({
          method: req.method || "GET",
          url: req.url || "/",
          body,
        });
        res.writeHead(result.status || 200, {
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify(result.body));
      });
    });

    mkdirSync(dirname(TEST_SOCKET), { recursive: true });
    if (existsSync(TEST_SOCKET)) {
      unlinkSync(TEST_SOCKET);
    }
    server.listen(TEST_SOCKET, () => resolve(server));
  });
}

// We need to mock the SOCKET_PATH constant used in client.ts
// Since it's a const derived from homedir(), we mock the module. Spread the
// real `os` so the mock is a COMPLETE shape and only homedir is overridden;
// a partial mock would leak missing members into other test files.
const realOs = await import("os");
mock.module("os", () => ({
  ...realOs,
  homedir: () => TEST_ROOT,
}));

// client.js captures SOCKET_PATH from homedir() at module-load time. Other test
// files statically import client.js (transitively) WITHOUT the os mock, which
// would cache a real-homedir SOCKET_PATH. A cache-busting query forces a fresh
// evaluation here, after the os mock is in place, so SOCKET_PATH points at
// TEST_ROOT regardless of evaluation order.
const { getStatus, getClipboard, getConfig } = (await import(
  `./client.js?test=${Date.now()}`
)) as typeof import("./client.js");

describe("IPC Client", () => {
  let server: Server;

  afterEach((done) => {
    mock.restore();
    delete process.env.CBAI_IPC_TIMEOUT_MS;
    if (server) {
      server.close(() => {
        if (existsSync(TEST_SOCKET)) {
          unlinkSync(TEST_SOCKET);
        }
        done();
      });
    } else {
      done();
    }
  });

  describe("getStatus", () => {
    it("returns status response", async () => {
      server = await startMockServer(() => ({
        body: {
          status: "running",
          uptime: "5m0s",
          version: "0.1.0",
          clipboard: { text: "test", type: "text", timestamp: "2024-01-01" },
        },
      }));

      const status = await getStatus();
      expect(status.status).toBe("running");
      expect(status.version).toBe("0.1.0");
      expect(status.uptime).toBe("5m0s");
      expect(status.clipboard.text).toBe("test");
    });
  });

  describe("getClipboard", () => {
    it("returns clipboard response", async () => {
      server = await startMockServer(() => ({
        body: {
          text: "hello world",
          type: "text",
          timestamp: "2024-01-01T00:00:00Z",
          length: 11,
        },
      }));

      const clipboard = await getClipboard();
      expect(clipboard.text).toBe("hello world");
      expect(clipboard.type).toBe("text");
      expect(clipboard.length).toBe(11);
    });
  });

  describe("getConfig", () => {
    it("returns config response", async () => {
      server = await startMockServer(() => ({
        body: {
          provider: {
            type: "ollama",
            endpoint: "http://localhost:11434/v1",
            model: "mistral",
          },
          actions: { summarize: { enabled: true, trigger: "length > 200" } },
          settings: {
            poll_interval: 150,
            safe_mode: true,
            notifications: true,
            log_level: "info",
          },
        },
      }));

      const config = await getConfig();
      expect(config.provider.type).toBe("ollama");
      expect(config.provider.model).toBe("mistral");
      expect(config.settings.safe_mode).toBe(true);
      expect(config.actions.summarize.enabled).toBe(true);
    });
  });

  describe("error handling", () => {
    it("rejects when agent is not running (ENOENT)", async () => {
      // Don't start any server — socket doesn't exist
      if (existsSync(TEST_SOCKET)) {
        unlinkSync(TEST_SOCKET);
      }
      server = null as unknown as Server;

      await expect(getStatus()).rejects.toThrow("Agent not running");
    });

    it("rejects when daemon does not respond before timeout", async () => {
      process.env.CBAI_IPC_TIMEOUT_MS = "100";

      await new Promise<void>((resolve) => {
        mkdirSync(dirname(TEST_SOCKET), { recursive: true });
        if (existsSync(TEST_SOCKET)) {
          unlinkSync(TEST_SOCKET);
        }
        server = createServer(() => {
          // Intentionally leave the response open to exercise the client timeout.
        });
        server.listen(TEST_SOCKET, () => resolve());
      });

      await expect(getStatus()).rejects.toThrow(
        "daemon did not respond within 0.1s — is clipboard-ai-agent running? Try `cbai logs`"
      );
    });
  });
});
