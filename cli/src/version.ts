import pkg from "../package.json" assert { type: "json" };

// __CBAI_VERSION__ is replaced at build time via `bun build --define`
// (see package.json build script / the release workflow). Unstamped builds
// fall back to the package.json version so local runs still report something.
declare const __CBAI_VERSION__: string | undefined;

export const VERSION: string =
  typeof __CBAI_VERSION__ === "string" && __CBAI_VERSION__.length > 0
    ? __CBAI_VERSION__
    : pkg.version;
