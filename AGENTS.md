# AGENTS.md

## Commit Policy

- All code changes must be committed as **atomic commits**.
- A single commit should contain exactly one logical change (for
example: `db`, `api`, or `tests`, but not mixed).
- Do not bundle refactor + behavior change + tests into one
commit unless the change is truly inseparable.
- For multi-part work, prefer this order:
  1. Data/model layer change
  2. API/behavior wiring
  3. Tests for that behavior
  4. Follow-up docs/changelog updates
- Keep commits small and reviewable (easy to revert
independently).
- If a task naturally spans multiple concerns, split into
multiple commits and report the planned commit list before
committing.
- Do not squash unrelated changes into the same commit.
- Before creating any commits for multi-part work, the agent
must provide a numbered planned commit list, then execute it
without waiting for additional user approval.
- The agent must follow the posted commit plan exactly. If the
plan changes, the agent must post an updated numbered plan
before continuing.

If you want, I can create this exactly as-is now, or adjust
wording/strictness first.
