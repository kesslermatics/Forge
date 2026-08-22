"""Temporary read-only analysis of native Forge workout history; do not commit."""
import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

import psycopg2

from app.config import settings


def main():
    conn = psycopg2.connect(settings.database_url)
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT user_id, count(*)
                FROM forge_workout_sessions
                WHERE status = 'completed'
                GROUP BY user_id
                ORDER BY count(*) DESC
            """)
            accounts = cur.fetchall()
            result = {"accounts_with_completed_history": len(accounts)}
            if len(accounts) != 1:
                print(json.dumps(result))
                return

            user_id = accounts[0][0]
            cur.execute("""
                SELECT current_goal, target_weight, height_cm
                FROM users
                WHERE id = %s
            """, (user_id,))
            goal, target_weight, height_cm = cur.fetchone()
            result["profile"] = {
                "current_goal": goal,
                "target_weight_kg": target_weight,
                "height_cm": height_cm,
            }

            cur.execute("""
                SELECT completed_at::date, name
                FROM forge_workout_sessions
                WHERE user_id = %s AND status = 'completed'
                ORDER BY completed_at DESC NULLS LAST, started_at DESC
                LIMIT 20
            """, (user_id,))
            result["recent_sessions"] = [
                {"date": row[0].isoformat() if row[0] else None, "name": row[1]}
                for row in cur.fetchall()
            ]

            cur.execute("""
                SELECT date_trunc('week', COALESCE(completed_at, started_at))::date, count(*)
                FROM forge_workout_sessions
                WHERE user_id = %s AND status = 'completed'
                  AND COALESCE(completed_at, started_at) >= now() - interval '84 days'
                GROUP BY 1
                ORDER BY 1
            """, (user_id,))
            result["weekly_completed_sessions"] = [
                {"week": row[0].isoformat(), "sessions": row[1]}
                for row in cur.fetchall()
            ]

            cur.execute("""
                SELECT
                    COALESCE(ws.completed_at, ws.started_at)::date AS session_date,
                    se.name,
                    COALESCE(se.machine_profile_name, 'unprofiled') AS machine_profile,
                    count(*) AS working_sets,
                    sum(ss.actual_reps) AS total_reps,
                    max(ss.actual_weight_kg) AS top_weight_kg,
                    sum(ss.actual_weight_kg * ss.actual_reps) AS volume_kg
                FROM forge_workout_sessions ws
                JOIN forge_session_exercises se ON se.session_id = ws.id
                JOIN forge_session_sets ss ON ss.session_exercise_id = se.id
                WHERE ws.user_id = %s
                  AND ws.status = 'completed'
                  AND COALESCE(ws.completed_at, ws.started_at) >= now() - interval '120 days'
                  AND ss.completed IS TRUE
                  AND ss.set_type = 'working'
                  AND ss.actual_weight_kg IS NOT NULL
                  AND ss.actual_reps IS NOT NULL
                  AND ss.actual_reps > 0
                GROUP BY 1, se.name, COALESCE(se.machine_profile_name, 'unprofiled')
                ORDER BY session_date DESC, se.name
            """, (user_id,))
            rows = cur.fetchall()
            by_exercise = defaultdict(list)
            for session_date, name, profile, sets, reps, top_weight, volume in rows:
                by_exercise[f"{name} ({profile})"].append({
                    "date": session_date.isoformat(),
                    "working_sets": sets,
                    "reps": reps,
                    "top_weight_kg": float(top_weight),
                    "volume_kg": float(volume),
                })
            result["exercise_history"] = {
                name: entries[:5]
                for name, entries in sorted(by_exercise.items(), key=lambda item: (-len(item[1]), item[0]))
            }

            cur.execute("""
                SELECT date, weight_kg
                FROM weight_entries
                WHERE user_id = %s
                ORDER BY date DESC
                LIMIT 14
            """, (user_id,))
            result["recent_weight_entries"] = [
                {"date": row[0].isoformat(), "weight_kg": float(row[1])}
                for row in cur.fetchall()
            ]

            print(json.dumps(result, ensure_ascii=False, indent=2))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
