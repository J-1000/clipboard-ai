import { Action, ActionPanel, Detail, showToast, Toast } from "@raycast/api";
import { useEffect, useState } from "react";
import { actionResult, runAction } from "./api";

interface ActionViewProps {
  action: string;
  title: string;
  body?: Record<string, unknown>;
}

export function ActionView({ action, title, body }: ActionViewProps) {
  const [result, setResult] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    async function load() {
      try {
        const response = await runAction(action, body);
        setResult(actionResult(response));
      } catch (err) {
        const message = (err as Error).message;
        setError(message);
        await showToast({
          style: Toast.Style.Failure,
          title: `${title} failed`,
          message,
        });
      }
    }

    load();
  }, [action, body, title]);

  const markdown = error
    ? `# ${title} Failed\n\n${error}`
    : result
      ? `# ${title}\n\n${result}`
      : `# ${title}`;

  return (
    <Detail
      isLoading={!result && !error}
      markdown={markdown}
      actions={
        result ? (
          <ActionPanel>
            <Action.CopyToClipboard title="Copy Result" content={result} />
          </ActionPanel>
        ) : undefined
      }
    />
  );
}
