# Phase 1 Remaining Tasking

Phase 1 is focused on Group-scoped memory, Project agent activity, and making the local desktop workflow reliable enough to support real app-feature work. Packaging, signing, notarization, DMG polish, updater work, and `.pkg` work stay out of scope unless they become concrete blockers.

## Current Checkpoint

The first visible checkpoint is in progress/implemented in the Phase 1 branch:

- Integrated Project terminal pane docked under the main chat area.
- Compact Group Context status surface for Project Groups.
- Shared Project terminal default behavior around `formic-local-terminal`, `formic-group:<folder_id>`, and normalized `project_path`.

Treat the rest of this document as the remaining Phase 1 tasking until the checkpoint is merged and verified end to end.

## Project Terminal Reliability

- Verify the bottom terminal pane and Group Context status surface in the desktop loop.
- Add a quick Project terminal smoke action such as `pwd` plus `git status`.
- Show the smoke action result in a compact, actionable status state.
- Make missing terminal/provider/tool failures actionable instead of letting the model explain around them.
- Keep terminal diagnostics tied to the active Project Group, selected model, selected terminal, and `formic-group:<folder_id>` session key.
- Keep the bundled local OpenTerminal sidecar as the default desktop path, while preserving manual/admin terminal configuration.

## Integrated Terminal GUI

- Finish verification for resize, collapse, close, and navigation persistence inside Project Groups.
- Confirm the visible pane, chat terminal selector, chat request `terminal_id`, and OpenTerminal session all resolve the same active terminal.
- Preserve Project Group CWD behavior: the terminal session key must remain `formic-group:<folder_id>` and the CWD must resolve to normalized `project_path`.
- Keep non-Project chats unaffected.

## Group Context Observability

- Verify the status surface against `GET /api/v1/workspaces/{id}/context` in authenticated desktop/web flows.
- Keep `group_id`, normalized `project_path`, Hermes conversation key, and Hindsight bank id consistent across Project chats.
- Add concise failure states for unavailable context, terminal mismatch, or missing terminal tools.
- Preserve the provider-neutral `GroupContext` contract; keep Hindsight-specific fields out of the core context.
- Keep Open WebUI Memory clearly scoped as Global User Memory, separate from Group memory.

## Hindsight Memory Bridge

- Start with a thin Hindsight bridge behind the generic memory-provider boundary.
- Derive deterministic per-user/per-group Hindsight bank ids.
- Add simple recall/write diagnostics before expanding memory UX.
- Do not start broad memory UX until diagnostics prove the bridge contract is stable.
- Keep room for later provider adapters such as Honcho, Mem0, Supermemory, or others.

## Memory Core

- Design the `packages/memory-core` interface around `write_episode`, `recall_for_query`, `summarize_session`, and `evolve_system_prompt`.
- Add the default local backend using SQLite plus the already-bundled Chroma path.
- Use per-Group memory namespaces.
- Inject memory into the chat pipeline as pre-prompt recall and post-response episode write.
- Stub `memory-hermes` and `memory-openclaw` adapters with the same interface.
- Add settings UI to pick the active memory backend per Group.

## Agent Activity

- Implement the Live Activity Pane from the deferred agent-activity UX plan.
- Surface tool calls, reasoning, recall events, write events, terminal smoke status, and failure diagnostics without turning the chat into a log dump.

## Project File Interaction Safety

- Allow low-risk reads and shell inspection automatically for trusted local Project Groups.
- Require preview/approval before repo, build config, or broad file edits.
- Keep project path as context/default CWD; file mutation remains tool-mediated.
- Keep repo instrumentation explicit and reversible. Never silently mutate a linked project.

## Project Group Polish

- Improve empty states, labels, and helper text around Project paths and terminal availability.
- Add small affordances such as opening the project folder locally when useful.
- Keep Project Groups as the product boundary for memory, tools, and history.
- Continue using Group metadata rather than replacing existing folder prompt/file behavior all at once.

## Recommended Next Checkpoints

1. Verify and polish the integrated terminal bottom pane and Group Context status surface in `npm run dev:desktop:all`.
2. Add Project terminal smoke diagnostics: `pwd`, `git status`, active terminal/provider, session key, and actionable failure state.
3. Add the thin Hindsight bridge diagnostics and memory-provider boundary.
4. Start the Live Activity Pane once terminal and memory diagnostics produce useful events.
