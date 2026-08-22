"""Temporary read-only extraction of legacy workout review facts; do not commit."""
import json
from collections import Counter, defaultdict
from datetime import date, timedelta

import psycopg2
from psycopg2.extras import RealDictCursor

from app.config import settings


def compact_exercise(exercise):
    return {
        key: exercise.get(key)
        for key in ("name", "best_set", "e1rm", "volume", "sets", "reps", "trend", "next_target", "feedback")
        if exercise.get(key) is not None
    }


def main():
    conn = psycopg2.connect(settings.database_url)
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT workout_date::date AS workout_date, workout_name, review_data, tips_data
                FROM workout_reviews
                ORDER BY workout_date ASC
            """)
            rows = cur.fetchall()

        dates = [row["workout_date"] for row in rows if row["workout_date"]]
        weekly = Counter()
        for workout_date in dates:
            monday = workout_date - timedelta(days=workout_date.weekday())
            weekly[monday.isoformat()] += 1

        reviewed = []
        for row in rows:
            review_data = row["review_data"] or {}
            last_session = review_data.get("last_session") if isinstance(review_data, dict) else None
            if isinstance(last_session, dict):
                reviewed.append({
                    "date": row["workout_date"].isoformat() if row["workout_date"] else None,
                    "workout_name": row["workout_name"],
                    "overall_feedback": last_session.get("overall_feedback"),
                    "exercises": [compact_exercise(exercise) for exercise in last_session.get("exercises", [])],
                })

        latest_targets = []
        for row in reversed(rows):
            tips_data = row["tips_data"] or {}
            if isinstance(tips_data, dict) and tips_data.get("exercise_targets"):
                latest_targets = tips_data.get("exercise_targets")
                break

        output = {
            "review_count": len(rows),
            "first_workout_date": dates[0].isoformat() if dates else None,
            "latest_workout_date": dates[-1].isoformat() if dates else None,
            "last_12_calendar_weeks_with_sessions": [
                {"week": week, "sessions": weekly[week]}
                for week in sorted(weekly)[-12:]
            ],
            "sessions_with_actual_review_data": reviewed[-6:],
            "latest_coach_targets": latest_targets,
        }
        print(json.dumps(output, ensure_ascii=False, indent=2, default=str))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
