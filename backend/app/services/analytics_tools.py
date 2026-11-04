"""Analytics tools: training load, strength progression, energy balance, adherence and projections.

Every tool takes ``(db, user, args)`` and returns a compact, JSON-serialisable dict. They only
read data; results are estimates and each response names its assumptions and data coverage so a
caller never mistakes a thin data set for a firm conclusion.

Data sources: completed Forge sessions (local DB), ``WeightEntry`` (local DB), Yazio daily
summaries (live) and Google Health sleep (live).
"""
from __future__ import annotations

import asyncio
import math
import statistics
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.encryption import decrypt_value
from app.models import GoogleHealthConnection, User, WeightEntry
from app.services.ai_service import _canonical_forge_muscle
from app.services.forge_session_adapter import completed_forge_workouts
from app.services.google_health_service import (
    GOOGLE_HEALTH_READ_SLEEP_SCOPE,
    connection_has_scope,
    fetch_sleep,
)
from app.services.range_tools import enforce_budget, mean, parse_iso_date, range_info, resolve_range
from app.services.yazio_service import fetch_nutrition_range

KCAL_PER_KG = 7700.0
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

# Weekly hard-set landmarks (Israetel / Renaissance Periodization), used as a general guideline.
# (MEV, MAV low, MAV high, MRV). They differ between individuals and training ages.
LANDMARKS: dict[str, tuple[int, int, int, int]] = {
    "Chest": (8, 12, 20, 22),
    "Back": (8, 14, 22, 25),
    "Lats": (8, 14, 22, 25),
    "Shoulders": (8, 16, 22, 26),
    "Biceps": (8, 14, 20, 26),
    "Triceps": (6, 10, 14, 18),
    "Quadriceps": (8, 12, 18, 20),
    "Hamstrings": (6, 10, 16, 20),
    "Glutes": (0, 4, 12, 16),
    "Calves": (8, 12, 16, 20),
    "Abs": (0, 16, 20, 25),
    "Traps": (0, 12, 20, 26),
}


# ── Generic helpers ──────────────────────────────────────────────────────────────

def _bounded(value: object, default: int, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    return max(minimum, min(maximum, int(value)))


def _is_working(set_data: dict) -> bool:
    return set_data.get("type") != "warmup"


def _e1rm_epley(weight: Any, reps: Any) -> float | None:
    if not isinstance(weight, (int, float)) or not isinstance(reps, int) or weight <= 0 or not 1 <= reps <= 12:
        return None
    return float(weight) if reps == 1 else weight * (1 + reps / 30)


def _e1rm_brzycki(weight: Any, reps: Any) -> float | None:
    if not isinstance(weight, (int, float)) or not isinstance(reps, int) or weight <= 0 or not 1 <= reps <= 12:
        return None
    return float(weight) if reps == 1 else weight * 36 / (37 - reps)


def _loaded_working_sets(exercise: dict) -> list[dict]:
    return [
        item for item in exercise.get("sets", [])
        if _is_working(item) and isinstance(item.get("weight_kg"), (int, float)) and item["weight_kg"] > 0
        and isinstance(item.get("reps"), int) and item["reps"] > 0
    ]


def _linreg(xs: list[float], ys: list[float]) -> dict[str, float] | None:
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return None
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    intercept = my - slope * mx
    residual = sum((y - (intercept + slope * x)) ** 2 for x, y in zip(xs, ys))
    stderr = math.sqrt(residual / (n - 2) / sxx) if n > 2 else 0.0
    return {"slope": slope, "intercept": intercept, "stderr": stderr, "n": n}


def _pearson(xs: list[float], ys: list[float]) -> dict[str, Any] | None:
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if sx == 0 or sy == 0:
        return None
    r = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy)
    t = r * math.sqrt((n - 2) / max(1e-12, 1 - r * r)) if abs(r) < 1 else float("inf")
    magnitude = abs(r)
    strength = "negligible" if magnitude < 0.2 else "weak" if magnitude < 0.4 else "moderate" if magnitude < 0.6 else "strong"
    return {
        "r": round(r, 2),
        "n": n,
        "strength": strength,
        # |t| >= 2 with n >= 10 is a rough screen for "not just noise"; it is not a formal test.
        "reliable": n >= 10 and abs(t) >= 2,
    }


def _weeks_between(start: date, end: date) -> float:
    return round((end - start).days / 7, 1)


def _date_of(workout: dict) -> date | None:
    return parse_iso_date(workout.get("local_date") or str(workout.get("start_time", ""))[:10])


def _resolve_end(args: dict) -> date:
    end = parse_iso_date(args.get("end_date")) or date.today()
    return min(end, date.today())


# ── Data hooks (patched in tests) ────────────────────────────────────────────────

def _yazio_credentials(user: User) -> tuple[str, str] | None:
    if not user.yazio_email or not user.yazio_password:
        return None
    try:
        return decrypt_value(user.yazio_email), decrypt_value(user.yazio_password)
    except Exception:
        return None


async def _load_nutrition(user: User, start: date, end: date) -> dict | None:
    credentials = _yazio_credentials(user)
    if credentials is None:
        return None
    return await fetch_nutrition_range(*credentials, start, end)


async def _load_sleep(db: Session, user: User, days: list[date]) -> dict[str, Any]:
    """Sleep minutes for the night ending on each date. Returns {"available", "nights", "reason"}."""
    connection = db.query(GoogleHealthConnection).filter(
        GoogleHealthConnection.user_id == user.id,
        GoogleHealthConnection.status == "connected",
    ).first()
    if connection is None:
        return {"available": False, "reason": "Google Health ist nicht verbunden."}
    if not connection_has_scope(connection, GOOGLE_HEALTH_READ_SLEEP_SCOPE):
        return {"available": False, "reason": "Das Google-Konto muss neu verbunden werden, um Schlafdaten zu lesen."}

    nights: dict[str, dict] = {}
    ordered = sorted(set(days))
    if not ordered:
        return {"available": True, "nights": nights}

    def store(day: date, result: dict) -> None:
        if isinstance(result, dict) and result.get("available") and result.get("total_sleep_min"):
            nights[day.isoformat()] = {
                "minutes": int(result["total_sleep_min"]),
                "deep_min": (result.get("stage_minutes") or {}).get("deep"),
                "rem_min": (result.get("stage_minutes") or {}).get("rem"),
            }

    # The first call may refresh the OAuth token; do it alone, then fetch the rest in small batches.
    first = await fetch_sleep(connection, db, ordered[0])
    if not first.get("available") and first.get("needs_reauth"):
        return {"available": False, "reason": first.get("reason")}
    if not first.get("available") and connection.status != "connected":
        return {"available": False, "reason": first.get("reason")}
    store(ordered[0], first)
    for index in range(1, len(ordered), 4):
        batch = ordered[index:index + 4]
        results = await asyncio.gather(*(fetch_sleep(connection, db, day) for day in batch), return_exceptions=True)
        for day, result in zip(batch, results):
            if isinstance(result, dict):
                store(day, result)
    return {"available": True, "nights": nights}


def _nutrition_unavailable(user: User) -> dict | None:
    if _yazio_credentials(user) is None:
        return {"available": False, "reason": "Yazio ist nicht verbunden."}
    return None


# ── Shared: trend-adjusted performance index ─────────────────────────────────────

def performance_indices(workouts: list[dict]) -> dict[str, dict[str, Any]]:
    """Score each workout against the user's own trend, so strength gains don't masquerade as effects.

    For every exercise with at least 3 sessions the best estimated 1RM per session is compared
    with a fitted trend line (with 4+ sessions) or the median. A workout's index is the mean of
    these ratios x 100 (100 = as expected for that day on the user's own trend).
    """
    sessions: dict[str, list[tuple[str, int, float]]] = defaultdict(list)
    for workout in workouts:
        day = _date_of(workout)
        if day is None:
            continue
        for exercise in workout.get("exercises", []):
            values = [_e1rm_epley(s["weight_kg"], s["reps"]) for s in _loaded_working_sets(exercise)]
            values = [v for v in values if v]
            if values:
                sessions[str(exercise.get("title", "")).casefold()].append((workout["id"], day.toordinal(), max(values)))

    ratios: dict[str, list[float]] = defaultdict(list)
    for entries in sessions.values():
        if len(entries) < 3:
            continue
        fit = _linreg([float(e[1]) for e in entries], [e[2] for e in entries]) if len(entries) >= 4 else None
        median = statistics.median(e[2] for e in entries)
        for workout_id, ordinal, value in entries:
            expected = fit["intercept"] + fit["slope"] * ordinal if fit else median
            if expected > 0:
                ratios[workout_id].append(value / expected)

    result: dict[str, dict[str, Any]] = {}
    for workout in workouts:
        values = ratios.get(workout["id"])
        day = _date_of(workout)
        if values and day is not None:
            result[workout["id"]] = {
                "index": round(sum(values) / len(values) * 100, 1),
                "exercises": len(values),
                "date": day,
                "hour": workout.get("local_hour"),
            }
    return result


# ── 1. Volume and frequency ──────────────────────────────────────────────────────

async def volume_and_frequency(db: Session, user: User, args: dict) -> dict[str, Any]:
    weeks = _bounded(args.get("weeks"), 8, 1, 26)
    end = _resolve_end(args)
    current_week = end - timedelta(days=end.weekday())
    first_week = current_week - timedelta(days=7 * weeks)
    week_starts = [first_week + timedelta(days=7 * index) for index in range(weeks + 1)]
    current_partial = end < current_week + timedelta(days=6)

    workouts = completed_forge_workouts(db, user.id, since=first_week, until=end, newest_first=False)
    sets_by_muscle: dict[str, list[float]] = defaultdict(lambda: [0.0] * (weeks + 1))
    days_by_muscle: dict[str, list[set]] = defaultdict(lambda: [set() for _ in range(weeks + 1)])

    for workout in workouts:
        day = _date_of(workout)
        if day is None:
            continue
        index = (day - first_week).days // 7
        if not 0 <= index <= weeks:
            continue
        for exercise in workout.get("exercises", []):
            count = sum(1 for item in exercise.get("sets", []) if _is_working(item))
            if count == 0:
                continue
            primary = _canonical_forge_muscle(exercise.get("muscle_group"), fallback=str(exercise.get("muscle_group") or "Other"))
            contributions = [(primary, 1.0)]
            for secondary in exercise.get("secondary_muscle_groups") or []:
                name = _canonical_forge_muscle(secondary, fallback="")
                if name and name != primary:
                    contributions.append((name, 0.5))
            for muscle, weight in contributions:
                sets_by_muscle[muscle][index] += count * weight
                days_by_muscle[muscle][index].add(day)

    complete = weeks if current_partial else weeks + 1
    complete_range = range(complete)
    muscles = []
    for muscle in sorted(set(LANDMARKS) | set(sets_by_muscle)):
        weekly = sets_by_muscle[muscle] if muscle in sets_by_muscle else [0.0] * (weeks + 1)
        frequency = [len(days_by_muscle[muscle][i]) if muscle in days_by_muscle else 0 for i in range(weeks + 1)]
        complete_sets = [weekly[i] for i in complete_range]
        average = round(sum(complete_sets) / len(complete_sets), 1) if complete_sets else 0.0
        entry: dict[str, Any] = {
            "muscle": muscle,
            "weekly_effective_sets": [round(v, 1) for v in weekly[:complete]],
            "avg_weekly_sets": average,
            "avg_sessions_per_week": round(sum(frequency[i] for i in complete_range) / max(1, len(complete_sets)), 1),
        }
        if current_partial:
            entry["current_week_so_far"] = round(weekly[weeks], 1)
        half = len(complete_sets) // 2
        if half >= 2:
            older, newer = sum(complete_sets[:half]) / half, sum(complete_sets[-half:]) / half
            entry["trend"] = "up" if newer > older * 1.15 else "down" if newer < older * 0.85 else "flat"
        landmarks = LANDMARKS.get(muscle)
        if landmarks:
            mev, mav_low, mav_high, mrv = landmarks
            entry["landmarks"] = {"mev": mev, "mav": [mav_low, mav_high], "mrv": mrv}
            entry["status"] = (
                "below_mev" if average < mev
                else "low" if average < mav_low
                else "optimal" if average <= mav_high
                else "high" if average < mrv
                else "at_or_above_mrv"
            )
        if average > 0 or muscle in LANDMARKS:
            muscles.append(entry)

    muscles.sort(key=lambda item: -item["avg_weekly_sets"])
    payload: dict[str, Any] = {
        "range": range_info({"start": first_week, "end": end, "days": (end - first_week).days + 1, "notes": []}),
        "week_starts": [d.isoformat() for d in week_starts[:complete]],
        "workouts_analyzed": len(workouts),
        "muscles": muscles,
        "neglected": [m["muscle"] for m in muscles if m.get("status") == "below_mev"],
        "overreaching_risk": [m["muscle"] for m in muscles if m.get("status") == "at_or_above_mrv"],
        "method": (
            "Effective sets = completed non-warm-up sets; primary muscle counts 1.0, secondary muscles 0.5. "
            "Weeks start on Monday. Averages use complete weeks only. "
            "Landmarks (MEV/MAV/MRV) are Israetel's general guideline in hard sets per week and vary per person."
        ),
    }
    if not workouts:
        payload["notes"] = ["No completed workouts in this period."]
    return enforce_budget(payload, ["muscles"])


# ── 2. Strength progression ──────────────────────────────────────────────────────

async def strength_progression(db: Session, user: User, args: dict) -> dict[str, Any]:
    window = resolve_range(args, default_days=90, max_days=730)
    plateau_weeks = _bounded(args.get("plateau_weeks"), 4, 2, 12)
    top_n = _bounded(args.get("top_n"), 8, 1, 15)
    wanted = str(args.get("exercise_name") or "").strip()

    workouts = completed_forge_workouts(db, user.id, since=window["start"], until=window["end"], newest_first=False)
    per_exercise: dict[str, dict[str, Any]] = {}
    for workout in workouts:
        day = _date_of(workout)
        if day is None:
            continue
        for exercise in workout.get("exercises", []):
            title = str(exercise.get("title", "")).strip()
            if wanted and title.casefold() != wanted.casefold():
                continue
            sets = _loaded_working_sets(exercise)
            if not sets:
                continue
            e1rms = [(_e1rm_epley(s["weight_kg"], s["reps"]), _e1rm_brzycki(s["weight_kg"], s["reps"]), s) for s in sets]
            e1rms = [item for item in e1rms if item[0]]
            if not e1rms:
                continue
            best = max(e1rms, key=lambda item: item[0])
            record = per_exercise.setdefault(title, {"name": title, "muscle_group": exercise.get("muscle_group"), "sessions": []})
            record["sessions"].append({
                "date": day,
                "e1rm": best[0],
                "e1rm_brzycki": best[1],
                "tonnage": sum(s["weight_kg"] * s["reps"] for s in sets),
                "top_weight": max(s["weight_kg"] for s in sets),
                "top_set": {"weight_kg": best[2]["weight_kg"], "reps": best[2]["reps"]},
            })

    if wanted and not per_exercise:
        return {"range": range_info(window), "exercises": [], "notes": [f"No completed sets found for '{wanted}' in this range."]}

    chosen = sorted(per_exercise.values(), key=lambda r: (-len(r["sessions"]), -sum(s["tonnage"] for s in r["sessions"])))
    if not wanted:
        chosen = [record for record in chosen if len(record["sessions"]) >= 2][:top_n]

    end = window["end"]
    results = []
    for record in chosen:
        sessions = sorted(record["sessions"], key=lambda s: s["date"])
        first_ref = max(s["e1rm"] for s in sessions[:2])
        latest_ref = max(s["e1rm"] for s in sessions[-2:])
        peak = max(sessions, key=lambda s: s["e1rm"])
        entry: dict[str, Any] = {
            "exercise": record["name"],
            "muscle_group": record["muscle_group"],
            "sessions": len(sessions),
            "first_e1rm_kg": round(first_ref, 1),
            "latest_e1rm_kg": round(latest_ref, 1),
            "peak_e1rm_kg": round(peak["e1rm"], 1),
            "peak_date": peak["date"].isoformat(),
            "change_pct": round((latest_ref - first_ref) / first_ref * 100, 1) if first_ref else None,
            "total_tonnage_kg": round(sum(s["tonnage"] for s in sessions)),
        }

        recent_start = end - timedelta(days=7 * plateau_weeks)
        prior_start = recent_start - timedelta(days=7 * plateau_weeks)
        recent = [s for s in sessions if s["date"] > recent_start]
        prior = [s for s in sessions if prior_start < s["date"] <= recent_start]
        status = "insufficient_data"
        if len(recent) >= 2 and len(prior) >= 2:
            recent_best, prior_best = max(s["e1rm"] for s in recent), max(s["e1rm"] for s in prior)
            delta = (recent_best - prior_best) / prior_best * 100
            status = "progressing" if delta >= 1.5 else "regressing" if delta <= -1.5 else "plateau" if len(recent) >= 3 else "insufficient_data"
            entry["recent_vs_prior_pct"] = round(delta, 1)
            if status == "plateau":
                weights = [s["top_weight"] for s in recent]
                entry["plateau_band_kg"] = [min(weights), max(weights)]
        entry["status"] = status
        weeks_since_peak = _weeks_between(peak["date"], end)
        since_peak = [s for s in sessions if s["date"] > peak["date"]]
        if status in ("plateau", "regressing") and weeks_since_peak >= plateau_weeks and len(since_peak) >= 2:
            entry["weeks_since_new_peak"] = weeks_since_peak
            band = entry.get("plateau_band_kg")
            entry["summary"] = (
                f"No new estimated-1RM peak for {weeks_since_peak:g} weeks"
                + (f"; top sets between {band[0]:g} and {band[1]:g} kg." if band else ".")
            )

        if wanted:
            if len(sessions) <= 30:
                entry["timeline"] = [
                    {"date": s["date"].isoformat(), "e1rm_kg": round(s["e1rm"], 1), "e1rm_brzycki_kg": round(s["e1rm_brzycki"], 1) if s["e1rm_brzycki"] else None,
                     "tonnage_kg": round(s["tonnage"]), "top_set": s["top_set"]}
                    for s in sessions
                ]
            else:
                weekly: dict[date, dict[str, float]] = {}
                for s in sessions:
                    monday = s["date"] - timedelta(days=s["date"].weekday())
                    bucket = weekly.setdefault(monday, {"e1rm": 0.0, "tonnage": 0.0, "sessions": 0})
                    bucket["e1rm"] = max(bucket["e1rm"], s["e1rm"])
                    bucket["tonnage"] += s["tonnage"]
                    bucket["sessions"] += 1
                entry["timeline_weekly"] = [
                    {"week_start": k.isoformat(), "best_e1rm_kg": round(v["e1rm"], 1), "tonnage_kg": round(v["tonnage"]), "sessions": int(v["sessions"])}
                    for k, v in sorted(weekly.items())
                ]
        results.append(entry)

    evaluated = [r for r in results if r["status"] != "insufficient_data"]
    stalled = [r for r in evaluated if r["status"] in ("plateau", "regressing")]
    payload: dict[str, Any] = {
        "range": range_info(window),
        "plateau_window_weeks": plateau_weeks,
        "exercises": results,
        "overall": {
            "evaluated": len(evaluated),
            "progressing": sum(1 for r in evaluated if r["status"] == "progressing"),
            "plateau": sum(1 for r in evaluated if r["status"] == "plateau"),
            "regressing": sum(1 for r in evaluated if r["status"] == "regressing"),
            "deload_or_periodization_hint": len(evaluated) >= 3 and len(stalled) / len(evaluated) >= 0.4,
        },
        "method": (
            "e1RM = best working set per session (1-12 reps) by Epley; Brzycki is shown for single exercises. "
            f"Status compares the best e1RM of the last {plateau_weeks} weeks with the {plateau_weeks} weeks before "
            "(progressing >= +1.5%, regressing <= -1.5%, plateau otherwise with 3+ recent sessions). Tonnage = weight x reps of working sets."
        ),
    }
    if len(workouts) == 0:
        payload["notes"] = ["No completed workouts in this period."]
    return enforce_budget(payload, ["exercises"])


# ── Weight trend shared by metabolic and projection tools ────────────────────────

def _weight_trend(db: Session, user: User, start: date, end: date) -> dict[str, Any] | None:
    entries = db.query(WeightEntry).filter(
        WeightEntry.user_id == user.id, WeightEntry.date >= start, WeightEntry.date <= end,
    ).order_by(WeightEntry.date.asc()).all()
    if len(entries) < 4 or (entries[-1].date - entries[0].date).days < 10:
        return None
    xs = [float((e.date - start).days) for e in entries]
    ys = [float(e.weight_kg) for e in entries]
    fit = _linreg(xs, ys)
    if fit is None:
        return None
    first_x, last_x = xs[0], xs[-1]
    return {
        "entries": len(entries),
        "span_days": int(last_x - first_x),
        "slope_per_day": fit["slope"],
        "slope_stderr_per_day": fit["stderr"],
        "start_trend_kg": fit["intercept"] + fit["slope"] * first_x,
        "end_trend_kg": fit["intercept"] + fit["slope"] * last_x,
        "latest_entry_kg": ys[-1],
    }


# ── 3. Metabolic trend (TDEE) ────────────────────────────────────────────────────

async def metabolic_trend(db: Session, user: User, args: dict) -> dict[str, Any]:
    raw = args.get("windows")
    windows = sorted({_bounded(w, 0, 7, 120) for w in raw if isinstance(w, (int, float)) and not isinstance(w, bool)}) if isinstance(raw, list) else []
    windows = [w for w in windows if w] or [30, 60, 90]
    longest = windows[-1]
    unavailable = _nutrition_unavailable(user)
    if unavailable:
        return unavailable

    end = date.today()
    start = end - timedelta(days=longest - 1)
    fetched = await _load_nutrition(user, start, end)
    if fetched is None:
        return {"available": False, "reason": "Yazio-Daten konnten nicht geladen werden."}
    days = fetched["days"]

    def estimate(window_start: date, window_end: date) -> dict[str, Any]:
        length = (window_end - window_start).days + 1
        logged = [d for d in days if d["logged"] and window_start <= date.fromisoformat(d["date"]) <= window_end]
        coverage = len(logged) / length
        result: dict[str, Any] = {
            "window_days": length,
            "logged_days": len(logged),
            "coverage_pct": round(coverage * 100),
            "avg_intake_kcal": mean((d["calories"] for d in logged), 0),
        }
        trend = _weight_trend(db, user, window_start, window_end)
        if trend is None or not logged:
            result["tdee_kcal"] = None
            result["reason"] = "Not enough weight entries (need 4+ spanning 10+ days) or no logged nutrition in this window."
            return result
        tdee = result["avg_intake_kcal"] - trend["slope_per_day"] * KCAL_PER_KG
        result.update({
            "weight_entries": trend["entries"],
            "weight_trend_start_kg": round(trend["start_trend_kg"], 1),
            "weight_trend_end_kg": round(trend["end_trend_kg"], 1),
            "rate_kg_per_week": round(trend["slope_per_day"] * 7, 2),
            "tdee_kcal": round(tdee),
            "tdee_uncertainty_kcal": round(trend["slope_stderr_per_day"] * KCAL_PER_KG),
        })
        result["confidence"] = (
            "high" if coverage >= 0.8 and trend["entries"] >= 8 and trend["span_days"] >= 0.7 * length
            else "medium" if coverage >= 0.6 and trend["entries"] >= 5
            else "low"
        )
        return result

    window_results = [estimate(end - timedelta(days=w - 1), end) for w in windows]
    payload: dict[str, Any] = {
        "available": True,
        "as_of": end.isoformat(),
        "windows": window_results,
        "assumptions": f"TDEE = average logged intake - weight-trend slope x {int(KCAL_PER_KG)} kcal/kg. Weight entries are sparse and include water fluctuation, so treat values as estimates.",
    }

    if longest >= 58:
        recent_start = end - timedelta(days=29)
        earlier_end = recent_start - timedelta(days=1)
        earlier_start = end - timedelta(days=longest - 1)
        recent, earlier = estimate(recent_start, end), estimate(earlier_start, earlier_end)
        if recent.get("tdee_kcal") and earlier.get("tdee_kcal"):
            change = recent["tdee_kcal"] - earlier["tdee_kcal"]
            weight_change = recent["weight_trend_end_kg"] - earlier["weight_trend_start_kg"]
            expected = 22 * weight_change  # ~22 kcal/day of expenditure per kg of body mass
            adaptation = change - expected
            payload["adaptation"] = {
                "recent_30d_tdee_kcal": recent["tdee_kcal"],
                "earlier_tdee_kcal": earlier["tdee_kcal"],
                "earlier_period_days": earlier["window_days"],
                "tdee_change_kcal": change,
                "explained_by_weight_change_kcal": round(expected),
                "unexplained_change_kcal": round(adaptation),
                "possible_metabolic_adaptation": adaptation <= -100 and recent.get("confidence") != "low" and earlier.get("confidence") != "low",
                "caveat": "A drop can also come from under-logged intake, fewer steps or measurement noise.",
            }
        else:
            payload["adaptation"] = {"available": False, "reason": "Needs usable TDEE estimates for both the last 30 days and the period before."}
    if fetched["failed_days"]:
        payload["failed_days"] = fetched["failed_days"]
    return payload


# ── 4. Macro adherence ───────────────────────────────────────────────────────────

async def macro_adherence(db: Session, user: User, args: dict) -> dict[str, Any]:
    unavailable = _nutrition_unavailable(user)
    if unavailable:
        return unavailable
    window = resolve_range(args, default_days=30, max_days=120)
    tolerance = float(_bounded(args.get("tolerance_pct"), 5, 1, 30))
    fetched = await _load_nutrition(user, window["start"], window["end"])
    if fetched is None:
        return {"available": False, "reason": "Yazio-Daten konnten nicht geladen werden."}
    logged = [d for d in fetched["days"] if d["logged"]]
    if not logged:
        return {"available": True, "range": range_info(window), "logging": {"logged_days": 0}, "notes": ["No logged nutrition in this range."]}

    cal_days = [d for d in logged if d["goals"]["calories"] > 0]
    prot_days = [d for d in logged if d["goals"]["protein"] > 0]

    def in_corridor(value: float, goal: float) -> bool:
        return abs(value - goal) <= goal * tolerance / 100

    cal_ok = [d for d in cal_days if in_corridor(d["calories"], d["goals"]["calories"])]
    prot_reached = [d for d in prot_days if d["protein"] >= d["goals"]["protein"] * (1 - tolerance / 100)]
    prot_ok = [d for d in prot_days if in_corridor(d["protein"], d["goals"]["protein"])]
    both = [d for d in logged if d["goals"]["calories"] > 0 and d["goals"]["protein"] > 0
            and in_corridor(d["calories"], d["goals"]["calories"]) and d["protein"] >= d["goals"]["protein"] * (1 - tolerance / 100)]
    both_base = [d for d in logged if d["goals"]["calories"] > 0 and d["goals"]["protein"] > 0]

    def pct(part: list, whole: list) -> float | None:
        return round(len(part) / len(whole) * 100, 1) if whole else None

    deviations: dict[int, list[float]] = defaultdict(list)
    calories_by_day: dict[int, list[float]] = defaultdict(list)
    for d in cal_days:
        weekday = date.fromisoformat(d["date"]).weekday()
        deviations[weekday].append(d["calories"] - d["goals"]["calories"])
        calories_by_day[weekday].append(d["calories"])

    def avg_dev(weekdays: range) -> float | None:
        values = [v for w in weekdays for v in deviations.get(w, [])]
        return round(sum(values) / len(values)) if values else None

    mon_thu, fri_sun = avg_dev(range(0, 4)), avg_dev(range(4, 7))
    total_cal = sum(d["calories"] for d in logged) or 1
    kcal_protein, kcal_carbs, kcal_fat = (sum(d["protein"] for d in logged) * 4, sum(d["carbs"] for d in logged) * 4, sum(d["fat"] for d in logged) * 9)
    macro_total = (kcal_protein + kcal_carbs + kcal_fat) or 1

    insights = []
    if mon_thu is not None and fri_sun is not None and fri_sun - mon_thu >= 300:
        insights.append(f"Fri-Sun intake runs {fri_sun - mon_thu:+d} kcal above Mon-Thu relative to goal, which can offset a weekday deficit.")
    if prot_days and len(prot_reached) / len(prot_days) < 0.6:
        insights.append("Protein goal was reached on fewer than 60% of logged days.")

    payload = {
        "available": True,
        "range": range_info(window),
        "tolerance_pct": tolerance,
        "logging": {
            "days_in_range": window["days"],
            "logged_days": len(logged),
            "coverage_pct": round(len(logged) / window["days"] * 100),
        },
        "adherence": {
            "score_pct": pct(both, both_base),
            "calories_in_corridor_pct": pct(cal_ok, cal_days),
            "protein_goal_reached_pct": pct(prot_reached, prot_days),
            "protein_in_corridor_pct": pct(prot_ok, prot_days),
        },
        "calorie_balance_vs_goal": {
            "avg_deviation_kcal": round(sum(v for vs in deviations.values() for v in vs) / max(1, sum(len(vs) for vs in deviations.values()))),
            "mon_thu_avg_deviation_kcal": mon_thu,
            "fri_sun_avg_deviation_kcal": fri_sun,
            "by_weekday": [
                {"weekday": WEEKDAYS[w], "logged_days": len(deviations[w]), "avg_calories": round(sum(calories_by_day[w]) / len(calories_by_day[w])),
                 "avg_deviation_kcal": round(sum(deviations[w]) / len(deviations[w]))}
                for w in sorted(deviations)
            ],
        },
        "macro_distribution": {
            "avg_kcal": round(total_cal / len(logged)),
            "avg_protein_g": round(sum(d["protein"] for d in logged) / len(logged)),
            "avg_carbs_g": round(sum(d["carbs"] for d in logged) / len(logged)),
            "avg_fat_g": round(sum(d["fat"] for d in logged) / len(logged)),
            "protein_pct": round(kcal_protein / macro_total * 100),
            "carbs_pct": round(kcal_carbs / macro_total * 100),
            "fat_pct": round(kcal_fat / macro_total * 100),
        },
        "insights": insights,
        "definitions": "score = share of logged days with calories inside the corridor AND protein at least goal minus tolerance. Only logged days count.",
    }
    if fetched["failed_days"]:
        payload["failed_days"] = fetched["failed_days"]
    return payload


# ── 5. Sleep vs performance ──────────────────────────────────────────────────────

async def sleep_and_performance(db: Session, user: User, args: dict) -> dict[str, Any]:
    window = resolve_range(args, default_days=45, max_days=60)
    target_hours = float(_bounded(args.get("sleep_target_hours"), 8, 5, 10))
    workouts = completed_forge_workouts(
        db, user.id, since=window["start"] - timedelta(days=84), until=window["end"], newest_first=False,
    )
    indices = performance_indices(workouts)
    in_window = [v for v in indices.values() if window["start"] <= v["date"] <= window["end"]]

    nights_needed = {v["date"] for v in in_window}
    last_week = [window["end"] - timedelta(days=i) for i in range(7)]
    sleep = await _load_sleep(db, user, sorted(nights_needed | set(last_week)))
    if not sleep.get("available"):
        return {"available": False, "reason": sleep.get("reason")}
    nights = sleep["nights"]

    pairs = [(nights[v["date"].isoformat()]["minutes"] / 60, v["index"]) for v in in_window if v["date"].isoformat() in nights]
    payload: dict[str, Any] = {
        "available": True,
        "range": range_info(window),
        "workouts_scored": len(in_window),
        "workouts_with_sleep": len(pairs),
        "performance_index": "100 = as expected from your own e1RM trend per exercise (trend-adjusted); sleep = the night ending on the workout day.",
    }
    debt_nights = [(d, nights[d.isoformat()]["minutes"] / 60) for d in last_week if d.isoformat() in nights]
    payload["sleep_debt_last_7_days"] = {
        "target_hours_per_night": target_hours,
        "nights_with_data": len(debt_nights),
        "avg_sleep_hours": round(sum(h for _, h in debt_nights) / len(debt_nights), 1) if debt_nights else None,
        "accumulated_debt_hours": round(sum(max(0.0, target_hours - h) for _, h in debt_nights), 1) if debt_nights else None,
    }

    if len(pairs) < 6:
        payload["correlation"] = None
        payload["notes"] = ["Fewer than 6 workouts have both sleep data and a performance score; no correlation is reported."]
        return payload

    correlation = _pearson([p[0] for p in pairs], [p[1] for p in pairs])
    short = [idx for hours, idx in pairs if hours < 6.5]
    good = [idx for hours, idx in pairs if hours >= 7.5]
    payload["correlation"] = {
        **(correlation or {}),
        "short_sleep_under_6_5h": {"workouts": len(short), "avg_performance_index": mean(short)},
        "good_sleep_7_5h_plus": {"workouts": len(good), "avg_performance_index": mean(good)},
    }
    payload["interpretation"] = (
        "Association only, not proof of cause. "
        + ("The sample is large enough to take the direction seriously." if correlation and correlation["reliable"]
           else "The sample is small or the effect weak; treat as a hint.")
    )
    return payload


# ── 6. Performance correlations ──────────────────────────────────────────────────

async def performance_correlations(db: Session, user: User, args: dict) -> dict[str, Any]:
    window = resolve_range(args, default_days=90, max_days=120)
    workouts = completed_forge_workouts(
        db, user.id, since=window["start"] - timedelta(days=84), until=window["end"], newest_first=False,
    )
    indices = [v for v in performance_indices(workouts).values() if window["start"] <= v["date"] <= window["end"]]
    payload: dict[str, Any] = {
        "range": range_info(window),
        "workouts_scored": len(indices),
        "performance_index": "100 = as expected from your own e1RM trend per exercise (trend-adjusted).",
    }
    if len(indices) < 6:
        payload["notes"] = ["Fewer than 6 scored workouts; correlations would be noise."]
        return payload

    def bucket_stats(groups: dict[str, list[float]]) -> list[dict]:
        return [{"group": name, "workouts": len(values), "avg_performance_index": mean(values)} for name, values in groups.items() if values]

    timing: dict[str, list[float]] = {"morning (before 12:00)": [], "afternoon (12:00-17:00)": [], "evening (17:00+)": []}
    for item in indices:
        hour = item.get("hour")
        if hour is None:
            continue
        key = "morning (before 12:00)" if hour < 12 else "afternoon (12:00-17:00)" if hour < 17 else "evening (17:00+)"
        timing[key].append(item["index"])
    payload["training_time"] = bucket_stats(timing)

    steps_note = None
    unavailable = _nutrition_unavailable(user)
    if unavailable:
        steps_note = unavailable["reason"] + " Step analysis skipped."
    else:
        fetched = await _load_nutrition(user, window["start"] - timedelta(days=1), window["end"])
        if fetched is None:
            steps_note = "Yazio-Daten konnten nicht geladen werden. Step analysis skipped."
        else:
            steps = {d["date"]: d["steps"] for d in fetched["days"] if d["steps"] and d["steps"] > 0}
            pairs = [(steps[(item["date"] - timedelta(days=1)).isoformat()], item["index"])
                     for item in indices if (item["date"] - timedelta(days=1)).isoformat() in steps]
            if len(pairs) < 6:
                steps_note = "Fewer than 6 workouts have step data for the previous day (Yazio steps)."
            else:
                groups: dict[str, list[float]] = {"under 8,000 steps": [], "8,000-15,000 steps": [], "over 15,000 steps": []}
                for count, index in pairs:
                    groups["under 8,000 steps" if count < 8000 else "8,000-15,000 steps" if count <= 15000 else "over 15,000 steps"].append(index)
                payload["previous_day_steps"] = {
                    "source": "yazio",
                    "groups": bucket_stats(groups),
                    "correlation": _pearson([float(p[0]) for p in pairs], [p[1] for p in pairs]),
                }
    if steps_note:
        payload["notes"] = [steps_note]
    payload["interpretation"] = "Associations only. Small groups (fewer than ~5 workouts) are unreliable."
    return payload


# ── 7. Goal projection ───────────────────────────────────────────────────────────

def _eta(weeks: float, today: date) -> str | None:
    if not math.isfinite(weeks) or weeks < 0 or weeks > 156:
        return None
    return (today + timedelta(days=round(weeks * 7))).isoformat()


def _corridor(current: float, target: float, rate_per_week: float, stderr_per_week: float, today: date) -> dict[str, Any]:
    distance = target - current
    if abs(distance) < 0.05:
        return {"status": "reached"}
    if rate_per_week == 0 or (distance > 0) != (rate_per_week > 0):
        return {"status": "not_moving_toward_target", "rate_kg_per_week": round(rate_per_week, 2)}
    uncertainty = max(stderr_per_week, 0.2 * abs(rate_per_week))
    fast, slow = abs(rate_per_week) + uncertainty, abs(rate_per_week) - uncertainty
    weeks_fast, weeks_slow = abs(distance) / fast, (abs(distance) / slow if slow > 0.02 else float("inf"))
    return {
        "status": "on_track" if _eta(weeks_slow, today) else "very_slow_or_open_ended",
        "rate_kg_per_week": round(rate_per_week, 2),
        "weeks_to_target": [round(weeks_fast, 1), round(weeks_slow, 1) if math.isfinite(weeks_slow) else None],
        "earliest_date": _eta(weeks_fast, today),
        "latest_date": _eta(weeks_slow, today),
    }


async def goal_projection(db: Session, user: User, args: dict) -> dict[str, Any]:
    target = args.get("target_weight_kg")
    if isinstance(target, bool) or not isinstance(target, (int, float)) or not 30 <= float(target) <= 300:
        return {"available": False, "reason": "target_weight_kg (30-300) is required."}
    target = float(target)
    today = date.today()

    trend = _weight_trend(db, user, today - timedelta(days=27), today) or _weight_trend(db, user, today - timedelta(days=55), today)
    if trend is None:
        return {"available": False, "reason": "Not enough weight data (need 4+ entries spanning 10+ days within the last 8 weeks)."}

    current = trend["end_trend_kg"]
    rate = trend["slope_per_day"] * 7
    stderr = trend["slope_stderr_per_day"] * 7
    losing = target < current
    kcal_per_step = 0.0005 * current

    payload: dict[str, Any] = {
        "available": True,
        "as_of": today.isoformat(),
        "current_trend_weight_kg": round(current, 1),
        "latest_entry_kg": round(trend["latest_entry_kg"], 1),
        "target_weight_kg": target,
        "distance_kg": round(target - current, 1),
        "current_trend": {"rate_kg_per_week": round(rate, 2), "weight_entries": trend["entries"], "span_days": trend["span_days"]},
        "baseline": _corridor(current, target, rate, stderr, today),
    }
    warnings = []
    if abs(rate) > 0.01 * current:
        warnings.append("Current rate exceeds 1% of body weight per week; it is unlikely to stay that fast.")
    if trend["entries"] < 8:
        warnings.append("Few weight entries; the corridor is wide and uncertain.")

    scenarios = args.get("scenarios")
    if not isinstance(scenarios, list) or not scenarios:
        scenarios = (
            [{"name": "200 kcal/day less", "calorie_change_per_day": -200}, {"name": "+3000 steps/day", "extra_steps_per_day": 3000}]
            if losing else [{"name": "200 kcal/day more", "calorie_change_per_day": 200}]
        )
    results = []
    for index, scenario in enumerate(scenarios[:6]):
        if not isinstance(scenario, dict):
            continue
        try:
            calories = float(scenario.get("calorie_change_per_day") or 0)
            steps = float(scenario.get("extra_steps_per_day") or 0)
        except (TypeError, ValueError):
            continue
        balance_change = calories - steps * kcal_per_step  # kcal/day; negative lowers weight
        scenario_rate = rate + balance_change * 7 / KCAL_PER_KG
        entry = {
            "name": scenario.get("name") or f"Scenario {index + 1}",
            "calorie_change_per_day": calories,
            "extra_steps_per_day": steps,
            "energy_balance_change_kcal_per_day": round(balance_change),
            **_corridor(current, target, scenario_rate, stderr, today),
        }
        if abs(scenario_rate) > 0.01 * current:
            entry["warning"] = "More than 1% of body weight per week; likely unsustainable."
        results.append(entry)
    payload["scenarios"] = results

    unavailable = _nutrition_unavailable(user)
    if not unavailable:
        try:
            fetched = await _load_nutrition(user, today - timedelta(days=27), today)
        except Exception:
            fetched = None
        if fetched:
            logged = [d for d in fetched["days"] if d["logged"]]
            intake = mean(d["calories"] for d in logged)
            if intake is not None and len(logged) >= 14:
                payload["energy_context"] = {
                    "avg_intake_kcal_28d": round(intake),
                    "estimated_tdee_kcal": round(intake - trend["slope_per_day"] * KCAL_PER_KG),
                    "logged_days": len(logged),
                }
    payload["assumptions"] = (
        f"Linear projection from the weight-trend slope; {int(KCAL_PER_KG)} kcal per kg; steps burn about {kcal_per_step:.3f} kcal each at your weight. "
        "Real progress usually slows over time (water, metabolic adaptation), so treat the later date as more realistic."
    )
    if warnings:
        payload["warnings"] = warnings
    return payload


def _declaration(name: str, description: str, properties: dict[str, Any], required: list[str] | None = None) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required or []},
        },
    }


_RANGE_PROPERTIES = {
    "start_date": {"type": "string", "description": "YYYY-MM-DD, inclusive"},
    "end_date": {"type": "string", "description": "YYYY-MM-DD, inclusive; default today"},
    "days": {"type": "integer", "minimum": 1, "description": "Last N days (used when start_date is omitted)"},
}

ANALYTICS_STATUS_TEXT = {
    "get_volume_and_frequency_analysis": "Ich analysiere dein Trainingsvolumen pro Muskelgruppe.",
    "get_strength_progression_analytics": "Ich werte deine Kraftentwicklung aus.",
    "get_metabolic_trend_analysis": "Ich schätze deinen tatsächlichen Energieverbrauch.",
    "get_macro_adherence_score": "Ich prüfe, wie gut du deine Ernährungsziele triffst.",
    "get_sleep_and_performance_correlation": "Ich vergleiche deinen Schlaf mit deiner Trainingsleistung.",
    "get_performance_correlations": "Ich suche Muster in deiner Trainingsleistung.",
    "project_goal_timeline": "Ich berechne eine Prognose für dein Ziel.",
}

ANALYTICS_DECLARATIONS = [
    _declaration(
        "get_volume_and_frequency_analysis",
        "Weekly effective hard sets and training frequency per muscle group over the last 1-26 weeks (default 8), compared with Israetel MEV/MAV/MRV landmarks. Flags neglected muscles and overreaching risk.",
        {"weeks": {"type": "integer", "minimum": 1, "maximum": 26}, "end_date": {"type": "string", "description": "YYYY-MM-DD; default today"}},
    ),
    _declaration(
        "get_strength_progression_analytics",
        "Estimated 1RM (Epley/Brzycki), tonnage and plateau detection per exercise. Without exercise_name it summarises the most-trained lifts; with exercise_name it adds a timeline. Default range 90 days (max 730).",
        {**_RANGE_PROPERTIES, "exercise_name": {"type": "string"}, "top_n": {"type": "integer", "minimum": 1, "maximum": 15},
         "plateau_weeks": {"type": "integer", "minimum": 2, "maximum": 12}},
    ),
    _declaration(
        "get_metabolic_trend_analysis",
        "Estimates real TDEE from logged intake and the weight trend over 30/60/90 day windows (custom `windows` possible, 7-120 days), with confidence and a metabolic-adaptation check. Slow for long windows because Yazio is queried per day.",
        {"windows": {"type": "array", "items": {"type": "integer", "minimum": 7, "maximum": 120}, "maxItems": 4}},
    ),
    _declaration(
        "get_macro_adherence_score",
        "Share of logged days with calories inside the goal corridor and protein goal reached, Mon-Thu vs Fri-Sun calorie deviation, per-weekday averages and macro split. Default 30 days (max 120).",
        {**_RANGE_PROPERTIES, "tolerance_pct": {"type": "integer", "minimum": 1, "maximum": 30, "description": "Default 5"}},
    ),
    _declaration(
        "get_sleep_and_performance_correlation",
        "Correlates the previous night's sleep (Google Health) with a trend-adjusted performance index of the workout, plus accumulated sleep debt over the last 7 nights. Default 45 days (max 60).",
        {**_RANGE_PROPERTIES, "sleep_target_hours": {"type": "integer", "minimum": 5, "maximum": 10}},
    ),
    _declaration(
        "get_performance_correlations",
        "Looks for personal patterns in trend-adjusted workout performance: training time of day and previous-day step count. Default 90 days (max 120).",
        _RANGE_PROPERTIES,
    ),
    _declaration(
        "project_goal_timeline",
        "Projects when a target body weight is reached from the current weight trend (earliest-latest corridor) and simulates scenarios such as eating 200 kcal less or walking 3000 more steps per day.",
        {
            "target_weight_kg": {"type": "number", "minimum": 30, "maximum": 300},
            "scenarios": {
                "type": "array", "maxItems": 6,
                "items": {"type": "object", "properties": {
                    "name": {"type": "string"},
                    "calorie_change_per_day": {"type": "number", "description": "Negative = eat less"},
                    "extra_steps_per_day": {"type": "number"},
                }},
            },
        },
        ["target_weight_kg"],
    ),
]


ANALYTICS_TOOLS = {
    "get_volume_and_frequency_analysis": volume_and_frequency,
    "get_strength_progression_analytics": strength_progression,
    "get_metabolic_trend_analysis": metabolic_trend,
    "get_macro_adherence_score": macro_adherence,
    "get_sleep_and_performance_correlation": sleep_and_performance,
    "get_performance_correlations": performance_correlations,
    "project_goal_timeline": goal_projection,
}
