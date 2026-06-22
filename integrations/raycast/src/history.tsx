import {
  Action,
  ActionPanel,
  Detail,
  Icon,
  List,
  showToast,
  Toast,
} from "@raycast/api";
import { useEffect, useState } from "react";
import {
  friendlyError,
  HistoryResponse,
  request,
  type HistoryRecord,
} from "./api";

export default function Command() {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [skippedCorrupt, setSkippedCorrupt] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await request<HistoryResponse>("/history?limit=25");
        if (cancelled) {
          return;
        }
        setRecords(response.records);
        setSkippedCorrupt(response.skipped_corrupt ?? 0);
      } catch (err) {
        if (cancelled) {
          return;
        }
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to load history",
          message: friendlyError(err),
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
  }, []);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search recent action runs">
      {skippedCorrupt > 0 ? (
        <List.Section title={`${skippedCorrupt} corrupt record(s) skipped`}>
          {renderItems(records)}
        </List.Section>
      ) : (
        renderItems(records)
      )}
      <List.EmptyView
        icon={Icon.Clock}
        title="No action history yet"
        description="Run a clipboard-ai action (e.g. Summarize) to see it here."
      />
    </List>
  );
}

function renderItems(records: HistoryRecord[]) {
  return records.map((record) => (
    <List.Item
      key={record.id}
      icon={record.status === "success" ? Icon.CheckCircle : Icon.XMarkCircle}
      title={record.action}
      subtitle={record.output || record.error || record.input}
      accessories={[
        { text: record.model },
        { date: new Date(record.timestamp) },
      ]}
      actions={<HistoryActions record={record} />}
    />
  ));
}

function HistoryActions({ record }: { record: HistoryRecord }) {
  return (
    <ActionPanel>
      <Action.Push
        title="View Details"
        icon={Icon.Eye}
        target={<HistoryDetail record={record} />}
      />
      {record.output ? (
        <Action.CopyToClipboard title="Copy Output" content={record.output} />
      ) : null}
      {record.input ? (
        <Action.CopyToClipboard title="Copy Input" content={record.input} />
      ) : null}
      {record.error ? (
        <Action.CopyToClipboard title="Copy Error" content={record.error} />
      ) : null}
    </ActionPanel>
  );
}

function HistoryDetail({ record }: { record: HistoryRecord }) {
  const sections = [
    `# ${record.action} (${record.status})`,
    `**When:** ${new Date(record.timestamp).toLocaleString()}  ·  **Model:** ${record.model}  ·  **Source:** ${record.source}`,
    record.input ? `## Input\n\n${record.input}` : "",
    record.output ? `## Output\n\n${record.output}` : "",
    record.error ? `## Error\n\n${record.error}` : "",
  ].filter(Boolean);

  return (
    <Detail
      markdown={sections.join("\n\n")}
      actions={
        <ActionPanel>
          {record.output ? (
            <Action.CopyToClipboard
              title="Copy Output"
              content={record.output}
            />
          ) : null}
        </ActionPanel>
      }
    />
  );
}
