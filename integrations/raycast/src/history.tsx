import {
  Action,
  ActionPanel,
  Icon,
  List,
  showToast,
  Toast,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { HistoryResponse, request, type HistoryRecord } from "./api";

export default function Command() {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const response = await request<HistoryResponse>("/history?limit=25");
        setRecords(response.records);
      } catch (err) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to load history",
          message: (err as Error).message,
        });
      } finally {
        setIsLoading(false);
      }
    }

    load();
  }, []);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search recent action runs"
    >
      {records.map((record) => (
        <List.Item
          key={record.id}
          icon={
            record.status === "success" ? Icon.CheckCircle : Icon.XMarkCircle
          }
          title={record.action}
          subtitle={record.output || record.error || record.input}
          accessories={[
            { text: record.model },
            { date: new Date(record.timestamp) },
          ]}
          actions={<HistoryActions record={record} />}
        />
      ))}
    </List>
  );
}

function HistoryActions({ record }: { record: HistoryRecord }) {
  return (
    <ActionPanel>
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
