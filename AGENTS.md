# Agent continuity

- Keep the primary task moving after a delegated agent reports a capacity error.
- Preserve and inspect any uncommitted work left in the shared worktree before retrying.
- For complex delegated work, prefer Sol or Terra at High reasoning; if the selected model is at capacity, retry the same bounded task with Luna at High reasoning.
- For clear, repeatable implementation or test fixes, prefer Luna at High reasoning directly.
- A capacity retry must keep the original acceptance criteria, run the same verification, and create a normal follow-up commit rather than rewriting prior commits.
- The agent may choose models for delegated subagents, but it cannot change the active model of the user's main desktop chat. Ask the user to use the composer model switcher only when the main chat itself is blocked.
