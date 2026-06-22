import { Detail } from "@raycast/api";
import { ActionView } from "./action-view";

export default function Command(props: { arguments: Arguments.Translate }) {
  const language = props.arguments.language.trim();
  if (language.length === 0) {
    return (
      <Detail markdown="# Translate\n\nPlease provide a non-empty target language." />
    );
  }
  return (
    <ActionView
      action="translate"
      title={`Translation to ${language}`}
      body={{ args: [language] }}
    />
  );
}
