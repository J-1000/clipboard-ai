export { summarize } from "./summarize.js";
export { explain } from "./explain.js";
export { translate } from "./translate.js";
export { extract } from "./extract.js";

import { summarize } from "./summarize.js";
import { explain } from "./explain.js";
import { translate } from "./translate.js";
import { extract } from "./extract.js";
import type { Action } from "../lib/types.js";

export const builtinActions: Record<string, Action> = {
  summarize,
  explain,
  translate,
  extract,
};

export default builtinActions;
