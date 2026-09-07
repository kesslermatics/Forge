"""Ensure Forge session weights are stored without integer truncation.

Run once from backend if the deployment has not applied startup migrations yet:
    python migrate_fix_forge_decimal_weights.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import text

from app.database import engine


STATEMENTS = [
    "ALTER TABLE forge_session_sets ALTER COLUMN actual_weight_kg TYPE DOUBLE PRECISION USING actual_weight_kg::double precision;",
]


def migrate() -> None:
    with engine.begin() as connection:
        for statement in STATEMENTS:
            connection.execute(text(statement))
    print("Forge decimal weight migration complete.")


if __name__ == "__main__":
    migrate()
