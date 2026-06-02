from open_webui.utils.tools import (
    apply_terminal_tool_defaults,
    format_terminal_run_command_result,
    split_openapi_tool_params,
)


def test_terminal_run_command_defaults_are_added_only_when_absent():
    assert apply_terminal_tool_defaults('run_command', {'command': 'pwd'}) == {
        'command': 'pwd',
        'wait': 30,
        'tail': 200,
    }

    assert apply_terminal_tool_defaults('run_command', {'command': 'pwd', 'wait': 5, 'tail': 10}) == {
        'command': 'pwd',
        'wait': 5,
        'tail': 10,
    }

    assert apply_terminal_tool_defaults('display_file', {'path': 'README.md'}) == {'path': 'README.md'}


def test_split_openapi_tool_params_keeps_query_and_path_out_of_body():
    params = {
        'process_id': 'proc-1',
        'wait': 30,
        'tail': 200,
        'command': 'git status',
        'cwd': '/Users/example/dev/formic',
    }
    merged_params = {
        ('process_id', 'path'): {'name': 'process_id', 'in': 'path', 'required': True},
        ('wait', 'query'): {'name': 'wait', 'in': 'query', 'required': False},
        ('tail', 'query'): {'name': 'tail', 'in': 'query', 'required': False},
    }

    path_params, query_params, body_params = split_openapi_tool_params(params, merged_params)

    assert path_params == {'process_id': 'proc-1'}
    assert query_params == {'wait': 30, 'tail': 200}
    assert body_params == {
        'command': 'git status',
        'cwd': '/Users/example/dev/formic',
    }


def test_split_openapi_tool_params_omits_empty_query_params_from_body():
    params = {
        'wait': None,
        'tail': '',
        'command': 'git status',
    }
    merged_params = {
        ('wait', 'query'): {'name': 'wait', 'in': 'query', 'required': False},
        ('tail', 'query'): {'name': 'tail', 'in': 'query', 'required': False},
    }

    path_params, query_params, body_params = split_openapi_tool_params(params, merged_params)

    assert path_params == {}
    assert query_params == {}
    assert body_params == {'command': 'git status'}


def test_format_terminal_run_command_result_includes_completed_output():
    result = {
        'id': 'proc-1',
        'command': 'pwd',
        'status': 'done',
        'exit_code': 0,
        'output': [{'type': 'output', 'data': '/Users/example/dev/formic\n'}],
    }

    formatted = format_terminal_run_command_result(result)

    assert 'command: pwd' in formatted
    assert 'status: done' in formatted
    assert 'exit_code: 0' in formatted
    assert '/Users/example/dev/formic' in formatted
    assert 'raw_json:' in formatted


def test_format_terminal_run_command_result_marks_running_process_incomplete():
    result = {
        'id': 'proc-1',
        'command': 'sleep 60',
        'status': 'running',
        'exit_code': None,
        'output': [],
    }

    formatted = format_terminal_run_command_result(result)

    assert 'Command is still running' in formatted
    assert 'process_id: proc-1' in formatted
    assert 'incomplete: true' in formatted
