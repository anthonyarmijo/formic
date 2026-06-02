from types import SimpleNamespace

import pytest
from open_webui.utils.group_context import (
    apply_formic_hermes_conversation,
    build_formic_context_bundle,
    build_formic_group_context,
    build_formic_hermes_context,
    build_formic_memory_context,
    build_hindsight_bank_id,
    get_formic_hermes_conversation,
    normalize_folder_project_path_data,
    normalize_project_path,
)


def test_build_formic_group_context_for_project_group_sanitizes_provider_neutral_fields():
    folder = SimpleNamespace(
        id='folder-123',
        name='Formic Desktop',
        data={
            'group_type': 'project',
            'project_path': '/Users/example/dev/formic',
            'workspace': 'personal',
            'tags': ['desktop', 'desktop', '', 3],
            'system_prompt': 'Keep desktop packaging scoped.',
        },
    )
    files = [
        {
            'id': 'file-1',
            'name': 'README.md',
            'type': 'file',
            'content': 'do not leak full file content',
        }
    ]

    assert build_formic_group_context(
        folder=folder,
        user_id='user-abc',
        chat_id='chat-xyz',
        file_refs=files,
    ) == {
        'group_id': 'folder-123',
        'group_name': 'Formic Desktop',
        'group_type': 'project',
        'project_path': '/Users/example/dev/formic',
        'workspace': 'personal',
        'tags': ['desktop'],
        'system_prompt': 'Keep desktop packaging scoped.',
        'file_refs': [{'id': 'file-1', 'name': 'README.md', 'type': 'file'}],
        'chat_id': 'chat-xyz',
        'user_id': 'user-abc',
    }


def test_build_formic_group_context_supports_topic_and_scratch_groups():
    topic = SimpleNamespace(id='topic-1', name='Research', data={'group_type': 'topic'})
    scratch = SimpleNamespace(id='scratch-1', name='Scratch', data={'group_type': 'scratch'})

    assert build_formic_group_context(folder=topic, user_id='user-abc', chat_id='chat-1')['group_type'] == 'topic'
    assert build_formic_group_context(folder=scratch, user_id='user-abc', chat_id='chat-2')['group_type'] == 'scratch'


def test_build_formic_group_context_normalizes_legacy_home_project_paths(monkeypatch):
    monkeypatch.setenv('HOME', '/Users/example')
    folder = SimpleNamespace(
        id='folder-123',
        name='Legacy Project',
        data={'group_type': 'project', 'project_path': '~/dev/formic'},
    )

    assert build_formic_group_context(
        folder=folder,
        user_id='user-abc',
        chat_id='chat-xyz',
    )['project_path'] == '/Users/example/dev/formic'


def test_build_formic_group_context_omits_unsupported_relative_project_paths():
    folder = SimpleNamespace(
        id='folder-123',
        name='Invalid Project',
        data={'group_type': 'project', 'project_path': 'dev/formic'},
    )

    assert build_formic_group_context(
        folder=folder,
        user_id='user-abc',
        chat_id='chat-xyz',
    )['project_path'] is None


def test_build_formic_group_context_returns_none_without_folder():
    assert build_formic_group_context(folder=None, user_id='user-abc', chat_id='chat-xyz') is None


def test_build_formic_context_bundle_matches_chat_metadata_shape():
    folder = SimpleNamespace(
        id='folder-123',
        name='Formic Desktop',
        data={'group_type': 'project', 'project_path': '/Users/example/dev/formic'},
    )

    assert build_formic_context_bundle(
        folder=folder,
        user_id='user-abc',
        chat_id='chat-xyz',
        file_refs=[],
    ) == {
        'formic_group_context': {
            'group_id': 'folder-123',
            'group_name': 'Formic Desktop',
            'group_type': 'project',
            'project_path': '/Users/example/dev/formic',
            'workspace': None,
            'tags': [],
            'system_prompt': None,
            'file_refs': [],
            'chat_id': 'chat-xyz',
            'user_id': 'user-abc',
        },
        'formic_memory_context': {
            'default_provider': 'hindsight',
            'providers': {
                'hindsight': {
                    'bank_id': 'formic:user:user-abc:group:folder-123',
                    'scope': 'group',
                    'group_id': 'folder-123',
                    'user_id': 'user-abc',
                }
            },
        },
        'formic_hermes': {
            'conversation': 'formic-group:folder-123',
            'group_id': 'folder-123',
        },
    }


def test_normalize_project_path_expands_home_and_preserves_absolute_paths():
    assert normalize_project_path('~/dev/formic', home_dir='/Users/example') == '/Users/example/dev/formic'
    assert normalize_project_path('/Users/example/dev/../dev/formic') == '/Users/example/dev/formic'
    assert normalize_project_path('') == ''
    assert normalize_project_path(None) is None


def test_normalize_project_path_rejects_arbitrary_relative_paths():
    with pytest.raises(ValueError, match='absolute path'):
        normalize_project_path('dev/formic')

    with pytest.raises(ValueError, match='absolute path'):
        normalize_project_path('~other/dev/formic')


def test_normalize_folder_project_path_data_stores_normalized_absolute_path():
    assert normalize_folder_project_path_data(
        {
            'group_type': 'project',
            'project_path': '~/dev/formic',
            'workspace': 'personal',
        }
    ) == {
        'group_type': 'project',
        'project_path': f'{normalize_project_path("~")}/dev/formic',
        'workspace': 'personal',
    }


def test_hindsight_bank_id_is_group_and_user_scoped():
    assert build_hindsight_bank_id('user-abc', 'folder-123') == 'formic:user:user-abc:group:folder-123'
    assert build_hindsight_bank_id('user-abc', None) is None
    assert build_hindsight_bank_id(None, 'folder-123') is None


def test_memory_context_uses_hindsight_as_default_provider_without_polluting_group_context():
    group_context = {
        'group_id': 'folder-123',
        'user_id': 'user-abc',
    }

    assert build_formic_memory_context(group_context) == {
        'default_provider': 'hindsight',
        'providers': {
            'hindsight': {
                'bank_id': 'formic:user:user-abc:group:folder-123',
                'scope': 'group',
                'group_id': 'folder-123',
                'user_id': 'user-abc',
            }
        },
    }


def test_hermes_context_uses_stable_group_conversation_key_for_hermes_models_only():
    group_context = {'group_id': 'folder-123'}
    metadata = {'formic_hermes': build_formic_hermes_context(group_context)}

    assert metadata['formic_hermes'] == {
        'conversation': 'formic-group:folder-123',
        'group_id': 'folder-123',
    }
    assert get_formic_hermes_conversation(metadata, 'hermes-agent') == 'formic-group:folder-123'
    assert get_formic_hermes_conversation(metadata, 'provider.hermes-agent') == 'formic-group:folder-123'
    assert get_formic_hermes_conversation(metadata, 'gpt-5') is None


def test_apply_formic_hermes_conversation_only_for_responses_hermes_payloads():
    metadata = {'formic_hermes': {'conversation': 'formic-group:folder-123'}}

    assert apply_formic_hermes_conversation(
        {'model': 'hermes-agent'},
        metadata=metadata,
        is_responses=True,
    ) == {
        'model': 'hermes-agent',
        'conversation': 'formic-group:folder-123',
    }

    assert apply_formic_hermes_conversation(
        {'model': 'hermes-agent'},
        metadata=metadata,
        is_responses=False,
    ) == {'model': 'hermes-agent'}

    assert apply_formic_hermes_conversation(
        {'model': 'gpt-5'},
        metadata=metadata,
        is_responses=True,
    ) == {'model': 'gpt-5'}

    assert apply_formic_hermes_conversation(
        {'model': 'hermes-agent', 'conversation': 'caller-choice'},
        metadata=metadata,
        is_responses=True,
    ) == {
        'model': 'hermes-agent',
        'conversation': 'caller-choice',
    }
