from open_webui.utils.middleware import resolve_unfinished_function_calls, serialize_output


def test_resolve_unfinished_function_calls_closes_pending_display_state():
    output = [
        {
            'type': 'function_call',
            'id': 'call_1',
            'call_id': 'call_1',
            'name': 'run_command',
            'arguments': '{"command":"git status"}',
            'status': 'in_progress',
        }
    ]

    resolved = resolve_unfinished_function_calls(output)
    rendered = serialize_output(resolved)

    assert 'done="false"' not in rendered
    assert 'did not complete before the response finished' in rendered


def test_resolve_unfinished_function_calls_keeps_completed_tool_results():
    output = [
        {
            'type': 'function_call',
            'id': 'call_1',
            'call_id': 'call_1',
            'name': 'run_command',
            'arguments': '{"command":"pwd"}',
            'status': 'completed',
        },
        {
            'type': 'function_call_output',
            'id': 'result_1',
            'call_id': 'call_1',
            'output': [{'type': 'input_text', 'text': '/Users/example/dev/formic'}],
            'status': 'completed',
        },
    ]

    resolved = resolve_unfinished_function_calls(output)
    rendered = serialize_output(resolved)

    assert resolved == output
    assert 'did not complete before the response finished' not in rendered
    assert '/Users/example/dev/formic' in rendered
