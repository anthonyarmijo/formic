# Phase 2 Goal Prompt

Use this prompt to start the next ambitious Phase 2 implementation thread.

```text
/goal Continue Formic Phase 2 by implementing the embedded browser preview foundation so a Project Group can load a local app, persist its preview URL, capture DOM/screenshot context, and expose that context to chat in a small, trustworthy first pass.

Repo: /Users/anthonyarmijo/dev/apps/personal/formic
Branch: codex/electron-shell-spike
Draft PR: https://github.com/anthonyarmijo/formic/pull/1
Do not merge.

Context:
- Phase 0 packaging is good enough for now. Do not do DMG/signing/notarization/updater/pkg/runtime-pruning work.
- Phase 1 terminal/context work is the current visible checkpoint. Do not expand Hindsight memory behavior unless Phase 2 needs only a tiny diagnostic hook.
- Phase 2 goal from the implementation plan: embedded Chromium preview where the LLM can see the same local app the user sees.
- Electron plus embedded Chromium is the desktop-first path.
- React/Next.js is the v1 visual-editor target, but Phase 2 should not implement click-to-source or editing yet.
- Repo instrumentation must never happen silently. Do not mutate linked Project repos or build configs.
- Preserve existing chat, Groups, terminal, Hermes, and Open WebUI routing behavior.

Expected work:
1. Read:
   - docs/dev/phase-1.md
   - docs/dev/desktop.md
   - docs/dev/phase-2-goal-prompt.md
   - .hermes/plans/2026-05-28_formic-implementation-plan.md if available
   - Electron main/preload/renderer integration files under apps/desktop or the current desktop package
   - current Svelte chat/layout/Group files around Project Groups, terminal pane, and Group metadata
   - existing desktop IPC patterns and any browser/webview related code if present

2. Implement the embedded preview surface:
   - Add a Project-only preview pane in the main app layout using Electron webview or BrowserView, choosing the approach that best fits the existing desktop architecture.
   - Keep the preview compact and work-focused: URL bar, back, forward, reload, open externally, and devtools toggle if available.
   - Persist preview URL per Project Group in existing Group metadata, using a conservative key such as `preview_url`.
   - Default the first preview URL from Group metadata when present; otherwise leave the URL empty and ready for localhost input.
   - Keep non-Project chats unaffected.

3. Implement preview capture/context plumbing:
   - Add an authenticated, user-scoped backend or desktop bridge path for preview context if needed.
   - Capture screenshot bytes or a data URL from the active preview.
   - Capture DOM structure enough for LLM inspection: URL, title, visible text summary, selected element metadata if available, and a bounded DOM snapshot.
   - Capture console messages and basic network request metadata if practical in the first pass.
   - Keep all captures local. Do not send preview data anywhere except through the user's explicit chat request path.

4. Expose preview context to chat:
   - Add a small UI control to attach or refresh current preview context for the active Project chat.
   - Make the chat request include preview context only when the user invokes it or when an explicit Project preview mode is enabled in UI.
   - Add concise status for capture success/failure.
   - Avoid walls of explanatory text in-app.

5. Desktop integration constraints:
   - Prefer existing Electron IPC/preload patterns.
   - Keep web security choices explicit and narrow.
   - Do not enable broad Node integration inside arbitrary preview pages.
   - Do not add repo instrumentation, Onlook parser integration, click-to-source, or file edits in this checkpoint.

6. Verification:
   - Run focused frontend checks for touched Svelte/TS files.
   - Run desktop/electron build checks for touched desktop files.
   - If backend endpoints are touched, run targeted backend tests for those endpoints/helpers.
   - Smoke in dev mode with `npm run dev:desktop:all` if feasible.
   - In the smoke, create or select a Project Group, load a local URL such as `http://127.0.0.1:5173`, reload it, verify URL persistence, capture preview context, and confirm the chat can receive a bounded screenshot/DOM context payload.

Definition of done:
- A Project Group can show an embedded preview pane.
- The preview URL persists per Project Group.
- The user can refresh/capture preview context.
- The captured context includes at least URL, title, screenshot, and bounded DOM/text.
- No linked Project repo is modified.
- Non-Project chats behave as before.
- Phase 3 work remains explicitly deferred.
```
