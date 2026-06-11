import { ActionView } from "./action-view";

export default function Command(props: { arguments: Arguments.Translate }) {
  const language = props.arguments.language.trim();
  return <ActionView action="translate" title={`Translation to ${language}`} body={{ args: [language] }} />;
}
