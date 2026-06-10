# clipboard-ai — Improvement & Feature Plan (Agent Handoff)

Date of review: 2026-06-11
Source: full code review of `agent/` (Go daemon), `cli/` (Bun CLI), `actions/` (builtin actions).

## Instructions for the implementing agent

- Follow the commit policy in `AGENTS.md` strictly: **one atomic commit per logical change**, in the order data/model → behavior wiring → tests → docs.
- Each task below ends with a **Commits** list. Post the numbered commit plan before committing (per `AGENTS.md`), then execute it without waiting for approval.
- Work the phases in order. Within a phase, tasks are independent unless noted.
- After each task: run `cd agent && go test ./...`, `cd cli && bun test`, `cd actions && bun test`. All must pass before committing.
- Update `STATUS.md` (and `prd.md` §14.1 where relevant) in a final docs commit per phase, not per task.
- All file references were verified against the codebase on the review date; line numbers are approximate — locate by the quoted code, not the number.

---

## Phase 1 — Security fixes (highest priority)

### Task 1.1 — Fix AppleScript injection in notifications

**Severity: HIGH (verified). Code execution from clipboard-derived content.**

`agent/internal/notify/notify.go:11-14` escapes only `"` before splicing text into an
AppleScript string:

```go
title = strings.ReplaceAll(title, `"`, `\"`)
script := `display notification "` + message + `" with title "` + title + `"`
```

Input containing `\"` becomes `\\"` after escaping — the `\\` is an escaped backslash, the
`"` closes the AppleScript string, and the remainder executes as AppleScript (including
`do shell script`). Notification text can derive from clipboard content/action results, so
this is attacker-reachable by getting a victim to copy crafted text.

**Fix (preferred):** stop string-building the script. Pass values as argv:

```go
script := `on run argv
  display notification (item 2 of argv) with title (item 1 of argv)
end run`
cmd := exec.Command("osascript", "-e", script, title, message)
```

Apply the same pattern to `Send`, `SendWithSubtitle`, `SendWithSound` (all three in
`notify.go` have the bug). Extract a single internal helper so the escaping/argv logic
exists once.

**Tests:** add `notify_test.go` cases asserting the built command args for inputs
containing `"`, `\`, `\"`, newlines, and an injection payload like
`\" & (do shell script "touch /tmp/pwned") & "`. (Test command construction, not actual
osascript execution — follow the existing test style in `notify_test.go`.)

**Commits:**
1. `agent/notify: pass notification text via argv to prevent AppleScript injection`
2. `test(agent/notify): cover quote/backslash/injection payloads`

### Task 1.2 — Redact secrets from the /config endpoint

**Severity: HIGH (verified). Credential disclosure.**

`agent/internal/ipc/server.go:169-173` (`handleConfig`) serializes `s.config.Provider`
(contains `api_key`) and `s.config.Settings` (contains `http_auth_token`) verbatim. This
endpoint is reachable over the Unix socket and the optional HTTP API.

**Fix:** build the `ConfigResponse` from copies with `APIKey` and `HTTPAuthToken` blanked
(or replaced with `"<redacted>"` when non-empty, so the CLI can still show "set/not set").
Check `cli/src/commands/config.ts` and update its display accordingly (it currently shows
http settings; it should show `api_key: set`/`not set`, never the value).

**Tests:** extend `agent/internal/ipc/server_test.go` and `http_server_test.go`: response
JSON must never contain the configured token/key values.

**Commits:**
1. `agent/ipc: redact api_key and http_auth_token from /config response`
2. `cli: display secret presence instead of values in config output`
3. `test(agent/ipc): assert /config never leaks credentials`

### Task 1.3 — History privacy: retention controls and clear command

**Severity: HIGH. Plaintext clipboard content persisted indefinitely; contradicts PRD §12
("Do not log clipboard content unless explicit flag").**

`cli/src/lib/history.ts` appends full `input` and `output` to
`~/.clipboard-ai/history.jsonl` unconditionally, append-only, no rotation.

**Fix (three parts, separate commits):**
1. Config: add to `SettingsConfig` (Go `agent/internal/config/config.go`) and the CLI's
   config reader: `history_enabled` (default `true`), `history_max_entries` (default
   `1000`), `history_truncate_chars` (default `2000`, `0` = no truncation). Document in
   `configs/default.toml`.
2. Behavior: in `history.ts` — skip writes when disabled; truncate `input`/`output` to
   `history_truncate_chars`; after append, compact the file to the newest
   `history_max_entries` lines when it exceeds the limit by >10% (cheap amortized
   rotation). Create the file with mode `0600`.
3. CLI: add `cbai history --clear` (delete the file) and `cbai history --before <ISO date>`
   (drop older entries). Wire into `cli/src/commands/history.ts` + `cli/src/index.ts`.

**Tests:** unit tests in `history.test.ts` for disabled mode, truncation, compaction
threshold, `--clear`, `--before`.

**Commits:**
1. `config: add history retention settings (enabled/max entries/truncation)`
2. `cli/history: enforce retention settings and 0600 file mode`
3. `cli: add history --clear and --before pruning flags`
4. `test(cli/history): retention, truncation, and pruning coverage`

### Task 1.4 — HTTP/IPC hardening (request and response size limits, socket perms)

**Severity: MEDIUM. Three small fixes, one concern each.**

1. **POST body cap:** `agent/internal/ipc/server.go` `handleAction` decodes JSON with no
   limit. Wrap: `r.Body = http.MaxBytesReader(w, r.Body, 10<<20)` (10 MB; constant at top
   of file). Return 413 on overflow.
2. **/clipboard response cap:** `handleClipboard` base64-encodes the full clipboard image
   with no bound. If `len(current.Image)` exceeds a limit (suggest 25 MB), omit
   `image_base64` and set a new `"image_truncated": true` field plus `image_size_bytes`.
3. **Socket permission race:** `Start()` calls `net.Listen` then `os.Chmod(socketPath,
   0600)` — world-connectable in between. Fix: ensure the parent dir
   `~/.clipboard-ai` is `0700` (it should already be; enforce with `os.MkdirAll(dir,
   0700)` + `os.Chmod(dir, 0700)`), and additionally set umask via `syscall.Umask(0077)`
   around the Listen call, restoring it after.

**Tests:** oversized POST returns 413; oversized image yields truncation flag; (socket
perms: assert file mode after Start in `server_test.go`).

**Commits:**
1. `agent/ipc: cap /action request body at 10MB`
2. `agent/ipc: omit oversized images from /clipboard with truncation flag`
3. `agent/ipc: eliminate socket permission race at startup`
4. `test(agent/ipc): size-limit and socket-mode coverage`

### Task 1.5 — Document the plugin trust model

**Severity: MEDIUM (documentation only).**

`cli/src/lib/plugin-actions.ts:42` dynamically imports `~/.clipboard-ai/actions/*.js` with
full runtime privileges. This is acceptable by design but must be stated.

**Fix:** add a "Security model" section to `README.md` and `docs/` (wherever plugins are
documented): plugins run with full user privileges; only install trusted code; the
directory should not be writable by other users. Also log a one-line notice when plugins
are loaded (`Loaded N plugin action(s) from ~/.clipboard-ai/actions`), listing names.

**Commits:**
1. `cli/plugins: log loaded plugin actions at startup`
2. `docs: document plugin security model`

---

## Phase 2 — Robustness fixes

### Task 2.1 — CLI socket request timeout

`cli/src/lib/client.ts` issues HTTP-over-Unix-socket requests with no timeout; the CLI
hangs forever if the daemon wedges. Add a default 10s timeout (configurable via a
`CBAI_IPC_TIMEOUT_MS` env var), using `req.setTimeout()` + destroy + a clear error message
("daemon did not respond within Xs — is clipboard-ai-agent running? Try `cbai logs`").

**Commits:**
1. `cli/client: add IPC request timeout with actionable error`
2. `test(cli/client): timeout behavior`

### Task 2.2 — Tolerate corrupt history lines

`cli/src/lib/history.ts:52-57` runs `JSON.parse` per line unguarded; one bad line breaks
`cbai history` and `cbai rerun` entirely. Skip unparseable lines, count them, and print a
single warning (`skipped N corrupt history entries`).

**Commits:**
1. `cli/history: skip corrupt jsonl lines instead of failing`
2. `test(cli/history): corrupt-line tolerance`

### Task 2.3 — Defensive AI response handling

`cli/src/lib/ai.ts:75-77` does `response.choices[0]` then `choice.message.content` without
guards — crashes if a provider returns an empty `choices` array. Use optional chaining and
throw a descriptive error (`provider returned no completion choices`). The builtin actions
in `actions/builtin/*.ts` already use `?.` — align `generateWithImage` in the same file too.

**Commits:**
1. `cli/ai: handle empty choices array from provider`
2. `test(cli/ai): empty-choices error path`

### Task 2.4 — Log RTF read failures once

`agent/internal/clipboard/monitor.go` `readRTF()` silently returns `""` on any `pbpaste`
error, making RTF problems undiagnosable. Log the error once per process (sync.Once or a
logged-already flag) at warn level, then continue degrading gracefully.

**Commits:**
1. `agent/clipboard: log first pbpaste RTF failure instead of silent drop`

---

## Phase 3 — Code quality

### Task 3.1 — Deduplicate builtin actions

The five files in `actions/builtin/` (`summarize`, `explain`, `translate`, `extract`,
`classify`) repeat ~80% of their code: provider check, OpenAI client construction, message
assembly, completion call, error mapping.

**Fix:** add `actions/lib/execute.ts` exporting
`executeAIAction(ctx, { systemPrompt, userPrompt, maxTokens? }): Promise<ActionResult>`;
rewrite each builtin as prompt definitions + a call to it. Behavior must be identical —
existing per-action tests are the safety net; do not change prompts in this task.

**Commits:**
1. `actions: extract shared executeAIAction helper`
2. `actions: migrate builtins to shared helper` (one commit; mechanical)

### Task 3.2 — Unify action type definitions

`actions/lib/types.ts` (`Action`, `ActionMetadata`, `ActionHandler`) and
`cli/src/lib/action-types.ts` (`ActionDefinition`, `ActionContext`) are two incompatible
type systems for the same concept. Pick the CLI's shapes as canonical (they're what
executes), re-export or alias from `actions/lib/types.ts`, and delete dead types. If the
two layers are intentionally separate (actions = library, cli = runner), document the
boundary in a comment in each file instead of merging — implementing agent decides based
on actual import graphs.

**Commits:**
1. `types: unify action type definitions across actions/ and cli/`

### Task 3.3 — Precompile trigger regexes

`agent/internal/rules/engine.go:251` calls `regexp.MatchString` (compiles every time) on
every clipboard change. Compile patterns when rules are parsed/loaded, store
`*regexp.Regexp` in the rule struct, and surface compile errors at config load time
(better UX: bad regex fails at startup with a clear message, not silently at match time).

**Commits:**
1. `agent/rules: precompile trigger regexes at parse time`
2. `test(agent/rules): invalid regex rejected at load`

---

## Phase 4 — Features (build in this order)

### Task 4.1 — Sensitive-data guard

Detect likely secrets/PII in clipboard text before any action runs; skip the action (or
redact) and notify. Patterns to start with: AWS keys (`AKIA[0-9A-Z]{16}`), generic
`api[_-]?key\s*[:=]`, JWTs (`eyJ[A-Za-z0-9_-]+\.eyJ`), private key headers
(`-----BEGIN .* PRIVATE KEY-----`), credit-card numbers (Luhn-checked 13–19 digits).

- New Go package `agent/internal/guard` with `Scan(text string) []Finding`.
- Config: `[settings] sensitive_guard = "block" | "warn" | "off"` (default `warn`).
  `block`: daemon skips triggered actions and sends a notification ("clipboard looks like
  it contains a secret — action skipped"). `warn`: runs but notifies.
- CLI parity: the same check before manual actions, with a `--force` bypass flag, in
  `cli/src/lib/run-action.ts` (TS implementation mirroring the Go patterns; keep the
  pattern list in one documented place per language with a note to keep them in sync).
- History integration: when guard fires, never write the content to history.

**Commits:**
1. `agent/guard: add sensitive-data scanner package`
2. `config: add sensitive_guard setting`
3. `agent: enforce guard before triggered actions`
4. `cli: enforce guard before manual actions with --force bypass`
5. `test: guard pattern and enforcement coverage` (split per module if large)
6. `docs: document sensitive-data guard`

### Task 4.2 — Streaming output

Stream completions token-by-token for manual CLI actions (TTY only; keep buffered output
when piped or when `--copy` needs the full result anyway — accumulate while streaming).
The OpenAI SDK supports `stream: true`. Touch `cli/src/lib/ai.ts` (add
`generateStream`), `cli/src/lib/run-action.ts` (write chunks to stdout when
`process.stdout.isTTY`). JSON-producing actions (`classify`, `extract`) stay buffered.

**Commits:**
1. `cli/ai: add streaming generation`
2. `cli: stream action output on TTY`
3. `test(cli): streaming accumulation and non-TTY fallback`

### Task 4.3 — summarize_url action

The PRD's motivating example. New builtin `summarize_url`: if clipboard text is a single
URL, fetch it (10s timeout, max 2 MB, `text/html`/`text/plain` only), strip HTML to text
(small dependency or regex-based extraction; no headless browser), then summarize.
Register in builtins, add trigger example to `configs/default.toml`
(`regex:^https?://\S+$` → `summarize_url`, disabled by default). Note in docs: fetching a
URL is a network call to that site even in safe mode (safe mode governs LLM providers);
state this explicitly.

**Commits:**
1. `actions: add summarize_url builtin (fetch + extract + summarize)`
2. `test(actions): summarize_url fetch limits and extraction`
3. `config/docs: register summarize_url with example trigger`

### Task 4.4 — cbai actions and cbai doctor

- `cbai actions`: list every registered action (builtin + plugin) with description,
  aliases, whether enabled, and its trigger from daemon config. Data sources already
  exist: `cli/src/lib/action-registry.ts` + `/config` IPC.
- `cbai doctor`: diagnostic checks with pass/fail lines — daemon socket reachable; daemon
  version matches CLI version; provider endpoint reachable; configured model available
  (Ollama: `GET /api/tags`); vision capability for image actions (heuristic: known vision
  model names, else "unknown — caption/ocr may fail"); history file size; plugin dir
  scan. This also closes the PRD §14.1 open item ("clearer messaging for vision model
  requirements").

**Commits:**
1. `cli: add actions listing command`
2. `cli: add doctor diagnostics command`
3. `test(cli): actions/doctor command coverage`
4. `docs: document actions and doctor commands`

### Task 4.5 — Anthropic provider support

`cli/src/lib/ai.ts` explicitly rejects `type = "anthropic"`. Anthropic serves an
OpenAI-compatible Chat Completions endpoint at `https://api.anthropic.com/v1/`, so support
is mostly configuration: when `type = "anthropic"`, default endpoint to that URL, pass
`api_key`, and classify it as a **cloud** provider in `cli/src/lib/safe-mode.ts` (must
trigger safe-mode like OpenAI does). Default model suggestion in docs:
`claude-haiku-4-5-20251001` for fast clipboard tasks. Verify the compat endpoint's current
model-id and auth-header requirements against Anthropic's docs before implementing; if
image actions (`caption`/`ocr`) don't work through the compat layer, document that
limitation rather than blocking the feature.

**Commits:**
1. `cli/ai: support anthropic provider via OpenAI-compatible endpoint`
2. `cli/safe-mode: classify anthropic as cloud provider`
3. `test(cli): anthropic provider routing and safe-mode`
4. `docs: anthropic provider configuration`

### Task 4.6 — Per-action model routing

Allow `model` (and optional `endpoint`) override per action in TOML:

```toml
[actions.classify]
model = "llama3.2:1b"   # small/fast
[actions.explain]
model = "qwen2.5-coder:14b"
```

Plumbing: `agent/internal/config/config.go` `ActionConfig` gains `Model`/`Endpoint`;
executor passes them to the CLI via env (`CBAI_MODEL_OVERRIDE`); CLI/actions prefer the
override over provider default. Safe-mode must evaluate the **effective** endpoint, not
the provider default.

**Commits:**
1. `config: per-action model/endpoint overrides`
2. `agent/executor: pass model override to CLI`
3. `cli: honor model override with safe-mode on effective endpoint`
4. `test: override plumbing across agent and cli`
5. `docs: per-action model routing`

### Task 4.7 — Config hot-reload

Watch `~/.clipboard-ai/config.toml` (fsnotify) and re-apply provider/actions/rules without
restart. Reload must: re-validate (reject + keep old config + notify on error), swap rules
atomically (mutex around the rule engine), and log the reload. Settings that can't be
hot-applied (socket path, `http_enabled`/`http_addr`) log a "restart required" notice.
SIGHUP as an alternative trigger.

**Commits:**
1. `agent/config: add validated reload support`
2. `agent: watch config file and hot-apply rules/provider`
3. `test(agent): reload validation and atomic swap`
4. `docs: config hot-reload behavior`

### Task 4.8 — Raycast extension (separate deliverable, do last)

Thin Raycast extension hitting the existing local HTTP API (`docs/http-api.md`,
`docs/integrations/local-http-clients.md` already describe the contract): commands for
summary/explain/translate/history. Lives in a new top-level `integrations/raycast/`
directory. Requires `http_enabled = true`; the extension's setup screen should say so and
link the docs. This task is larger and independent — fine to defer or hand to a separate
agent.

**Commits:** standard Raycast scaffold + one commit per command + docs.

---

## Explicitly rejected findings (do not implement)

Recorded so a future reviewer doesn't re-flag them:

- **"Env var injection" in `agent/internal/executor/executor.go`** (`CBAI_INPUT_TEXT=` +
  clipboard text): Go passes `cmd.Env` entries directly to `execve`; newlines/special
  chars in values are data, not structure. Not a vulnerability.
- **"Race condition on `lastSignature`" in `agent/internal/clipboard/monitor.go`**: all
  reads/writes of `lastSignature` happen on the single polling goroutine; the mutex
  correctly protects only the cross-goroutine `current` field. Not a race. (A clarifying
  comment in `update()` would be welcome but is optional.)

## Verification checklist (run after each phase)

- [ ] `cd agent && go vet ./... && go test ./...`
- [ ] `cd cli && bun test && bunx tsc --noEmit` (or the repo's typecheck script)
- [ ] `cd actions && bun test`
- [ ] Manual smoke: `cbai status`, `cbai summary` against local Ollama
- [ ] `STATUS.md` updated; `prd.md` §14.1 updated for completed feature work
