import json
import subprocess

checks = [
    ("git_diff_check", ["git", "--no-pager", "diff", "--check"]),
    ("tsc_app", ["./frontend/node_modules/.bin/tsc", "-p", "frontend/tsconfig.app.json", "--noEmit", "--incremental", "false", "--pretty", "false"]),
    ("tsc_node", ["./frontend/node_modules/.bin/tsc", "-p", "frontend/tsconfig.node.json", "--noEmit", "--incremental", "false", "--pretty", "false"]),
]
results = {}
for name, command in checks:
    completed = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    lines = completed.stdout.splitlines()
    results[name] = {
        "command": " ".join(command),
        "exit_code": completed.returncode,
        "output_line_count": len(lines),
        "first_output_lines": lines[:12],
    }
print(json.dumps(results, ensure_ascii=False, indent=2))
