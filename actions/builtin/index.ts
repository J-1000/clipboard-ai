export { summarize } from "./summarize.js";
export { explain } from "./explain.js";
export { translate } from "./translate.js";
export { extract } from "./extract.js";
export { classify } from "./classify.js";
export { summarizeUrl } from "./summarize_url.js";

import { summarize } from "./summarize.js";
import { explain } from "./explain.js";
import { translate } from "./translate.js";
import { extract } from "./extract.js";
import { classify } from "./classify.js";
import { summarizeUrl } from "./summarize_url.js";
import type { Action } from "../lib/types.js";

export const builtinActions: Record<string, Action> = {
  summarize,
  explain,
  translate,
  extract,
  classify,
  summarize_url: summarizeUrl,
};

export default builtinActions;
