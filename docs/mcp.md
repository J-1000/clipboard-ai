# MCP server

`cbai mcp` starts a Model Context Protocol server over stdio and exposes
clipboard-ai's registered actions as MCP tools. It is intended for an MCP host
running on the same Mac as `clipboard-ai-agent`.

## Client configuration

Use `cbai` directly when it is installed on the MCP host's `PATH`:

```json
{
  "mcpServers": {
    "clipboard-ai": {
      "command": "cbai",
      "args": ["mcp"]
    }
  }
}
```

If a GUI host has a restricted `PATH`, replace `cbai` with its absolute path,
for example `/usr/local/bin/cbai`.

The agent must already be running. MCP does not use or require the optional TCP
HTTP API; the CLI connects through the private Unix socket.

## Tool discovery

Tools are discovered once when the MCP server starts:

- Every built-in and trusted local plugin action registered by the CLI
- Configured prompt-template actions that are not already present in the
  registry

Restart the MCP server after adding or removing an action. Unsupported action
names are skipped with a warning on stderr.

Each tool accepts:

- `text` (optional): explicit text, capped at 100,000 characters; when omitted,
  the current clipboard is used
- `arguments` (optional): up to 64 positional strings, each capped at 4,096
  characters, for actions such as `translate`

Successful results are returned as MCP text content. Agent or action failures
are returned as tool errors, not protocol crashes. Tool calls retain normal
clipboard-ai behavior: safe mode, the sensitive-data guard, provider fallbacks,
daily token limits, history, and action concurrency are all enforced.

A tool call waits up to 120 seconds for the agent. Set
`CBAI_ACTION_TIMEOUT_MS` in the MCP server's environment to change that, and
raise `actions.<name>.timeout_ms` if a model needs more than the agent's
30-second default.

Because tools may send clipboard or explicit text to an LLM provider, MCP tool
annotations mark them as non-read-only and open-world operations. Review the
effective provider configuration with `cbai config` before connecting a host.
