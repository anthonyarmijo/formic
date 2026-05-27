# Formic

A developer-first AI workspace — built on [Open WebUI](https://github.com/open-webui/open-webui).

Formic turns Open WebUI's multi-provider chat platform into a hybrid coding + conversation environment. Hermes and OpenClaw operate as your co-pilots: they browse the web, edit your apps visually, remember across sessions, and share project context.

## What makes Formic different

- **Agent co-pilots (Hermes + OpenClaw)** — More than model switching. Hermes orchestrates across sessions with persistent memory, while OpenClaw handles deep reasoning and complex workflows. They're integrated at the platform level, not bolted on as plugins. Both can drive the built-in browser, read your codebase, and edit your apps. You're the driver — they're the co-pilots who actually remember what you're building.

- **Developer/Personal hybrid** — IDE-like integrations for coding, combined with a clean chat experience for thinking and planning. Jump between writing code and talking through ideas without switching tools. Inline diffs, terminal access, file references — the stuff you need when you're building, stripped of the noise you don't.

- **Visual app editor** — Edit your web apps by pointing at what you want to change. No more describing UI elements in words — click, annotate, and the agent applies the edit. Think browser DevTools meets AI pair programming.

- **Formic Groups** (replaces folders) — Project-level shared context that goes deeper than RAG. Groups connect to Hermes memory and Hindsight for cross-session awareness. Files, prompts, and conversation history are all scoped to the group, and the agents maintain context across chats. Not just "attach these files" — the group knows your project.

- **Built-in browser** — A real, rendered browser inside Formic. Agents can navigate pages, fill forms, test your apps, and pull in documentation. No copy-pasting URLs into a separate window.

- **Chronicle-lite** — Browsable conversation history with full-text search across every session. Transcript views show tool calls, agent reasoning, and edits. Pick up exactly where you left off, days or weeks later.

## What's already here (from Open WebUI)

Formic inherits everything Open WebUI ships: multi-provider chat (Ollama, OpenAI, Anthropic, and 50+ more), RAG with 9 vector databases, web search, image generation, voice/video, MCP support, granular RBAC, Docker/Kubernetes deployment, PWA mobile support, and plugin extensibility.

## Running locally

```bash
docker run -d -p 3333:8080 \
  -v open-webui:/app/backend/data \
  --name formic \
  --restart always \
  ghcr.io/open-webui/open-webui:main
```

Then open http://localhost:3333.

## Development

```bash
git clone https://github.com/anthonyarmijo/formic.git
cd formic

# Backend
cd backend
pip install -r requirements.txt
bash start.sh

# Frontend
cd src
npm install
npm run dev
```

## Roadmap

- **v0.1** — Chronicle-lite, agent co-pilot integration (Hermes + OpenClaw), Formic Groups with memory/Hindsight, attribution (in progress)
- **v0.2** — Visual app editor (click-to-edit for web apps), IDE integrations (inline diffs, terminal, file refs)
- **v0.3** — Built-in browser with agent control, full Chronicle (daily log + subject index)
- **v0.4+** — Public roadmap TBD — driven by what actually gets used

## How Formic Groups work (vs Open WebUI folders)

Open WebUI folders attach files via RAG — they get chunked, embedded, and searched for relevant snippets during chat. That's useful but narrow: each folder is an island with no memory across sessions.

Formic Groups extend this:
- **Group memory** — Hermes and Hindsight maintain persistent context across every chat in the group. Decisions, preferences, and project state survive between sessions.
- **Live context** — Files aren't just embedded; agents can read them directly, run code, and apply edits.
- **Shared instructions** — Group-level system prompts that evolve as the project does. The agents update them as they learn what you're building.
- **Unified history** — Chronicle-lite indexes every group conversation. Search across months of chats in seconds.

## License

Formic is [AGPL-3.0](LICENSE), inheriting from Open WebUI.

## Attribution

Built on [Open WebUI](https://github.com/open-webui/open-webui) by [Timothy Jaeryang Baek](https://github.com/tjbck) and [contributors](https://github.com/open-webui/open-webui/graphs/contributors). Formic extends it with agent co-pilots, visual editing, built-in browsing, and persistent project memory.
