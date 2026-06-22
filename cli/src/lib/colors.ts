// Minimal ANSI color helper. Colors are applied only on an interactive stdout
// and when NO_COLOR is unset, so piped/redirected output and CI logs stay clean.
function colorEnabled(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

function wrap(code: number): (text: string) => string {
  return (text: string) => (colorEnabled() ? `\x1b[${code}m${text}\x1b[0m` : text);
}

export const green = wrap(32);
export const red = wrap(31);
export const yellow = wrap(33);
export const dim = wrap(2);
