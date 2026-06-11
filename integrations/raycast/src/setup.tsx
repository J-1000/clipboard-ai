import { Action, ActionPanel, Detail } from "@raycast/api";

const docsUrl =
  "https://github.com/J-1000/clipboard-ai/blob/main/docs/http-api.md";
const configSnippet = `[settings]
http_enabled = true
http_addr = "127.0.0.1:9159"
http_auth_token = "replace-with-a-long-random-token"`;

export default function Command() {
  return (
    <Detail
      markdown={`# Clipboard AI Raycast Setup

This extension talks to the clipboard-ai local HTTP API. Enable it in \`~/.clipboard-ai/config.toml\`, restart \`clipboard-ai-agent\`, then set the same token in this extension's preferences.

\`\`\`toml
${configSnippet}
\`\`\`

The API is local-only by default and every request must include the configured token.`}
      actions={
        <ActionPanel>
          <Action.OpenInBrowser title="Open HTTP API Docs" url={docsUrl} />
          <Action.CopyToClipboard
            title="Copy Config Snippet"
            content={configSnippet}
          />
        </ActionPanel>
      }
    />
  );
}
