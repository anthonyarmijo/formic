# Hermes Agent — Skip Background Tasks

**Date:** 2026-05-27
**File:** `backend/open_webui/utils/middleware.py` → `background_tasks_handler()`

## Problem

Open WebUI fires 4-6 background LLM tasks after every chat message completes:
- Title generation (`TASKS.TITLE_GENERATION`)
- Tag generation (`TASKS.TAGS_GENERATION`)
- Follow-up suggestion (`TASKS.FOLLOW_UP_GENERATION`)
- Web search analysis (`TASKS.QUERY_GENERATION`)
- Memory/skill review prompts

These tasks all hit the same API key as the user's actual message. When connected to Hermes Agent via the API server, each task creates a fresh agent session, loads the full system prompt (~8KB + SOUL.md + memory), and makes multiple tool calls. This creates severe API key contention — the user's message gets queued behind 4-6 parallel background requests.

## Fix

Added an early return in `background_tasks_handler()` when the model ID is `hermes-agent`:

```python
model = ctx.get('model', {})
if isinstance(model, dict):
    model_id = model.get('id', '')
    if model_id == 'hermes-agent':
        return
```

Hermes Agent manages its own session metadata (titles, context, follow-ups, memory) — it doesn't need Open WebUI's task pipeline.

## Alternatives considered

1. **Environment variables** — Set `ENABLE_TITLE_GENERATION=false`, `ENABLE_TAGS_GENERATION=false`, `ENABLE_FOLLOW_UP_GENERATION=false` in the Docker container. Rejected because it disables these features globally for ALL models, not just Hermes.

2. **Separate task model** — Configure `TASK_MODEL_EXTERNAL` to use a lightweight model. Rejected because it adds infrastructure complexity for a feature Hermes doesn't need.

3. **Per-model task config** — Would require a schema change and UI work. Rejected as overkill.

## Reverting

Remove the block between the `# FORMIC PATCH` comment and `message = None` in `background_tasks_handler()`.
