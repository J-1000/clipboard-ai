import { Action, ActionPanel, Detail, showToast, Toast } from "@raycast/api";
import { useEffect, useState } from "react";
import { actionResult, friendlyError, runAction } from "./api";

interface ActionViewProps {
  action: string;
  title: string;
  body?: Record<string, unknown>;
}

export function ActionView({ action, title, body }: ActionViewProps) {
  const [result, setResult] = useState<string>();
  const [error, setError] = useState<string>();
  // Track loading explicitly: an empty-string result is valid and must not
  // leave the view spinning forever (which `!result && !error` would do).
  const [isLoading, setIsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setResult(undefined);
      setError(undefined);
      try {
        const response = await runAction(action, body);
        if (!cancelled) {
          setResult(actionResult(response));
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        const message = friendlyError(err);
        setError(message);
        await showToast({
          style: Toast.Style.Failure,
          title: `${title} failed`,
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [action, body, title, reloadKey]);

  const markdown = error
    ? `# ${title} Failed\n\n${error}`
    : result !== undefined
      ? `# ${title}\n\n${result}`
      : `# ${title}`;

  return (
    <Detail
      isLoading={isLoading}
      markdown={markdown}
      actions={
        <ActionPanel>
          {result !== undefined ? (
            <>
              <Action.CopyToClipboard title="Copy Result" content={result} />
              <Action.Paste title="Paste Result" content={result} />
            </>
          ) : null}
          <Action
            title="Run Again"
            onAction={() => setReloadKey((key) => key + 1)}
          />
        </ActionPanel>
      }
    />
  );
}
