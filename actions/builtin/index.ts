export { summarize } from "./summarize.js";
export { explain } from "./explain.js";
export { translate } from "./translate.js";
export { extract } from "./extract.js";
export { classify } from "./classify.js";

import { summarize } from "./summarize.js";
import { explain } from "./explain.js";
import { translate } from "./translate.js";
import { extract } from "./extract.js";
import { classify } from "./classify.js";
import type { Action } from "../lib/types.js";

export const builtinActions: Record<string, Action> = {
  summarize,
  explain,
  translate,
  extract,
  classify,
};

export default builtinActions;
