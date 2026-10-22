"""Read-only probe: measure the Forge session coaching payload against the real DB."""
import asyncio
import json
import sys

sys.path.insert(0, ".")

from app.database import SessionLocal  # noqa: E402
from app.models import ForgeWorkoutSession, User  # noqa: E402
from app.routes import forge  # noqa: E402


def size(obj) -> int:
    return len(json.dumps(obj, ensure_ascii=False, default=str))


async def main() -> None:
    db = SessionLocal()
    try:
        sessions = db.query(ForgeWorkoutSession).order_by(ForgeWorkoutSession.started_at.desc()).limit(3).all()
        for session in sessions:
            user = db.query(User).filter(User.id == session.user_id).first()
            profile = {
                "training_goal": "hypertrophy",
                "nutrition_role": "background_confidence_only",
                "yazio": {"source": "probe_stub", "rolling": {}},
                "bodyweight": forge._local_weight_trends(db, user.id),
            }
            context = forge._session_coaching_context(db, user, session, profile)
            total = size({"context": context})
            ev = context["coach_evidence"]
            sess_ex = context["session"]["exercises"]
            print(f"\n=== session {session.name!r} status={session.status} exercises={len(session.exercises)} sets={sum(len(e.sets) for e in session.exercises)}")
            print(f"total payload chars: {total} (~{total // 4} tokens)")
            print(f"  profile:                       {size(context['profile'])}")
            print(f"  coach_evidence total:          {size(ev)}")
            print(f"    .muscles:                    {size(ev['muscles'])}")
            print(f"    .exercises:                  {size(ev['exercises'])}")
            print(f"    .nutrition (dup of profile): {size(ev['nutrition'])}")
            print(f"  session.exercises total:       {size(sess_ex)}")
            print(f"    .evidence (dup):             {sum(size(e['evidence']) for e in sess_ex)}")
            print(f"    .machine_profile:            {sum(size(e['machine_profile']) for e in sess_ex)}")
            print(f"    .targets:                    {sum(size(e['targets']) for e in sess_ex)}")
            for item in ev["exercises"]:
                print(f"      exposures={len(item['recent_exposures'])} history_count={item['history_count']} chars={size(item)}")
    finally:
        db.rollback()
        db.close()


asyncio.run(main())
