# Phase 1 Todo

Phase 1 is focused on Group-scoped memory, Project agent activity, and making the local desktop workflow reliable enough to support real app-feature work. Packaging, signing, notarization, DMG polish, updater work, and `.pkg` work stay out of scope unless they become concrete blockers.

## Project Terminal Reliability

- Show terminal active/provider/CWD diagnostics in the chat or Group UI.
- Add a quick Project terminal smoke action such as `pwd` plus `git status`.
- Make missing terminal/provider/tool failures actionable instead of letting the model explain around them.
- Keep the bundled local OpenTerminal sidecar as the default desktop path, while preserving manual/admin terminal configuration.

## Integrated Terminal GUI

- Move the terminal surface into a bottom pane docked under the main chat/app area.
- Support resize, collapse, and close behavior that persists while navigating inside a Project Group.
- Show the active Project path, session key, and terminal provider in the pane chrome.
- Keep the chat terminal selector and the visible terminal pane in sync.
- Preserve Project Group CWD behavior: the terminal session key should remain `formic-group:<folder_id>` and the CWD should resolve to the normalized `project_path`.

## Group Context Observability

- Keep `group_id`, `project_path`, Hermes conversation key, and Hindsight bank id consistent across Project chats.
- Add a small debug/status surface for inspecting Group Context without curl/log spelunking.
- Preserve the provider-neutral `GroupContext` contract; keep Hindsight-specific fields out of the core context.
- Keep Open WebUI Memory clearly scoped as Global User Memory, separate from Group memory.

## Hindsight Memory Bridge

- Start with a thin Hindsight bridge behind the generic memory-provider boundary.
- Derive deterministic per-user/per-group Hindsight bank ids.
- Add simple recall/write diagnostics before expanding memory UX.
- Keep room for later provider adapters such as Honcho, Mem0, Supermemory, or others.

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

## Recommended Next Checkpoint

Build the integrated terminal bottom pane and Group Context status surface first. That gives Phase 1 a visible, testable foundation before expanding Hindsight recall/write behavior.
