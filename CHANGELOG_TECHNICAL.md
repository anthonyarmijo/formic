# Formic Technical Changelog

> Fork of Open WebUI (`open-webui/open-webui`) — `anthonyarmijo/formic`
> Branch: `feat/workspaces` | 6 committed revisions, 18 files changed (+729/-17)

---

## v0.1.0 — Groups & Workspaces (in progress)

### Commit: `5f408e105` — Workspaces Backend Route + Dual License Fix
**2026-05-27**

**Backend**
- **NEW** `backend/open_webui/routers/workspaces.py` (267 lines) — Full CRUD router at `/api/v1/workspaces/`
  - `GET /api/v1/workspaces/` — list with optional filters (`?type=project&workspace=personal&has_path=true&tag=python`)
  - `POST /api/v1/workspaces/` — create via existing `FolderForm`
  - `GET /api/v1/workspaces/{id}` — get by ID
  - `POST /api/v1/workspaces/{id}/update` — update name/metadata
  - `DELETE /api/v1/workspaces/{id}` — delete with optional content cleanup
  - Uses `/api/v1/workspaces` namespace to avoid collision with upstream `/api/v1/groups` (RBAC groups)
- **MODIFIED** `backend/open_webui/main.py` (+2) — workspaces import + router registration
- **MODIFIED** `backend/open_webui/utils/middleware.py` (+11) — Hermes Agent background task skip
- **NEW** `docs/dev/patches/hermes-skip-background-tasks.md` (41 lines)
- **MODIFIED** `README.md` — dual license: MIT (Formic additions) + LICENSE.upstream (Open WebUI BSD+custom branding rider)

---

### Commit: `d300274d4` — FolderModal Form Fields + Formic Branding Fix
**2026-05-28**

**Frontend**
- **MODIFIED** `src/lib/components/layout/Sidebar/Folders/FolderModal.svelte` (+96/-?) — Group Type dropdown (Topic/Project/Scratch), conditional Project Directory field with `project_path` binding, Tags input, Workspace field, Knowledge file attachment

**Branding**
- **MODIFIED** `backend/open_webui/static/favicon.png` — replaced upstream 21KB OI logo with 283B Formic ant logo
- **MODIFIED** `backend/open_webui/static/favicon-dark.png` — ant logo
- **MODIFIED** `backend/open_webui/static/favicon.svg` — ant logo
- **MODIFIED** `backend/open_webui/static/favicon-96x96.png` — ant logo (7.5KB)
- **MODIFIED** `backend/open_webui/static/splash.png` — ant trail splash (1.4KB)
- **MODIFIED** `backend/open_webui/static/splash-dark.png` — ant trail splash dark (1.5KB)
- **MODIFIED** `Dockerfile` (+6) — RUN step copies Formic assets from `backend/open_webui/static/` → `build/static/` (config.py overwrites backend static from build/static at runtime)

**Root cause of branding bug:** `config.py` copies from `FRONTEND_BUILD_DIR/static/` → `STATIC_DIR` on every container start. The build's `static/` subdirectory still had upstream OI logos. Dockerfile fix ensures both directories get Formic assets during build.

---

### Commit: `bff9c197e` — IDE Buttons in Sidebar
**2026-05-28**

**Frontend**
- **MODIFIED** `src/lib/components/layout/Sidebar/RecursiveFolder.svelte` (+27) — VS Code (`vscode://file/{path}`) and Cursor (`cursor://file/{path}`) protocol links, rendered on hover for Project groups with `project_path`

---

### Commit: `c1cf0326a` — Inline Terminal Drawer
**2026-05-28**

**Frontend**
- **NEW** `src/lib/stores/terminal.ts` (4 lines) — Svelte writable stores: `terminalOpen`, `terminalProjectPath`
- **NEW** `src/lib/components/chat/TerminalDrawer.svelte` (198 lines) — Collapsible bottom panel wrapping `XTerminal.svelte`
  - Props: `open`, `projectPath`, `folderId`
  - Calls `setCwd` API before mounting terminal session
  - Resize handle (120-500px range via mousedown/mousemove)
  - Header bar with project name + full path + close button
  - Fly transition on open/close, mounts XTerminal only when open
- **MODIFIED** `src/lib/components/chat/Chat.svelte` (+11) — Renders TerminalDrawer between chat messages `<Pane>` and `<ChatControls>`, conditional on `$selectedFolder.data.group_type === 'project' && $selectedFolder.data.project_path`
- **MODIFIED** `src/lib/components/layout/Sidebar/RecursiveFolder.svelte` (+18) — Terminal toggle button in group-hover toolbar for project groups (one-click: select folder → set stores → navigate → opens bottom pane)

---

### Commit: `7fe7b7943` — Bundled Open Terminal Server
**2026-05-28**

**Infrastructure**
- **MODIFIED** `Dockerfile` (+4) — `pip3 install open-terminal`, ENV `TERMINAL_SERVER_CONNECTIONS` pre-configures "Formic Terminal" at `http://localhost:8000` with API key `formic-terminal-key`
- **MODIFIED** `backend/start.sh` (+6) — Starts `open-terminal run --host 127.0.0.1 --port 8000` in background before uvicorn
- **Container runtime:** Added bind mount `-v /Users/anthonyarmijo:/Users/anthonyarmijo` so terminal can access host project directories

---

### Commit: `a2ab6c4d2` — Terminal UX Polish
**2026-05-28**

**Frontend**
- **MODIFIED** `src/lib/components/chat/TerminalDrawer.svelte` — Replace inline SVG header icon with `Terminal.svelte` component import (monitor + `>` prompt)
- **MODIFIED** `src/lib/components/layout/Sidebar/RecursiveFolder.svelte` — Terminal button moved OUT of `hidden group-hover:flex` div to always-visible position for project groups. IDE buttons remain hover-only. Full path shown in tooltip.

---

## Uncommitted Work (Codex)

### Groups API and Sidebar Metadata
- `backend/open_webui/models/folders.py` now exposes sanitized `data` on folder list responses so the sidebar can render Group metadata without fetching every Group individually.
- `backend/open_webui/routers/folders.py` now supports `GET /api/v1/folders/?type=&has_path=&tag=&workspace=` and `GET /api/v1/folders/workspaces`.
- Folder list metadata is limited to `group_type`, `project_path`, `tags`, and `workspace`; larger/private folder data such as knowledge files and system prompts stay out of list responses.
- `src/lib/apis/folders/index.ts` accepts optional folder-list filters and adds `getFolderWorkspaces()`.

### Group Filtering and Workspace Switching
- `src/lib/components/layout/Sidebar/Folders.svelte` adds the Groups filter bar:
  - Workspace selector persisted in `localStorage` as `formic.activeWorkspace`
  - Group type chips for All, Projects, Topics, and Has Terminal
  - Search across Group names and tags
  - Sort modes for A-Z, Recent, and Type
- `src/lib/components/layout/Sidebar.svelte` binds the active workspace into the Groups list and defaults newly-created Groups to the selected workspace, or `personal` when All Workspaces is active.
- `src/lib/components/layout/Sidebar/Folders/FolderModal.svelte` accepts `defaultWorkspace` and keeps the workspace field aligned with the active sidebar workspace for new Groups.

### Inbox v0.1
- `backend/open_webui/models/chats.py` adds `ChatInboxItemResponse` and `get_unread_chats_by_user_id()`, using `updated_at > last_read_at` or missing `last_read_at` as the unread heuristic.
- `backend/open_webui/routers/chats.py` adds:
  - `GET /api/v1/chats/inbox` for unread chats with Group/Ungrouped context and a compact preview
  - `POST /api/v1/chats/{id}/mark-read` for Inbox dismiss/open behavior
- `src/lib/apis/chats/index.ts` adds `getInboxChats()` and `markChatReadById()`.
- `src/lib/components/layout/Sidebar/Inbox.svelte` adds the sidebar Inbox item with a 30-second polled unread count.
- `src/lib/components/chat/InboxView.svelte` adds the Inbox view grouped by source Group/Ungrouped, with open-to-read, dismiss, and mark-all-read actions.
- `src/routes/(app)/inbox/+page.svelte` routes the main app view to `InboxView`.

### Terminal and IDE UX
- `src/lib/components/chat/TerminalDrawer.svelte` now passes the Group/folder id into `XTerminal` as the session id, matching the `setCwd()` session id so Project terminals open in the intended `project_path`.
- `src/lib/components/chat/ProjectIdeLauncher.svelte` adds a Navbar launcher with persisted VS Code/Cursor preference in `localStorage` (`formic.defaultProjectIde`).
- `src/lib/components/chat/Navbar.svelte` renders `ProjectIdeLauncher` when the selected Group is a Project with `project_path`.
- `src/lib/components/layout/Sidebar/RecursiveFolder.svelte` keeps the row action layout compact after moving IDE launch actions to the Navbar.

### User-Facing Rename and Polish
- Visible labels in the sidebar, Group modal, Group menu, chat move menus, admin settings, permissions, placeholder controls, and knowledge command headings now use "Groups" terminology while backend names and API contracts stay `folders`.
- `src/lib/components/chat/Placeholder.svelte` shows `$WEBUI_NAME` in the empty chat greeting.
- `src/lib/components/chat/MessageInput.svelte` adds a Project terminal toggle button when the active Group has a `project_path`.
- `src/lib/components/layout/Sidebar.svelte` keeps the updated translucent sidebar styling from the current branch.

---

## File Summary

| File | Status | Lines |
|------|--------|-------|
| `backend/open_webui/routers/workspaces.py` | NEW | +267 |
| `backend/open_webui/routers/folders.py` | MODIFIED (uncommitted) | filters + workspace discovery |
| `backend/open_webui/models/folders.py` | MODIFIED (uncommitted) | list response data |
| `backend/open_webui/models/chats.py` | MODIFIED (uncommitted) | Inbox response + unread query |
| `backend/open_webui/routers/chats.py` | MODIFIED (uncommitted) | Inbox + mark-read endpoints |
| `backend/open_webui/main.py` | MODIFIED | +2 |
| `backend/open_webui/utils/middleware.py` | MODIFIED | +11 |
| `backend/open_webui/static/*` (6 files) | MODIFIED | branding |
| `backend/start.sh` | MODIFIED | +6 |
| `Dockerfile` | MODIFIED | +14 |
| `README.md` | MODIFIED | +2 |
| `src/lib/stores/terminal.ts` | NEW | +4 |
| `src/lib/components/chat/TerminalDrawer.svelte` | NEW | +198 |
| `src/lib/components/chat/Chat.svelte` | MODIFIED | +11 |
| `src/lib/components/chat/ProjectIdeLauncher.svelte` | NEW (uncommitted) | +95 |
| `src/lib/components/chat/InboxView.svelte` | NEW (uncommitted) | Inbox main view |
| `src/lib/components/chat/Navbar.svelte` | MODIFIED (uncommitted) | +9 |
| `src/lib/components/chat/Placeholder.svelte` | MODIFIED (uncommitted) | +3/-5 |
| `src/lib/components/layout/Sidebar/Inbox.svelte` | NEW (uncommitted) | Inbox sidebar item |
| `src/routes/(app)/inbox/+page.svelte` | NEW (uncommitted) | Inbox route |
| `src/lib/apis/chats/index.ts` | MODIFIED (uncommitted) | Inbox API helpers |
| `src/lib/apis/folders/index.ts` | MODIFIED (uncommitted) | folder filter/workspace helpers |
| `src/lib/components/layout/Sidebar/Folders.svelte` | MODIFIED (uncommitted) | filters + workspace switcher |
| `src/lib/components/layout/Sidebar/Folders/FolderModal.svelte` | MODIFIED | +96 |
| `src/lib/components/layout/Sidebar/RecursiveFolder.svelte` | MODIFIED | +46/-? |
| `docs/dev/patches/hermes-skip-background-tasks.md` | NEW | +41 |
