# Plugin actions

Plugin actions live in `~/.clipboard-ai/actions` and are loaded by the CLI when actions are registered. Supported file extensions are `.js`, `.mjs`, and `.cjs`.

## Security model

Plugins run as local JavaScript with the same privileges as your user account. They can read files, write files, make network requests, spawn processes, and access clipboard action inputs. Only install plugin code you trust and have reviewed.

Keep the plugin directory private to your account:

```bash
chmod 700 ~/.clipboard-ai
chmod 700 ~/.clipboard-ai/actions
```

Do not make `~/.clipboard-ai/actions` writable by other users. When plugins are loaded, the CLI logs a notice like `Loaded 2 plugin action(s) from ~/.clipboard-ai/actions: foo, bar` so unexpected plugins are easier to spot.

## Example

```js
export default {
  id: "reverse",
  aliases: ["rev"],
  description: "Reverse clipboard text",
  inputTypes: ["text"],
  outputTitle: "Reversed",
  run: async ({ text }) => text.split("").reverse().join(""),
};
```

Run it with:

```bash
cbai run reverse
```

## Using plugins from other clients

A plugin is available by its id through `POST /action` and through MCP (`cbai
mcp` lists it as a tool). No `[actions.<id>]` entry in `config.toml` is
required; add one only to give the plugin a trigger, a provider profile, or a
timeout.

When the agent runs the CLI on behalf of such a client, the "Loaded N plugin
action(s)" notice is not printed, because the CLI's stderr is what the client
receives as the error message if the action fails.
