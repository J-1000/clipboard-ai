# CLI diagnostics

## `cbai actions`

Lists every registered action from the CLI registry, including built-ins and plugin actions. For each action it shows:

- description
- aliases
- whether the daemon config enables it
- configured trigger expression

## `cbai doctor`

Runs local diagnostics and prints pass/fail/info lines for:

- daemon socket reachability
- daemon version versus CLI version
- config readability
- provider endpoint reachability
- configured Ollama model availability through `/api/tags`
- vision capability guidance for `caption` and `ocr`
- history file size
- plugin directory scan

Vision checks are heuristic. Known vision model names pass; otherwise doctor reports `unknown — caption/ocr may fail` so users know image actions may need a vision-capable model.
