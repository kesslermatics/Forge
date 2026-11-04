"""Shared helpers for tools that accept a dynamic date range.

External agents choose the range, but the response size must stay bounded so a long
range cannot overflow the caller's context window. Every range tool therefore:

* resolves ``start_date`` / ``end_date`` / ``days`` into one validated window,
* aggregates long windows into week or month buckets instead of one row per day,
* trims the final payload to a character budget and says so explicitly.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Any, Iterable

# Roughly 15k tokens. Large enough for useful detail, small enough for any agent context.
DEFAULT_CHAR_BUDGET = 60_000
MAX_DAILY_ROWS = 31
GRANULARITIES = ("auto", "day", "week", "month")


def parse_iso_date(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return date.fromisoformat(value.strip()[:10])
    except ValueError:
        return None


def resolve_range(
    args: dict,
    *,
    default_days: int,
    max_days: int,
    today: date | None = None,
) -> dict[str, Any]:
    """Resolve ``start_date``, ``end_date`` and ``days`` into one bounded window.

    * ``start_date`` and/or ``end_date`` (YYYY-MM-DD) take priority.
    * Otherwise ``days`` counts back from ``end_date`` (default: today).
    * The window never ends in the future and never exceeds ``max_days``;
      ``notes`` explains every adjustment so the caller can react.
    """
    today = today or date.today()
    notes: list[str] = []

    raw_end = args.get("end_date")
    end = parse_iso_date(raw_end)
    if raw_end not in (None, "") and end is None:
        notes.append("end_date was not a valid YYYY-MM-DD date and was ignored.")
    if end is None:
        end = today
    if end > today:
        end = today
        notes.append("end_date lies in the future and was set to today.")

    raw_start = args.get("start_date")
    start = parse_iso_date(raw_start)
    if raw_start not in (None, "") and start is None:
        notes.append("start_date was not a valid YYYY-MM-DD date and was ignored.")

    if start is None:
        days = args.get("days")
        if isinstance(days, bool) or not isinstance(days, (int, float)):
            days = default_days
        days = max(1, int(days))
        start = end - timedelta(days=days - 1)

    if start > end:
        start, end = end, start
        notes.append("start_date was after end_date; the two were swapped.")

    span = (end - start).days + 1
    if span > max_days:
        start = end - timedelta(days=max_days - 1)
        span = max_days
        notes.append(f"The range was shortened to the most recent {max_days} days (the maximum for this tool).")

    return {"start": start, "end": end, "days": span, "notes": notes}


def range_info(window: dict[str, Any]) -> dict[str, Any]:
    info = {
        "start_date": window["start"].isoformat(),
        "end_date": window["end"].isoformat(),
        "days": window["days"],
    }
    if window["notes"]:
        info["notes"] = window["notes"]
    return info


def choose_granularity(requested: object, span_days: int) -> tuple[str, str | None]:
    """Return the effective bucket size and an optional note when it was adjusted."""
    value = requested if requested in GRANULARITIES else "auto"
    if value == "auto":
        if span_days <= 21:
            return "day", None
        if span_days <= 120:
            return "week", None
        return "month", None
    if value == "day" and span_days > MAX_DAILY_ROWS:
        return "week", f"granularity 'day' is limited to {MAX_DAILY_ROWS} days; switched to 'week'."
    if value == "week" and span_days > 400:
        return "month", "granularity 'week' is limited to 400 days; switched to 'month'."
    return value, None


def bucket_key(day: date, granularity: str) -> str:
    if granularity == "day":
        return day.isoformat()
    if granularity == "week":
        monday = day - timedelta(days=day.weekday())
        return monday.isoformat()
    return day.strftime("%Y-%m")


def bucket_bounds(key: str, granularity: str, window_start: date, window_end: date) -> tuple[date, date]:
    """Inclusive bounds of a bucket, clipped to the requested window."""
    if granularity == "day":
        first = last = date.fromisoformat(key)
    elif granularity == "week":
        first = date.fromisoformat(key)
        last = first + timedelta(days=6)
    else:
        first = date.fromisoformat(f"{key}-01")
        nxt = (first.replace(day=28) + timedelta(days=4)).replace(day=1)
        last = nxt - timedelta(days=1)
    return max(first, window_start), min(last, window_end)


def mean(values: Iterable[float | int | None], digits: int = 1) -> float | None:
    clean = [float(v) for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
    return round(sum(clean) / len(clean), digits) if clean else None


def enforce_budget(
    payload: dict[str, Any],
    list_keys: list[str],
    *,
    budget: int = DEFAULT_CHAR_BUDGET,
) -> dict[str, Any]:
    """Drop trailing list items until the JSON payload fits ``budget`` characters.

    The first listed key is trimmed first. ``truncation`` documents what was removed,
    so the caller knows to narrow the range or page through the data.
    """
    def size() -> int:
        return len(json.dumps(payload, ensure_ascii=False, default=str))

    if size() <= budget:
        return payload

    removed: dict[str, int] = {}
    for key in list_keys:
        items = payload.get(key)
        if not isinstance(items, list):
            continue
        while items and size() > budget:
            # Remove in chunks so large payloads converge quickly.
            drop = max(1, len(items) // 10)
            del items[-drop:]
            removed[key] = removed.get(key, 0) + drop
        if size() <= budget:
            break

    if removed:
        payload["truncation"] = {
            "truncated": True,
            "removed_items": removed,
            "reason": f"The response exceeded {budget} characters. Narrow the date range, use a coarser granularity or detail level, or page with offset.",
        }
    return payload
