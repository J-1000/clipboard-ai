# URL actions

## `summarize_url`

`summarize_url` expects clipboard text to be a single `http://` or `https://` URL. It fetches the page, accepts only `text/html` and `text/plain`, extracts readable text without a browser, and summarizes the result.

Limits:

- 10 second fetch timeout
- 2 MB response limit
- No headless browser or JavaScript execution

Example disabled trigger:

```toml
[actions.summarize_url]
enabled = false
trigger = "regex:^https?://\\S+$"
```

Fetching the URL is a network request to that site. Safe mode governs LLM provider calls; it does not prevent this URL fetch. Leave the action disabled unless that behavior is acceptable.
