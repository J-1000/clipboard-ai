#!/usr/bin/env node
// Minimal OpenAI-compatible chat-completions stub for scripts/e2e-contract.sh.
// Prints "PORT=<n>" on stdout once it is listening on a random loopback port.
import http from "node:http";

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    let body = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      // fall through with an empty body
    }
    const wantsJSON = body?.response_format?.type === "json_object";
    const content = wantsJSON
      ? '{"category":"other","confidence":0.9,"reasoning":"stub"}'
      : "STUB-OUTPUT";
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        id: "stub",
        object: "chat.completion",
        model: body?.model ?? "stub",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      })
    );
  });
});

server.listen(0, "127.0.0.1", () => {
  console.log(`PORT=${server.address().port}`);
});
