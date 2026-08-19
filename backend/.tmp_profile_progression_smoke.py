import sys

sys.path.insert(0, "/home/robert/Development/Hevy-AI-Coach/backend")

from app.services.ai_service import _build_deterministic_set_targets, _compute_exercise_progression


template = [
    {
        "title": "Seitheben",
        "progression_key": "lateral:life-fitness",
        "muscle_group": "Shoulders",
        "notes": "",
        "sets": [{"type": "working", "weight_kg": 10, "reps": 10}],
    },
    {
        "title": "Seitheben",
        "progression_key": "lateral:matrix",
        "muscle_group": "Shoulders",
        "notes": "",
        "sets": [{"type": "working", "weight_kg": 20, "reps": 10}],
    },
]
history = [{
    "start_time": "2026-08-19T12:00:00+00:00",
    "exercises": [
        {"title": "Seitheben", "progression_key": "lateral:life-fitness", "sets": [{"type": "working", "weight_kg": 10, "reps": 10}]},
        {"title": "Seitheben", "progression_key": "lateral:matrix", "sets": [{"type": "working", "weight_kg": 20, "reps": 10}]},
    ],
}]

progression = _compute_exercise_progression(history, template)
targets = _build_deterministic_set_targets(template, progression, [])

assert progression["lateral:life-fitness"]["current_weight_kg"] == 10
assert progression["lateral:matrix"]["current_weight_kg"] == 20
assert targets[0]["set_targets"][0]["weight_kg"] == 10
assert targets[1]["set_targets"][0]["weight_kg"] == 20
print("Profile-keyed progression smoke test passed.")
