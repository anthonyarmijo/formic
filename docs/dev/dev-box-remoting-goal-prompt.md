# Always-On Dev Box Remoting Goal Prompt

Use this prompt to start an ambitious implementation thread for Formic host/client remoting.

```text
/goal Make concrete progress on Formic's "always-on dev box" remoting mode: a persistent desktop/server machine can host Formic Core, terminals, Project paths, and preview targets, while another device can connect through Formic as a trusted client.

Repo: /Users/anthonyarmijo/dev/apps/personal/formic
Start from: dev or the latest feature branch created from dev.
Do not merge until reviewed.

Context:
- Formic already has the bones: FORMIC_SERVER_MODE=external, FORMIC_SERVER_URL, FORMIC_RENDERER_URL, FORMIC_TERMINAL_MODE=external, FORMIC_TERMINAL_URL, external backend probing, and local terminal registration.
- Current desktop defaults are still local-first: Electron-spawned FastAPI and OpenTerminal bind to 127.0.0.1, renderer dev uses 127.0.0.1:5173, and Project preview copy assumes localhost.
- The desired product shape is "Formic Host" on a persistent dev box and "Formic Client" on a laptop or other device. The host owns filesystem access, terminal sessions, memory, browser preview execution, and linked Project repos. The client provides UI and explicit user control.
- This must preserve the safety rule: never mutate a linked repo or build config silently. Reads and terminal access should be visible and scoped to trusted Project Groups.
- Prefer LAN/Tailscale/SSH-tunnel friendly design first. Do not build a cloud sync service.

Expected work:
1. Read:
   - docs/dev/desktop.md
   - docs/dev/phase-1.md
   - docs/dev/phase-2-goal-prompt.md
   - apps/desktop/src/main.ts and preload code
   - backend terminal/config routes and Group Context helpers
   - Project preview and terminal Svelte components
   - .hermes/plans/2026-05-28_formic-implementation-plan.md if available

2. Define the remoting contract:
   - Add a short ADR or dev doc that names modes: local desktop, host, client, and external/server-only.
   - Document which process owns backend, terminal, Project filesystem, preview browser, auth/session, and memory in each mode.
   - Identify the minimum secure first pass: explicit host URL, health/ready probe, authenticated session reuse, optional external terminal, and clear diagnostics.

3. Implement a first useful slice:
   - Add environment/config support for host/client mode without breaking the current local desktop loop.
   - Let Electron client intentionally attach to a remote Formic backend using FORMIC_SERVER_MODE=external and a non-local FORMIC_SERVER_URL.
   - Make startup diagnostics say "remote host" vs "local sidecar" clearly.
   - Allow remote terminal registration through FORMIC_TERMINAL_MODE=external, FORMIC_TERMINAL_URL, and FORMIC_TERMINAL_KEY, with visible status.
   - Update Project preview UX copy so it can accept host-reachable URLs, not only localhost.
   - Keep spawned local sidecars loopback-bound unless host mode is explicitly selected.

4. Security boundaries:
   - Do not expose an unauthenticated backend or terminal.
   - Do not default to 0.0.0.0 for packaged desktop sidecars.
   - Prefer documented Tailscale/SSH tunnel usage over raw LAN exposure for the first pass.
   - Keep CORS origins explicit for the configured renderer/client URL.

5. Verification:
   - Run focused TypeScript/Svelte checks for touched frontend/desktop files.
   - Run targeted backend tests if backend config/routes change.
   - Smoke local desktop mode to ensure it still spawns local sidecars.
   - Smoke external mode against a locally reachable URL or mock health server and confirm diagnostics show remote/external mode.

Definition of done:
- There is a clear host/client remoting contract in docs.
- A client can intentionally attach to an external Formic backend without pretending it is local.
- Remote/external terminal config is visible and diagnosable.
- Local desktop behavior is unchanged by default.
- No linked Project repo is mutated.
- Remaining work is listed as concrete follow-up tasks.
```
