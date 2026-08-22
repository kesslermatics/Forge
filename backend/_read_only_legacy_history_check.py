"""Temporary read-only check for retained legacy workout-history records; do not commit."""
import json

import psycopg2

from app.config import settings


def main():
    conn = psycopg2.connect(settings.database_url)
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND (table_name ILIKE '%workout%' OR table_name ILIKE '%hevy%' OR table_name ILIKE '%review%' OR table_name ILIKE '%session%')
                ORDER BY table_name
            """)
            tables = [row[0] for row in cur.fetchall()]
            cur.execute("SELECT count(*), count(DISTINCT user_id) FROM workout_reviews")
            reviews_count, review_users = cur.fetchone()
            cur.execute("""
                SELECT workout_date::date, workout_name, review_data, tips_data
                FROM workout_reviews
                ORDER BY workout_date DESC NULLS LAST
                LIMIT 5
            """)
            recent_reviews = []
            for workout_date, workout_name, review_data, tips_data in cur.fetchall():
                recent_reviews.append({
                    "date": workout_date.isoformat() if workout_date else None,
                    "workout_name": workout_name,
                    "review_data_keys": sorted(review_data.keys()) if isinstance(review_data, dict) else None,
                    "tips_data_keys": sorted(tips_data.keys()) if isinstance(tips_data, dict) else None,
                })
            print(json.dumps({
                "relevant_tables": tables,
                "workout_review_count": reviews_count,
                "accounts_with_workout_reviews": review_users,
                "recent_review_shapes": recent_reviews,
            }, ensure_ascii=False, indent=2))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
