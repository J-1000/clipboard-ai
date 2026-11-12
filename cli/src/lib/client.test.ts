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
const {
  getStatus,
  getClipboard,
  getConfig,
  getControls,
  setMonitoringControl,
  getProviderChain,
  runAgentAction,
} = (await import(
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

  describe("monitoring controls", () => {
    it("gets control status", async () => {
      server = await startMockServer(({ method, url }) => {
        expect(method).toBe("GET");
        expect(url).toBe("/controls");
        return {
          body: {
            monitoring: true,
            paused: false,
            default_snooze_minutes: 15,
            app_allowlist: [],
            app_denylist: [],
          },
        };
      });

      expect((await getControls()).monitoring).toBe(true);
    });

    it("posts snooze duration", async () => {
      server = await startMockServer(({ method, url, body }) => {
        expect(method).toBe("POST");
        expect(url).toBe("/controls");
        expect(JSON.parse(body)).toEqual({ action: "snooze", duration_minutes: 30 });
        return {
          body: {
            monitoring: false,
            paused: false,
            snoozed_until: "2026-08-18T13:00:00Z",
            default_snooze_minutes: 15,
            app_allowlist: [],
            app_denylist: [],
          },
        };
      });

      const result = await setMonitoringControl("snooze", 30);
      expect(result.snoozed_until).toBe("2026-08-18T13:00:00Z");
    });
  });

  describe("provider profiles", () => {
    it("loads the private provider chain for an action", async () => {
      server = await startMockServer(({ method, url }) => {
        expect(method).toBe("GET");
        expect(url).toBe("/provider-chain?action=summarize%20url");
        return {
          body: {
            profiles: [
              {
                name: "cloud",
                type: "openai",
                endpoint: "https://api.openai.com/v1",
                model: "gpt-5-mini",
                api_key: "secret",
              },
            ],
            max_tokens: 2048,
          },
        };
      });

      const chain = await getProviderChain("summarize url");
      expect(chain.profiles[0].name).toBe("cloud");
      expect(chain.profiles[0].api_key).toBe("secret");
      expect(chain.max_tokens).toBe(2048);
    });
  });

  describe("actions", () => {
    it("posts an action invocation to the private agent endpoint", async () => {
      server = await startMockServer(({ method, url, body }) => {
        expect(method).toBe("POST");
        expect(url).toBe("/action");
        expect(JSON.parse(body)).toEqual({
          action: "translate",
          text: "Hello",
          args: ["German"],
        });
        return {
          body: {
            success: true,
            action: "translate",
            result: "Hallo",
          },
        };
      });

      const response = await runAgentAction("translate", {
        text: "Hello",
        args: ["German"],
      });
      expect(response).toEqual({
        success: true,
        action: "translate",
        result: "Hallo",
      });
    });
  });

  describe("action timeout", () => {
    afterEach(() => {
      delete process.env.CBAI_ACTION_TIMEOUT_MS;
      // The silent server never answers, so drop its half-open connection or
      // the shared afterEach would wait on server.close() until it times out.
      server?.closeAllConnections?.();
    });

    function startSilentServer(): Promise<void> {
      return new Promise<void>((resolve) => {
        mkdirSync(dirname(TEST_SOCKET), { recursive: true });
        if (existsSync(TEST_SOCKET)) {
          unlinkSync(TEST_SOCKET);
        }
        server = createServer(() => {
          // Never answers.
        });
        server.listen(TEST_SOCKET, () => resolve());
      });
    }

    it("waits longer than the ordinary IPC timeout for /action", async () => {
      process.env.CBAI_IPC_TIMEOUT_MS = "50";
      process.env.CBAI_ACTION_TIMEOUT_MS = "400";
      await startSilentServer();

      const started = Date.now();
      await expect(runAgentAction("summary", { text: "hi" })).rejects.toThrow(
        'action "summary" did not finish within 0.4s'
      );
      expect(Date.now() - started).toBeGreaterThanOrEqual(350);
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
