# Formic Changelog

> Built on Open WebUI. Made for developers who live in the terminal.

---

## v0.1.0 — Groups & Workspaces (Preview)

### 🏗️ Project Groups
Folders are now **Groups** — with three types to match how you actually work:
- **Project** — links to a local directory, enables terminal + IDE integration
- **Topic** — chat organizer, no directory required
- **Scratch** — temporary, auto-cleanup

When you create a Project group and set a directory path, Formic unlocks:

### 🖥️ Built-in Terminal
One click opens a real shell in your project directory — no separate install, no config. Bundled Open Terminal server starts automatically with the app. Resize the pane, run commands, and it feels like VS Code's integrated terminal.

### 🛠️ IDE Integration
Click to open any Project group directly in VS Code or Cursor. Set your preferred IDE and Formic remembers it.

### 📋 Rich Metadata
Every group can have:
- **Tags** — filter and organize across workspaces
- **System Prompts** — per-group AI behavior
- **Knowledge Files** — attach docs, code, and references
- **Workspace** — group groups into Personal, Work, or custom contexts

### 🔎 Group Filtering
The sidebar can now narrow Groups by type, terminal availability, workspace, name, or tag. Sort Groups alphabetically, by recent activity, or by type.

### 📥 Inbox
A new Inbox surfaces unread chat activity across Groups and ungrouped chats. Open a chat from Inbox to mark it read, or dismiss items without leaving the Inbox.

### 🐜 Fresh Branding
Formic gets its own identity — ant logo, dark splash screen, and a clean forked codebase at `anthonyarmijo/formic` with dual MIT + BSD licensing.

### 🔌 Workspaces API
Full CRUD backend at `/api/v1/workspaces/`, folder-list filters, workspace discovery, and Inbox read-state endpoints. Built for future agent orchestration.

---

## Up Next

- **Agent Activity UX** — live reasoning and tool-call visibility
- **Deeper Group Defaults** — model/provider preferences and richer memory per workspace
