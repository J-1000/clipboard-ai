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
// Since it's a const derived from homedir(), we mock the module
mock.module("os", () => ({
  homedir: () => TEST_ROOT,
}));

const { getStatus, getClipboard, getConfig, runAction } = await import(
  "./client.js"
);

describe("IPC Client", () => {
  let server: Server;

  afterEach((done) => {
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

  describe("runAction", () => {
    it("sends POST with action and text", async () => {
      let receivedBody = "";
      server = await startMockServer((req) => {
        receivedBody = req.body;
        return {
          body: {
            success: true,
            action: "summarize",
            result: "A summary",
          },
        };
      });

      const result = await runAction("summarize", "some long text");
      expect(result.success).toBe(true);
      expect(result.action).toBe("summarize");
      expect(result.result).toBe("A summary");

      const parsed = JSON.parse(receivedBody);
      expect(parsed.action).toBe("summarize");
      expect(parsed.text).toBe("some long text");
    });

    it("sends POST without text when not provided", async () => {
      let receivedBody = "";
      server = await startMockServer((req) => {
        receivedBody = req.body;
        return {
          body: { success: true, action: "classify", result: "code" },
        };
      });

      const result = await runAction("classify");
      expect(result.success).toBe(true);

      const parsed = JSON.parse(receivedBody);
      expect(parsed.action).toBe("classify");
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
  });
});
