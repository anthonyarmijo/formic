from open_webui.routers.folders import sanitize_folder_list_data


def test_sanitize_folder_list_data_keeps_only_workspace_sidebar_keys():
    data = {
        'group_type': 'project',
        'project_path': '/Users/example/dev/project',
        'preview_url': 'http://127.0.0.1:5173',
        'tags': ['python', 'infra'],
        'workspace': 'work',
        'files': [{'id': 'private-file'}],
        'system_prompt': 'private prompt',
        'model_ids': ['private-model'],
    }

    assert sanitize_folder_list_data(data) == {
        'group_type': 'project',
        'project_path': '/Users/example/dev/project',
        'preview_url': 'http://127.0.0.1:5173',
        'tags': ['python', 'infra'],
        'workspace': 'work',
    }


def test_sanitize_folder_list_data_returns_none_without_sidebar_keys():
    assert sanitize_folder_list_data({'files': [{'id': 'private-file'}]}) is None
    assert sanitize_folder_list_data(None) is None
