from __future__ import annotations

import os
from typing import Any

HINDSIGHT_PROVIDER_ID = 'hindsight'
HERMES_AGENT_MODEL_ID = 'hermes-agent'
PROJECT_PATH_ERROR_MESSAGE = 'Project directory must be an absolute path or start with ~/.'


def _clean_optional_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None

    value = value.strip()
    return value or None


def _clean_tags(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []

    tags = []
    for item in value:
        tag = _clean_optional_string(item)
        if tag and tag not in tags:
            tags.append(tag)

    return tags


def _clean_file_refs(files: Any) -> list[dict[str, Any]]:
    if not isinstance(files, list):
        return []

    refs = []
    for file in files:
        if not isinstance(file, dict):
            continue

        ref = {
            key: file[key]
            for key in ('id', 'name', 'type', 'collection_name', 'collection_names', 'legacy')
            if key in file
        }
        if ref:
            refs.append(ref)

    return refs


def build_hindsight_bank_id(user_id: str | None, group_id: str | None) -> str | None:
    if not user_id or not group_id:
        return None

    return f'formic:user:{user_id}:group:{group_id}'


def build_formic_group_conversation_id(group_id: str | None) -> str | None:
    if not group_id:
        return None

    return f'formic-group:{group_id}'


def normalize_project_path(value: Any, *, home_dir: str | None = None) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(PROJECT_PATH_ERROR_MESSAGE)

    value = value.strip()
    if not value:
        return ''

    if value == '~' or value.startswith('~/'):
        home = home_dir or os.path.expanduser('~')
        value = os.path.join(home, value[2:]) if value.startswith('~/') else home

    if not os.path.isabs(value):
        raise ValueError(PROJECT_PATH_ERROR_MESSAGE)

    return os.path.abspath(os.path.normpath(value))


def normalize_folder_project_path_data(data: dict | None) -> dict | None:
    if not data or 'project_path' not in data:
        return data

    return {
        **data,
        'project_path': normalize_project_path(data.get('project_path')),
    }


def build_formic_group_context(
    *,
    folder: Any | None,
    user_id: str | None,
    chat_id: str | None,
    file_refs: Any = None,
) -> dict[str, Any] | None:
    if not folder:
        return None

    data = folder.data if isinstance(getattr(folder, 'data', None), dict) else {}
    group_id = _clean_optional_string(getattr(folder, 'id', None))
    if not group_id:
        return None

    return {
        'group_id': group_id,
        'group_name': _clean_optional_string(getattr(folder, 'name', None)),
        'group_type': _clean_optional_string(data.get('group_type')),
        'project_path': _clean_optional_string(data.get('project_path')),
        'workspace': _clean_optional_string(data.get('workspace')),
        'tags': _clean_tags(data.get('tags')),
        'system_prompt': _clean_optional_string(data.get('system_prompt')),
        'file_refs': _clean_file_refs(file_refs),
        'chat_id': _clean_optional_string(chat_id),
        'user_id': _clean_optional_string(user_id),
    }


def build_formic_memory_context(group_context: dict[str, Any] | None) -> dict[str, Any] | None:
    if not group_context:
        return None

    bank_id = build_hindsight_bank_id(group_context.get('user_id'), group_context.get('group_id'))
    if not bank_id:
        return None

    return {
        'default_provider': HINDSIGHT_PROVIDER_ID,
        'providers': {
            HINDSIGHT_PROVIDER_ID: {
                'bank_id': bank_id,
                'scope': 'group',
                'group_id': group_context.get('group_id'),
                'user_id': group_context.get('user_id'),
            }
        },
    }


def build_formic_hermes_context(group_context: dict[str, Any] | None) -> dict[str, Any] | None:
    if not group_context:
        return None

    conversation = build_formic_group_conversation_id(group_context.get('group_id'))
    if not conversation:
        return None

    return {
        'conversation': conversation,
        'group_id': group_context.get('group_id'),
    }


def build_formic_context_bundle(
    *,
    folder: Any | None,
    user_id: str | None,
    chat_id: str | None,
    file_refs: Any = None,
) -> dict[str, Any]:
    group_context = build_formic_group_context(
        folder=folder,
        user_id=user_id,
        chat_id=chat_id,
        file_refs=file_refs,
    )

    return {
        'formic_group_context': group_context,
        'formic_memory_context': build_formic_memory_context(group_context),
        'formic_hermes': build_formic_hermes_context(group_context),
    }


def is_hermes_agent_model(model_id: Any) -> bool:
    if not isinstance(model_id, str):
        return False

    return model_id == HERMES_AGENT_MODEL_ID or model_id.endswith(f'.{HERMES_AGENT_MODEL_ID}')


def get_formic_hermes_conversation(metadata: dict | None, model_id: Any) -> str | None:
    if not metadata or not is_hermes_agent_model(model_id):
        return None

    formic_hermes = metadata.get('formic_hermes')
    if not isinstance(formic_hermes, dict):
        return None

    return _clean_optional_string(formic_hermes.get('conversation'))


def apply_formic_hermes_conversation(
    payload: dict[str, Any],
    *,
    metadata: dict | None,
    is_responses: bool,
) -> dict[str, Any]:
    if not is_responses:
        return payload

    conversation = get_formic_hermes_conversation(metadata, payload.get('model'))
    if conversation:
        payload.setdefault('conversation', conversation)

    return payload
