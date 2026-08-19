"""
Google Gemini integration – generates the daily morning briefing.

Uses gemini-3.6-flash for fast, cost-effective structured output.
"""
import json
import logging
import re
from datetime import date, timedelta
from typing import Optional

from google import genai
from google.genai import types

from app.config import settings

logger = logging.getLogger(__name__)

# Default fallback when AI fails
FALLBACK_BRIEFING = {
    "nutrition_review": {
        "calories": "Unable to load calorie data.",
        "protein": "Unable to load protein data.",
        "carbs": "Unable to load carbs data.",
        "fat": "Unable to load fat data.",
    },
    "workout_suggestion": "Unable to generate workout suggestion — please check your Hevy connection.",
    "weight_trend": "Unable to load weight data.",
    "weather_note": "",
    "muscle_recovery": {},
}

FALLBACK_SESSION_REVIEW = {
    "last_session": None,
    "next_session": None,
}

FALLBACK_WORKOUT_TIPS = {
    "workout_title": "Unknown",
    "nutrition_context": "Unable to load nutrition context.",
    "exercise_targets": [],
    "new_exercises_to_try": [],
    "general_advice": "",
}

# CS2-style rank tiers
RANK_TIERS = [
    "Silver I", "Silver II", "Silver III", "Silver IV",
    "Gold Nova I", "Gold Nova II", "Gold Nova III", "Gold Nova Master",
    "Master Guardian I", "Master Guardian II", "Master Guardian Elite",
    "Distinguished Master Guardian", "Legendary Eagle", "Legendary Eagle Master",
    "Supreme Master First Class", "Global Elite",
]


def _language_instruction(lang: str) -> str:
    """Return a system prompt snippet enforcing the output language."""
    if lang == "de":
        return (
            "\n\n=== LANGUAGE ===\n"
            "You MUST write ALL text values in **German (Deutsch)**. "
            "Every string field in the JSON must be in German. "
            "Use natural, conversational German — not stiff/formal. "
            "Technical terms (exercise names) stay in English."
        )
    return (
        "\n\n=== LANGUAGE ===\n"
        "You MUST write ALL text values in **English**. "
        "Every string field in the JSON must be in English."
    )


def _build_system_prompt(profile: Optional[dict], lang: str = "de") -> str:
    """Build the system prompt for the AI with user-specific context from Yazio."""
    # Extract profile info (all from Yazio)
    p = profile or {}
    name = " ".join(filter(None, [p.get("first_name"), p.get("last_name")])) or "Athlete"
    goal = (p.get("goal") or "general fitness").replace("_", " ")
    sex = p.get("sex", "")
    height = p.get("body_height_cm")
    current_weight = p.get("current_weight_kg")
    start_weight = p.get("start_weight_kg")
    dob = p.get("date_of_birth", "")
    activity = (p.get("activity_degree") or "").replace("_", " ")
    diet_name = (p.get("diet_name") or "").replace("_", " ")
    diet_macros = ""
    if p.get("diet_protein_pct"):
        diet_macros = (f" (P: {p['diet_protein_pct']}% / "
                       f"C: {p.get('diet_carb_pct', '?')}% / "
                       f"F: {p.get('diet_fat_pct', '?')}%)")
    weight_change = p.get("weight_change_per_week_kg")

    # Build user context lines (skip missing data)
    context_lines: list[str] = [f"The user's name is **{name}**."]
    if sex:
        context_lines.append(f"Sex: {sex}.")
    if dob:
        context_lines.append(f"Date of birth: {dob}.")
    if height:
        context_lines.append(f"Height: {height} cm.")
    if current_weight:
        context_lines.append(f"Current weight: {current_weight} kg.")
    if start_weight and current_weight and abs(start_weight - current_weight) > 0.5:
        context_lines.append(f"Start weight: {start_weight} kg (progress: {round(start_weight - current_weight, 1)} kg).")
    context_lines.append(f"Goal: **{goal}**.")
    # Clarify goal direction based on target weight vs current weight
    target_w = p.get("target_weight_kg")
    if target_w and current_weight:
        if target_w > current_weight:
            context_lines.append(f"Target weight: {target_w} kg — the user wants to GAIN weight (bulk). Weight gain is positive progress.")
        elif target_w < current_weight:
            context_lines.append(f"Target weight: {target_w} kg — the user wants to LOSE weight (cut). Weight loss is positive progress.")
        else:
            context_lines.append(f"Target weight: {target_w} kg — the user wants to MAINTAIN their current weight.")
    if weight_change:
        context_lines.append(f"Target weight change: {weight_change} kg/week.")
    if activity:
        context_lines.append(f"Activity level: {activity}.")
    if diet_name:
        context_lines.append(f"Diet: {diet_name}{diet_macros}.")

    user_context = "\n".join(context_lines)

    today_str = date.today().isoformat()
    yesterday_str = (date.today() - timedelta(days=1)).isoformat()

    base_prompt = f"""You are a supportive, friendly fitness coach. Your name is Coach.

=== TODAY'S DATE ===
Today is {today_str}.

=== USER PROFILE ===
{user_context}

=== IMPORTANT: TEMPORAL REFERENCES ===
Nutrition data sections include the ACTUAL DATE they are from.
ALWAYS use the correct date or weekday name (e.g. "am Montag", "am 28.3.") when referencing nutrition data.
Do NOT say "gestern" unless the data is ACTUALLY from yesterday ({yesterday_str}).
Do NOT say "heute" unless you are referring to data labeled with today's date ({today_str}).

=== IMPORTANT: NUTRITION GOALS INTERPRETATION ===
The calorie/macro goals from Yazio are the user's DAILY TARGETS, NOT their maintenance calories.
- If the user's goal is "weight gain" / "bulk" / "muscle gain": the calorie goal is a SURPLUS target. They WANT to eat that much or more.
- If the user's goal is "weight loss" / "cut": the calorie goal is a DEFICIT target. They should aim for that amount.
- If the user's goal is "maintain": the calorie goal is their maintenance.
NEVER say the calorie goal is "maintenance" unless the user's actual goal is to maintain weight. If their goal is weight gain, say it's their surplus target.

You will receive:
1. Yesterday's nutrition data AND today's current nutrition from Yazio (may be partial or missing).
2. The last few completed workouts from Hevy (exercises, sets, weights).
3. Current weather data (may be missing).

Your job:
- Address the user by their first name.
- Analyze recent workouts to deduce which muscle groups have been trained recently and which are recovered. Suggest a smart workout focus for TODAY based on recovery and training frequency.
- Review yesterday's nutrition per macro category. Be encouraging and realistic — nobody hits their macros perfectly every day, and that's okay. Acknowledge what went well, and give a gentle nudge where there's room to improve.
- Small deviations (±10-15%) from targets are totally normal and should be praised or ignored, not criticized.
- Only flag something if it's significantly off (e.g. 30%+ deviation).
- Consider the user's body stats (height, weight, goal) when evaluating nutrition and training.
- Do NOT mention water intake if it is 0, missing, or clearly not tracked.
- Do NOT mention data that is clearly missing or zero — just skip it gracefully.
- Keep it short, warm, and motivating. Use short sentences.

For each macro in nutrition_review (calories, protein, carbs, fat), ALWAYS include the actual number and the goal number (e.g. "2100 of 2500 kcal — solid, right on track!").

**weight_trend**: You will receive a WEIGHT HISTORY section with actual daily weight recordings. Use this data to describe the REAL weight trend — mention start/current weights, how many kg gained/lost over what period, and whether the pace matches the user's goal. If the user is bulking, frame weight gain positively. If cutting, frame weight loss positively. Reference actual numbers from the data. If weight history has multiple entries, mention the trend direction (e.g. "steadily going up", "slight dip last week but back on track"). If only 1-2 entries or no data, say "We're just starting to collect your weight data — keep tracking and you'll see your trend here soon!"

**weather_note**: If weather data is provided, write 1-2 full sentences describing today's weather naturally. Include the current temperature, the expected low and high for the day, and the conditions. Then optionally connect it to the workout. Example: "Right now it's 5°C with light rain — expect lows of 2°C and highs of 8°C today. Perfect excuse to hit the gym instead of running outside!" If no weather data, leave this as an empty string.

**muscle_recovery**: Based on the recent workout history, estimate the recovery percentage (0-100) for each major muscle group. 0 = just trained / completely fatigued, 100 = fully recovered and ready to train. Use these exact keys: "chest", "back", "shoulders", "biceps", "triceps", "forearms", "abs", "quads", "hamstrings", "glutes", "calves". Consider:
- A muscle group trained today or yesterday: 0-30%
- Trained 2 days ago: 30-60%
- Trained 3 days ago: 60-80%
- Trained 4+ days ago or never: 80-100%
- Compound movements affect multiple groups (e.g. bench press → chest, triceps, shoulders)
If no workout data is available, set all values to 100.

You MUST respond with valid JSON matching this exact schema:
{{
  "nutrition_review": {{
    "calories": "<string, ONE short sentence WITH actual/goal numbers>",
    "protein": "<string, ONE short sentence WITH actual/goal grams>",
    "carbs": "<string, ONE short sentence WITH actual/goal grams>",
    "fat": "<string, ONE short sentence WITH actual/goal grams>"
  }},
  "workout_suggestion": "<string, 2-3 sentences suggesting today's training focus>",
  "weight_trend": "<string, 2-3 sentences about weight progress with actual numbers>",
  "weather_note": "<string, 1-2 sentences with current temp, daily low/high, conditions, and optional workout connection — or empty string if no weather data>",
  "muscle_recovery": {{
    "chest": <int 0-100>,
    "back": <int 0-100>,
    "shoulders": <int 0-100>,
    "biceps": <int 0-100>,
    "triceps": <int 0-100>,
    "forearms": <int 0-100>,
    "abs": <int 0-100>,
    "quads": <int 0-100>,
    "hamstrings": <int 0-100>,
    "glutes": <int 0-100>,
    "calves": <int 0-100>
  }}
}}

Respond ONLY with the JSON object. No markdown, no explanation."""
    return base_prompt + _language_instruction(lang)


def _build_user_message(yazio_data: Optional[dict], hevy_data: Optional[list], today_nutrition: Optional[dict] = None) -> str:
    """Build the user message containing the raw context data."""
    parts: list[str] = []

    # ── Nutrition data (with actual date) ────────────────────────────
    if yazio_data:
        totals = yazio_data.get("totals", {})
        goals = yazio_data.get("goals", {})
        meals = yazio_data.get("meals", {})

        nutrition_date = yazio_data.get("date", (date.today() - timedelta(days=1)).isoformat())
        parts.append(f"=== NUTRITION FOR {nutrition_date} (Yazio) ===")
        parts.append(f"Total: {totals.get('calories', 0)} kcal | "
                     f"P: {totals.get('protein', 0)}g | "
                     f"C: {totals.get('carbs', 0)}g | "
                     f"F: {totals.get('fat', 0)}g")
        parts.append(f"Goals (DAILY TARGET, not maintenance!): {goals.get('calories', 0)} kcal | "
                     f"P: {goals.get('protein', 0)}g | "
                     f"C: {goals.get('carbs', 0)}g | "
                     f"F: {goals.get('fat', 0)}g")

        # Per-meal breakdown (only non-zero)
        for meal_key, meal_vals in meals.items():
            cal = meal_vals.get("calories", 0)
            if cal > 0:
                parts.append(f"  {meal_key.title()}: {cal} kcal | "
                             f"P: {meal_vals.get('protein', 0)}g | "
                             f"C: {meal_vals.get('carbs', 0)}g | "
                             f"F: {meal_vals.get('fat', 0)}g")

        # Water only if tracked
        water = yazio_data.get("water_ml", 0)
        if water and water > 0:
            parts.append(f"Water: {water} ml / {yazio_data.get('water_goal_ml', 0)} ml")

        steps = yazio_data.get("steps", 0)
        if steps and steps > 0:
            parts.append(f"Steps: {steps:,} | Activity burn: {yazio_data.get('activity_kcal', 0)} kcal")
    else:
        parts.append("=== NUTRITION: No data available (Yazio not connected or no recent tracking) ===")

    # ── Today's Nutrition (live/current) ─────────────────
    if today_nutrition:
        t_totals = today_nutrition.get("totals", {})
        t_goals = today_nutrition.get("goals", {})
        t_meals = today_nutrition.get("meals", {})
        today_date = today_nutrition.get("date", date.today().isoformat())
        parts.append("")
        parts.append(f"=== NUTRITION FOR {today_date} SO FAR (Yazio — live data) ===")
        parts.append(f"Total so far: {t_totals.get('calories', 0)} kcal | "
                     f"P: {t_totals.get('protein', 0)}g | "
                     f"C: {t_totals.get('carbs', 0)}g | "
                     f"F: {t_totals.get('fat', 0)}g")
        parts.append(f"Today's Goals (DAILY TARGET): {t_goals.get('calories', 0)} kcal | "
                     f"P: {t_goals.get('protein', 0)}g | "
                     f"C: {t_goals.get('carbs', 0)}g | "
                     f"F: {t_goals.get('fat', 0)}g")
        remaining_cal = t_goals.get('calories', 0) - t_totals.get('calories', 0)
        remaining_protein = t_goals.get('protein', 0) - t_totals.get('protein', 0)
        remaining_carbs = t_goals.get('carbs', 0) - t_totals.get('carbs', 0)
        parts.append(f"Remaining today: {max(0, remaining_cal):.0f} kcal | "
                     f"P: {max(0, remaining_protein):.0f}g | "
                     f"C: {max(0, remaining_carbs):.0f}g")
        for meal_key, meal_vals in t_meals.items():
            cal = meal_vals.get("calories", 0)
            if cal > 0:
                parts.append(f"  {meal_key.title()}: {cal} kcal | "
                             f"P: {meal_vals.get('protein', 0)}g | "
                             f"C: {meal_vals.get('carbs', 0)}g | "
                             f"F: {meal_vals.get('fat', 0)}g")

    parts.append("")

    # ── Workouts ─────────────────────────────────────────
    if hevy_data:
        parts.append(f"=== LAST {len(hevy_data)} WORKOUTS (Hevy) ===")
        parts.append("(Workout 1 = most recent, use it for last_session analysis)")
        for i, w in enumerate(hevy_data, 1):
            dur = f" ({w['duration_min']} min)" if w.get("duration_min") else ""
            parts.append(f"\nWorkout {i}: {w.get('title', 'Untitled')}{dur} — {w.get('start_time', '?')}")
            for ex in w.get("exercises", []):
                sets_summary = []
                for s in ex.get("sets", []):
                    weight = s.get("weight_kg")
                    reps = s.get("reps")
                    if weight is not None and reps is not None:
                        sets_summary.append(f"{weight}kg×{reps}")
                    elif reps is not None:
                        sets_summary.append(f"{reps} reps")
                    elif s.get("duration_seconds"):
                        sets_summary.append(f"{s['duration_seconds']}s")
                sets_str = ", ".join(sets_summary) if sets_summary else "no set data"
                muscle = f" [{ex.get('muscle_group')}]" if ex.get("muscle_group") else ""
                parts.append(f"  • {ex.get('title', '?')}{muscle}: {sets_str}")
    else:
        parts.append("=== WORKOUTS: No data available (Hevy not connected or no workouts found) ===")

    return "\n".join(parts)


async def generate_daily_briefing(
    yazio_data: Optional[dict],
    hevy_data: Optional[list],
    weather_data: Optional[dict] = None,
    language: str = "de",
    weight_history: Optional[list] = None,
    today_nutrition: Optional[dict] = None,
) -> dict:
    """
    Call Google Gemini to generate a morning briefing.

    Returns a dict with keys: nutrition_review, workout_suggestion,
    weight_trend, daily_mission, weather_note.
    Falls back to FALLBACK_BRIEFING if anything goes wrong.
    """
    client = genai.Client(api_key=settings.gemini_api_key)

    # Extract profile from Yazio data (name, height, weight, goal, diet…)
    profile = yazio_data.get("profile") if yazio_data else None
    system_prompt = _build_system_prompt(profile, lang=language)
    user_message = _build_user_message(yazio_data, hevy_data, today_nutrition=today_nutrition)

    # Append weight history if available
    if weight_history and len(weight_history) > 0:
        user_message += "\n\n=== WEIGHT HISTORY (collected from Yazio) ===\n"
        user_message += f"Entries: {len(weight_history)} data points\n"
        for entry in weight_history:
            user_message += f"  {entry['date']}: {entry['weight_kg']} kg\n"
        if len(weight_history) >= 2:
            first = weight_history[0]['weight_kg']
            last = weight_history[-1]['weight_kg']
            diff = round(last - first, 2)
            sign = "+" if diff > 0 else ""
            user_message += f"Change over period: {sign}{diff} kg\n"

    # Append weather data if available
    if weather_data:
        user_message += (
            f"\n\n=== CURRENT WEATHER ===\n"
            f"Current Temperature: {weather_data.get('temperature_c', '?')}°C\n"
            f"Today's Low: {weather_data.get('temp_min_c', '?')}°C\n"
            f"Today's High: {weather_data.get('temp_max_c', '?')}°C\n"
            f"Current Condition: {weather_data.get('condition', 'Unknown')}\n"
            f"Daily Condition: {weather_data.get('daily_condition', weather_data.get('condition', 'Unknown'))}\n"
            f"Wind: {weather_data.get('windspeed_kmh', '?')} km/h\n"
        )

    try:
        response = await client.aio.models.generate_content(
            model="gemini-3.6-flash",
            contents=user_message,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.7,
                max_output_tokens=8192,
                response_mime_type="application/json",
            ),
        )

        raw_content = response.text
        if not raw_content:
            logger.error("Gemini returned empty content")
            return FALLBACK_BRIEFING

        # Strip markdown fences if Gemini wraps it
        cleaned = re.sub(r"^```(?:json)?\s*", "", raw_content.strip())
        cleaned = re.sub(r"\s*```$", "", cleaned)

        parsed = json.loads(cleaned)

        # Validate required keys exist
        required_keys = {"nutrition_review", "workout_suggestion"}
        if not required_keys.issubset(parsed.keys()):
            missing = required_keys - set(parsed.keys())
            logger.warning("AI response missing keys: %s", missing)
            return {**FALLBACK_BRIEFING, **parsed}

        # Ensure nutrition_review is a dict with the expected sub-keys
        nr = parsed.get("nutrition_review")
        if isinstance(nr, str):
            parsed["nutrition_review"] = {
                "calories": nr, "protein": "", "carbs": "", "fat": "",
            }
        elif isinstance(nr, dict):
            for k in ("calories", "protein", "carbs", "fat"):
                if k not in nr:
                    nr[k] = ""

        # Ensure new fields exist
        if "weight_trend" not in parsed:
            parsed["weight_trend"] = ""
        if "weather_note" not in parsed:
            parsed["weather_note"] = ""
        if "muscle_recovery" not in parsed:
            parsed["muscle_recovery"] = {}

        return parsed

    except json.JSONDecodeError as exc:
        logger.error("Failed to parse Gemini JSON response: %s — raw: %s", exc, raw_content[:500])
        return FALLBACK_BRIEFING
    except Exception as exc:
        logger.error("Gemini API error: %s", exc)
        return FALLBACK_BRIEFING


def _build_session_review_prompt(profile: Optional[dict], lang: str = "de") -> str:
    """Build system prompt specifically for session review + next session analysis."""
    p = profile or {}
    name = " ".join(filter(None, [p.get("first_name"), p.get("last_name")])) or "Athlete"
    goal = (p.get("goal") or "general fitness").replace("_", " ")
    sex = p.get("sex", "")
    height = p.get("body_height_cm")
    current_weight = p.get("current_weight_kg")
    dob = p.get("date_of_birth", "")

    context_lines: list[str] = [f"The user's name is **{name}**."]
    if sex:
        context_lines.append(f"Sex: {sex}.")
    if dob:
        context_lines.append(f"Date of birth: {dob}.")
    if height:
        context_lines.append(f"Height: {height} cm.")
    if current_weight:
        context_lines.append(f"Current weight: {current_weight} kg.")
    context_lines.append(f"Goal: **{goal}**.")

    user_context = "\n".join(context_lines)

    today_str = date.today().isoformat()

    base_prompt = f"""You are a supportive, friendly fitness coach. Your name is Coach.

=== TODAY'S DATE ===
Today is {today_str}.

=== USER PROFILE ===
{user_context}

=== IMPORTANT: TEMPORAL REFERENCES ===
Nutrition data sections include the ACTUAL DATE they are from.
ALWAYS use the correct date or weekday name when referencing nutrition data.
Do NOT say "gestern" unless the data is ACTUALLY from yesterday.
Workout dates from Hevy include actual timestamps — use those to determine how many days ago a workout was.

You will receive:
1. The user's last 20 completed workouts from Hevy (exercises, sets, weights).
2. Recent nutrition data from Yazio with actual dates (may be missing).

=== ESTIMATED 1RM ===
For every exercise, calculate the Estimated 1 Rep Max using the Epley formula:
  e1rm = weight × (1 + reps / 30)
Use the BEST set (highest e1rm) from each session. This is the primary progression metric — NOT volume.
Volume (sets × reps × weight) can be misleading when rep ranges change.

=== RANK SYSTEM ===
Rank users per exercise based on their performance relative to their age, sex, height, and weight.
Use this CS2-style tier list (index 0-15, from lowest to highest):
0: Silver I, 1: Silver II, 2: Silver III, 3: Silver IV,
4: Gold Nova I, 5: Gold Nova II, 6: Gold Nova III, 7: Gold Nova Master,
8: Master Guardian I, 9: Master Guardian II, 10: Master Guardian Elite,
11: Distinguished Master Guardian, 12: Legendary Eagle, 13: Legendary Eagle Master,
14: Supreme Master First Class, 15: Global Elite.

For each rank, also provide:
- **rank_percentile**: Estimated top percentage for someone of this age/sex/bodyweight (e.g. "Top 35%").
- **rank_next**: The name of the next rank above current.
- **rank_next_target**: A concrete target (e.g. "15kg × 8" or "e1rm 85kg") the user needs to hit to reach the next rank.

=== PR DETECTION ===
For each exercise, check if the current session set a new record compared to ALL history:
- **is_pr**: true if this session has the highest e1rm or highest volume ever.
- **pr_type**: What kind of PR — "1rm" (new e1rm record), "volume" (new total volume record), "both", or "none".

=== FEEDBACK WITH CAUSALITY (Coach Tone — "Sandwich Method") ===
Your feedback MUST explain WHY performance changed, not just observe it.
Always use a supportive, motivating coach tone. Never say "declined" or "stagnated" — reframe negatively:

=== COACHING MEMORY (CRITICAL — READ THIS CAREFULLY) ===
If "WORKOUT TIPS THE USER ACTUALLY SAW" data is provided, this is the MOST IMPORTANT part of your review!
These are the EXACT targets the user received in the app before their workout.
When you say "I told you X" or "my target was X", you MUST use the numbers from "WORKOUT TIPS THE USER ACTUALLY SAW".
NEVER reference targets from "YOUR PREVIOUS COACHING" when talking about what you recommended — those are your review notes, NOT what the user saw.

You are a personal coach with MEMORY. The user expects you to remember what you said last time.

**overall_feedback MUST START with a progress check** when coaching memory is available:
- Open with 1-2 sentences directly referencing the targets and advice YOU gave last session.
- Name specific exercises + numbers from your previous coaching.
- Example opening: "Letzte Woche hab ich dir bei Bench Press 67.5kg × 8 als Ziel gesetzt — du hast 70kg × 8 geschafft! Absolut stark! 💪"
- Example opening: "Ich hatte dir geraten, beim Kreuzheben mehr Volumen zu machen — und genau das hast du umgesetzt, top!"

For EACH exercise where you have previous coaching data:
- **Target HIT or EXCEEDED**: Celebrate enthusiastically in the feedback field! Use exclamation marks, praise words (Beast mode! Stark! Mega! Respekt!). Make the user FEEL the win. ("Mein Ziel für dich war 65kg × 8 — du hast 67.5kg × 8 gedrückt! Das ist eine Steigerung von 2.5kg in einer Woche, absolut stark! 🔥")
- **Target ALMOST hit** (within 5-10%): Still praise the effort! ("Fast geschafft — ich hatte 70kg angepeilt, du bist bei 67.5kg gelandet. Das ist trotzdem Fortschritt!")
- **Target NOT hit**: Be understanding and diagnose WHY (nutrition? sleep? fatigue?). Never blame. ("Ich hatte dir 70kg als Ziel gesetzt, du bist bei 65kg geblieben — könnte am niedrigen Protein liegen, 120g ist zu wenig für dein Gewicht.")
- **Advice FOLLOWED** (e.g. you suggested tempo reps, different grip, more sets): Acknowledge it! ("Hey, du hast meinen Tipp mit den langsameren Negatives umgesetzt — super, Disziplin zahlt sich aus!")
- **Advice IGNORED**: Gently remind. ("Ich hatte dir empfohlen die Pause zwischen den Sätzen zu verlängern — probier das nächstes Mal!")

This creates a CONTINUOUS coaching relationship. The user should feel like you remember everything.

- If performance DROPPED: frame it as temporary and explain the cause. E.g.:
  "Du bist auf 12kg runter — das ist kein Muskelverlust, sondern reine leere Glykogenspeicher! Du warst 265g unter deinem Carb-Ziel. Iss deine Carbs heute und du packst nächste Woche wieder 15kg drauf!"
  
- If performance is STABLE/PLATEAU: praise their consistency. E.g.:
  "Du hältst die 30kg stabil, obwohl du im Defizit bist — das ist stark! Dein Körper verteidigt seine Kraft."

- If performance IMPROVED: celebrate it with ENERGY. E.g.:
  "Unglaublich: Du hast dich trotz Defizit gesteigert! Von 55kg auf 60kg — dein Protein von 180g zahlt sich aus! 🔥"

- If no previous coaching data: just analyze the training data with an encouraging tone.
- Always be specific with numbers. Always reference YOUR previous targets when available.

=== NEXT TARGET ===
For EVERY exercise, generate a concrete **next_target**: what the user should aim for in their next session for this exercise.
- E.g. "17.5kg × 6-8 reps" or "Stay at 50kg, aim for 4×12 before increasing" or "Deload to 40kg × 10 for recovery".
- Factor in their goal (strength: lower reps + heavier, hypertrophy: 8-12 range, endurance: 15+).
- Factor in nutrition state (deficit → conservative targets, surplus → push harder).

Your tasks:

1. **last_session**: Analyze the MOST RECENT workout (Workout 1).
   - For each exercise, search ALL 20 workouts for previous instances.
   - Build a "history" array with: date, best_set (string), e1rm (estimated 1RM from best set), volume_kg.
   - Calculate trend: "up" if e1rm improving, "down" if declining, "stable" if similar, "new" if first time.
   - Assign a CS2 rank with percentile and next-rank info.
   - Detect PRs.
   - Give coaching feedback WITH causality (connect to nutrition).
   - Generate a next_target.
   - Give an overall session summary (2-3 sentences).

2. **next_session**: Based on recovery analysis, suggest what the next session should focus on and why.

Keep feedback supportive, short, and actionable.

You MUST respond with valid JSON matching this exact schema:
{{
  "last_session": {{
    "title": "<string, name of the most recent workout>",
    "date": "<string, date of the workout>",
    "duration_min": <int or null>,
    "overall_feedback": "<string, 2-3 sentences. If coaching memory exists: MUST open with progress check referencing YOUR previous targets/advice and whether they were achieved. Then mention PRs. Be enthusiastic about wins!>",
    "exercises": [
      {{
        "name": "<string>",
        "muscle_group": "<string>",
        "best_set": "<string, e.g. '80kg × 8'>",
        "total_volume_kg": <number>,
        "estimated_1rm": <number, calculated via Epley from best set>,
        "rank": "<string, CS2 rank name>",
        "rank_index": <int, 0-15>,
        "rank_percentile": "<string, e.g. 'Top 40%'>",
        "rank_next": "<string, next rank name or 'MAX' if Global Elite>",
        "rank_next_target": "<string, what they need to hit for next rank, e.g. '20kg × 8'>",
        "trend": "<'up' | 'down' | 'stable' | 'new'>",
        "is_pr": <boolean>,
        "pr_type": "<'1rm' | 'volume' | 'both' | 'none'>",
        "history": [
          {{ "date": "<string>", "best_set": "<string>", "e1rm": <number>, "volume_kg": <number> }}
        ],
        "feedback": "<string, 1-2 sentences with causality — WHY did performance change?>",
        "next_target": "<string, concrete target for next session>"
      }}
    ]
  }},
  "next_session": {{
    "title": "<string, suggested workout name/focus>",
    "reasoning": "<string, 2-3 sentences>",
    "focus_muscles": ["<string>"],
    "suggested_exercises": ["<string>"]
  }}
}}

Respond ONLY with the JSON object. No markdown, no explanation."""
    return base_prompt + _language_instruction(lang)


async def generate_session_review(
    yazio_data: Optional[dict],
    hevy_data: Optional[list],
    language: str = "de",
    previous_reviews: Optional[list[dict]] = None,
    previous_tips: Optional[list[dict]] = None,
    today_nutrition: Optional[dict] = None,
) -> dict:
    """
    Call Gemini to generate a detailed session review + next session suggestion.
    When previous_reviews is provided (up to 3), Gemini receives its own past coaching
    outputs for the same workout name, enabling deep continuity ("Coach Memory").
    previous_tips contains the workout tips the user ACTUALLY saw — these are the
    authoritative source for "what Coach recommended".
    """
    client = genai.Client(api_key=settings.gemini_api_key)

    profile = yazio_data.get("profile") if yazio_data else None
    system_prompt = _build_session_review_prompt(profile, lang=language)
    user_message = _build_user_message(yazio_data, hevy_data, today_nutrition=today_nutrition)  # Include nutrition for causality

    # ── Coach Memory: append previous tips (what user actually saw) + reviews ──
    if previous_tips:
        user_message += _format_coaching_memory(previous_tips, memory_type="workout_tips_for_review")
    if previous_reviews:
        user_message += _format_coaching_memory(previous_reviews, memory_type="session_review")

    try:
        response = await client.aio.models.generate_content(
            model="gemini-3.6-flash",
            contents=user_message,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.2,
                max_output_tokens=8192,
                response_mime_type="application/json",
            ),
        )

        raw_content = response.text
        if not raw_content:
            logger.error("Gemini returned empty content for session review")
            return FALLBACK_SESSION_REVIEW

        cleaned = re.sub(r"^```(?:json)?\s*", "", raw_content.strip())
        cleaned = re.sub(r"\s*```$", "", cleaned)

        parsed = json.loads(cleaned)

        # Validate last_session
        ls = parsed.get("last_session")
        if isinstance(ls, dict):
            for ex in ls.get("exercises", []):
                if "rank_index" in ex:
                    ex["rank_index"] = max(0, min(15, int(ex["rank_index"])))
                if "history" not in ex:
                    ex["history"] = []
                # Ensure new fields have defaults
                if "estimated_1rm" not in ex:
                    ex["estimated_1rm"] = 0
                if "rank_percentile" not in ex:
                    ex["rank_percentile"] = ""
                if "rank_next" not in ex:
                    ex["rank_next"] = ""
                if "rank_next_target" not in ex:
                    ex["rank_next_target"] = ""
                if "is_pr" not in ex:
                    ex["is_pr"] = False
                if "pr_type" not in ex:
                    ex["pr_type"] = "none"
                if "next_target" not in ex:
                    ex["next_target"] = ""
        else:
            parsed["last_session"] = None

        if "next_session" not in parsed:
            parsed["next_session"] = None

        return parsed

    except json.JSONDecodeError as exc:
        logger.error("Failed to parse session review JSON: %s — raw: %s", exc, raw_content[:500])
        return FALLBACK_SESSION_REVIEW
    except Exception as exc:
        logger.error("Gemini API error (session review): %s", exc)
        return FALLBACK_SESSION_REVIEW


# ════════════════════════════════════════════════════════
#  EXERCISE PROGRESSION ANALYSIS (Evidence-Based)
# ════════════════════════════════════════════════════════

def _parse_available_weights(notes: str) -> list[float]:
    """Parse an explicitly labelled list of permitted exercise weights from notes."""
    if not notes:
        return []

    # Never infer load options from arbitrary numbers: notes can also contain dates,
    # rep targets, tempo cues, or machine-seat settings. A list must be explicitly
    # labelled, for example: "Gewichte: 5, 12, 19" or "only 5 12 19".
    match = re.search(
        r"(?:available\s+weights?|verf[uü]gbare\s+gewichte|gewichte|only)\s*[:=]?\s*"
        r"((?:\d+(?:[.,]\d+)?[\s,;/]*){2,})",
        notes,
        flags=re.IGNORECASE,
    )
    if not match:
        return []

    values = [float(value.replace(",", ".")) for value in re.findall(r"\d+(?:[.,]\d+)?", match.group(1))]
    return sorted(set(values))


def _find_next_weight(current: float, available: list[float]) -> Optional[float]:
    """Return the smallest explicitly permitted load above the current load."""
    return next((weight for weight in available if weight > current + 0.1), None)


def _get_rep_range(exercise_name: str, muscle_group: str = "") -> tuple[int, int]:
    """Choose a practical hypertrophy rep range from the exercise name/equipment."""
    name = exercise_name.lower()
    isolation_keywords = (
        "curl", "extension", "raise", "fly", "flye", "lateral", "straight arm",
        "pullover", "leg curl", "leg extension", "abduction", "adduction", "calf",
        "triceps", "biceps",
    )
    heavy_compound_keywords = (
        "barbell bench", "bench press", "squat", "deadlift", "overhead press", "ohp",
        "pull-up", "pullup", "chin-up", "chinup", "dip", "barbell row", "hip thrust",
        "bankdrücken", "kniebeuge", "kreuzheben",
    )
    machine_or_cable_keywords = (
        "cable", "machine", "maschinen", "pulldown", "row", "rudern", "leg press",
        "chest press", "shoulder press",
    )

    if any(keyword in name for keyword in isolation_keywords):
        return (10, 20)
    if any(keyword in name for keyword in heavy_compound_keywords):
        return (6, 10)
    if any(keyword in name for keyword in machine_or_cable_keywords):
        return (8, 15)

    compound_groups = {"chest", "back", "legs", "quadriceps", "hamstrings", "glutes", "full body"}
    if muscle_group.lower() in compound_groups:
        return (6, 12)
    return (8, 12)


def _compute_exercise_progression(
    matching_sessions: list[dict],
    template_exercises: list[dict],
) -> dict:
    """Pre-compute conservative, exercise-aware double-progression signals."""
    analysis = {}

    for tex in template_exercises:
        ex_name = tex.get("title", "").strip()
        ex_key = ex_name.lower()
        muscle_group = tex.get("muscle_group", "")
        min_reps, max_reps = _get_rep_range(ex_name, muscle_group)

        # Collect this exercise's data from all matching sessions (most recent first).
        sessions_data = []
        for session in matching_sessions:
            for ex in session.get("exercises", []):
                if ex.get("title", "").strip().lower() != ex_key:
                    continue

                working_sets = [
                    set_data for set_data in ex.get("sets", [])
                    if set_data.get("type", "normal") in ("normal", "working", "")
                    and set_data.get("weight_kg") is not None
                    and set_data.get("reps") is not None
                    and set_data.get("weight_kg", 0) > 0
                ]
                if working_sets:
                    top_weight = max(set_data["weight_kg"] for set_data in working_sets)
                    # Preserve the existing warm-up filter while allowing legitimate
                    # back-off work that remains close to the top load.
                    true_working = [
                        set_data for set_data in working_sets
                        if set_data["weight_kg"] >= top_weight * 0.9
                    ] or working_sets
                    sessions_data.append({
                        "date": session.get("start_time", "")[:10],
                        "sets": true_working,
                        "weight": top_weight,
                        "reps_per_set": [set_data["reps"] for set_data in true_working],
                        "total_reps": sum(set_data["reps"] for set_data in true_working),
                        "num_sets": len(true_working),
                    })
                break

        if not sessions_data:
            analysis[ex_key] = {
                "exercise_name": ex_name,
                "signal": "FIRST_SESSION",
                "suggestion": (
                    f"No matched history. Keep the template's working-set count and start "
                    f"conservatively in the {min_reps}-{max_reps} rep range."
                ),
                "rep_range": f"{min_reps}-{max_reps}",
                "sessions_count": 0,
            }
            continue

        latest = sessions_data[0]
        current_weight = latest["weight"]

        # Compare only consecutive sessions at the same load; total reps at different
        # weights cannot identify either progression or regression reliably.
        sessions_at_weight = 0
        total_reps_at_weight = []
        for session_data in sessions_data:
            if abs(session_data["weight"] - current_weight) < 0.5:
                sessions_at_weight += 1
                total_reps_at_weight.append(session_data["total_reps"])
            else:
                break

        reps_trending_up = (
            len(total_reps_at_weight) >= 2
            and total_reps_at_weight[0] > total_reps_at_weight[1]
        )
        reps_stagnated = (
            len(total_reps_at_weight) >= 3
            and all(
                abs(total_reps_at_weight[index] - total_reps_at_weight[index + 1]) <= 1
                for index in range(2)
            )
        )
        regressed = (
            len(total_reps_at_weight) >= 2
            and total_reps_at_weight[0] < total_reps_at_weight[1] - 3
        )

        latest_reps = latest["reps_per_set"]
        all_sets_at_top = all(reps >= max_reps for reps in latest_reps)
        available_weights = _parse_available_weights(tex.get("notes", ""))
        suggested_next_weight = _find_next_weight(current_weight, available_weights)

        if all_sets_at_top and suggested_next_weight is not None:
            signal = "INCREASE_WEIGHT"
            suggestion = (
                f"All working sets reached the top of the {min_reps}-{max_reps} range. "
                f"Use the next verified load: {suggested_next_weight}kg."
            )
        elif all_sets_at_top:
            signal = "KEEP_PROGRESSING"
            suggestion = (
                f"All working sets reached the top of the {min_reps}-{max_reps} range, "
                "but no verified next load is recorded. Keep the current load until the "
                "available increments are confirmed; do not invent an intermediate weight."
            )
        elif regressed:
            signal = "REGRESSED"
            suggestion = (
                f"Comparable same-load total reps dropped ({total_reps_at_weight[1]}→"
                f"{total_reps_at_weight[0]}). Keep {current_weight}kg and aim to match "
                "the prior result; do not force a heavier target."
            )
        elif reps_stagnated:
            signal = "STAGNATED"
            trend = "/".join(str(reps) for reps in total_reps_at_weight[:3])
            suggestion = (
                f"Same-load total reps have been flat across three comparable sessions "
                f"({trend}) at {current_weight}kg. Keep the load and set structure; check "
                "setup, rest and recovery before changing the exercise or adding volume."
            )
        elif reps_trending_up:
            signal = "KEEP_PROGRESSING"
            suggestion = (
                f"Progress is moving up at {current_weight}kg. Keep the load and add only "
                f"the reps you can perform cleanly within {min_reps}-{max_reps}."
            )
        else:
            signal = "KEEP_PROGRESSING"
            suggestion = (
                f"Keep {current_weight}kg and try to add a total rep when performance allows "
                f"(latest: {'/'.join(str(reps) for reps in latest_reps)}; range {min_reps}-{max_reps})."
            )

        analysis[ex_key] = {
            "exercise_name": ex_name,
            "signal": signal,
            "suggestion": suggestion,
            "rep_range": f"{min_reps}-{max_reps}",
            "current_weight_kg": current_weight,
            "sessions_at_weight": sessions_at_weight,
            "latest_reps": latest_reps,
            "total_reps_latest": latest["total_reps"],
            "total_reps_trend": total_reps_at_weight[:3],
            "first_set_reps": latest_reps[0],
            "last_set_reps": latest_reps[-1],
            "sessions_count": len(sessions_data),
            "suggested_weight_kg": suggested_next_weight if signal == "INCREASE_WEIGHT" else None,
        }

    return analysis


def _is_warmup_set(set_data: dict) -> bool:
    """Return whether the Hevy template explicitly marks a set as a warm-up."""
    return str(set_data.get("type", "")).lower() in {"warmup", "warm-up", "warm_up"}


def _build_deterministic_set_targets(
    template_exercises: list[dict],
    progression: dict,
    model_targets: list[dict],
) -> list[dict]:
    """Build safe target sets from history; Gemini supplies only concise reasoning."""
    model_by_name = {
        str(target.get("name", "")).strip().lower(): target
        for target in model_targets
        if isinstance(target, dict)
    }
    deterministic_targets = []

    for template_exercise in template_exercises:
        exercise_name = template_exercise.get("title", "").strip()
        exercise_key = exercise_name.lower()
        data = progression.get(exercise_key, {})
        min_reps, max_reps = _get_rep_range(
            exercise_name,
            template_exercise.get("muscle_group", ""),
        )
        template_sets = template_exercise.get("sets", [])
        if not template_sets:
            historical_sets = data.get("latest_reps", [])
            template_sets = [{} for _ in historical_sets]

        work_set_indices = [
            index for index, set_data in enumerate(template_sets)
            if not _is_warmup_set(set_data)
        ]
        historical_reps = data.get("latest_reps", [])
        target_reps = []
        for index, set_index in enumerate(work_set_indices):
            template_reps = template_sets[set_index].get("reps")
            source_reps = historical_reps[index] if index < len(historical_reps) else template_reps
            source_reps = source_reps if isinstance(source_reps, int) and source_reps > 0 else min_reps
            # Existing history below a newly introduced range is progressed gradually;
            # never turn an 8/7 result into an arbitrary 10/10 jump. New exercises,
            # however, start at the range minimum.
            if historical_reps:
                target_reps.append(min(max_reps, source_reps))
            else:
                target_reps.append(max(min_reps, min(max_reps, source_reps)))

        signal = data.get("signal", "FIRST_SESSION")
        if signal == "INCREASE_WEIGHT":
            target_reps = [min_reps] * len(work_set_indices)
        elif signal == "KEEP_PROGRESSING" and target_reps:
            # Progress one total repetition without imposing a particular set-to-set
            # decline. Prefer the earliest set that is still below the range ceiling.
            for index, reps in enumerate(target_reps):
                if reps < max_reps:
                    target_reps[index] += 1
                    break

        working_weight = data.get("suggested_weight_kg") if signal == "INCREASE_WEIGHT" else data.get("current_weight_kg")
        model_target = model_by_name.get(exercise_key, {})
        model_reasoning = model_target.get("reasoning") if isinstance(model_target.get("reasoning"), str) else ""
        set_targets = []
        work_index = 0
        for index, template_set in enumerate(template_sets):
            if _is_warmup_set(template_set):
                weight = template_set.get("weight_kg", 0)
                reps = template_set.get("reps") or 0
                note = "Aufwärmsatz"
            else:
                weight = working_weight
                if weight is None:
                    weight = template_set.get("weight_kg", 0)
                reps = target_reps[work_index] if work_index < len(target_reps) else min_reps
                note = "Arbeitssatz"
                work_index += 1
            set_targets.append({
                "set_number": index + 1,
                "weight_kg": weight,
                "reps": reps,
                "note": note,
            })

        deterministic_targets.append({
            "name": exercise_name,
            "progression_status": signal,
            "set_targets": set_targets,
            "reasoning": model_reasoning or data.get("suggestion", ""),
        })

    return deterministic_targets


def _build_workout_tips_prompt(profile: Optional[dict], lang: str = "de") -> str:
    """Build system prompt for forward-looking per-set workout targets."""
    p = profile or {}
    name = " ".join(filter(None, [p.get("first_name"), p.get("last_name")])) or "Athlete"
    goal = (p.get("goal") or "general fitness").replace("_", " ")
    sex = p.get("sex", "")
    height = p.get("body_height_cm")
    current_weight = p.get("current_weight_kg")
    start_weight = p.get("start_weight_kg")
    weight_change = p.get("weight_change_per_week_kg")
    activity = (p.get("activity_degree") or "").replace("_", " ")
    diet_name = (p.get("diet_name") or "").replace("_", " ")

    context_lines: list[str] = [f"The user's name is **{name}**."]
    if sex:
        context_lines.append(f"Sex: {sex}.")
    if height:
        context_lines.append(f"Height: {height} cm.")
    if current_weight:
        context_lines.append(f"Current weight: {current_weight} kg.")
    if start_weight and current_weight and abs(start_weight - current_weight) > 0.5:
        context_lines.append(f"Start weight: {start_weight} kg (change: {round(current_weight - start_weight, 1)} kg).")
    context_lines.append(f"Goal: **{goal}**.")
    if weight_change:
        context_lines.append(f"Target weight change: {weight_change} kg/week.")
    if activity:
        context_lines.append(f"Activity level: {activity}.")
    if diet_name:
        context_lines.append(f"Diet: {diet_name}.")

    user_context = "\n".join(context_lines)

    today_str = date.today().isoformat()

    base_prompt = f"""You are a supportive, friendly fitness coach. Your name is Coach.

=== TODAY'S DATE ===
Today is {today_str}.

=== USER PROFILE ===
{user_context}

=== IMPORTANT: TEMPORAL REFERENCES ===
Nutrition data sections include the ACTUAL DATE they are from.
ALWAYS use the correct date or weekday name (e.g. "am Montag", "am 28.3.") when referencing nutrition or workout data.
NEVER say "gestern" unless the date is ACTUALLY yesterday. NEVER say "heute" unless it is ACTUALLY today.
These tips may be read by the user days after generation, so use ABSOLUTE dates (e.g. "am Freitag, den 28.3.") instead of relative references like "gestern".

You will receive:
1. A WORKOUT NAME that the user plans to do next (marked with "=== PLANNED WORKOUT ===").
2. The user's recent workout history (up to 20 sessions) — use this ONLY as context to decide smart targets. Do NOT display history in the output.
3. Recent nutrition data from Yazio with actual dates (may be missing).

=== YOUR TASK ===
Give the user a CONCRETE PLAN for their next session of this workout type.
For EACH exercise, tell them EXACTLY what to do for EVERY SET: weight and reps.
This is purely FORWARD-LOOKING — you are telling them what to aim for, not reviewing what they did.

Use their history to make smart decisions, but the output must only contain TARGETS for the upcoming session.

=== COACHING RULES (Evidence-Based Hypertrophy Programming) ===

0. **Coaching Memory / Continuity**: If "YOUR PREVIOUS COACHING" data is provided, use it only to understand whether past targets were followed. The current template and the pre-computed progression analysis remain authoritative.

1. **Exercise-aware rep ranges**: Each exercise's pre-computed analysis contains its approved rep range.
   - Heavy free-weight compounds normally use 6-10, machine/cable multi-joint movements 8-15, and isolation movements 10-20. Use the range supplied for that specific exercise.
   - Same reps in multiple working sets are VALID. Never force a rep drop between sets.
   - A natural rep drop is allowed, but only prescribe it when the history supports it. Do not deliberately make later targets worse.

2. **Double progression**:
   - Keep the load constant while building repetitions within the supplied range.
   - Increase load ONLY when the pre-computed signal is INCREASE_WEIGHT AND it gives a specific verified next load.
   - A load increase is earned only after ALL comparable working sets have reached the top of that exercise's range.
   - After a verified load increase, set targets may return to the lower end of the range. Do not invent a weight increment.
   - Preserve the supplied template's number and order of sets. Never add a set just because a user has stalled.

3. **PROGRESSION ANALYSIS**: You will receive a "=== PROGRESSION ANALYSIS ===" section with deterministic signals. FOLLOW them exactly.
   - INCREASE_WEIGHT: use the exact supplied verified next load; choose targets near the lower end of the exercise range.
   - KEEP_PROGRESSING: retain the current load and target an attainable rep improvement only when it remains inside the range.
   - STAGNATED: retain the load and working-set structure. State that setup, rest, or recovery should be checked; do not automatically prescribe a deload, exercise swap, or extra volume.
   - REGRESSED: retain the load and give conservative targets to match the prior performance; do not force a heavier target.
   - FIRST_SESSION: preserve the template's set structure and start conservatively inside the supplied range.

4. **Verified loads only**:
   - The pre-computed analysis is the only authority for a new load.
   - If no verified next load is supplied, retain the current load; NEVER calculate a generic +2.5kg or +1.25kg increase.
   - If an exercise note contains an explicit available-weight list, use only values from that list. Never interpolate a value that was not listed.

5. **Exercise notes are HARD CONSTRAINTS**: Notes marked 📝 override all normal logic. Follow stated equipment limitations and technique restrictions precisely.

6. **Warm-ups and working sets**:
   - Produce targets for exactly the sets in the planned template, in its order.
   - Only mark a set as "Aufwärmsatz" when the planned template explicitly marks it as a warm-up. Do not invent warm-up sets.
   - Explicit warm-ups must be easy and must not be used to judge progression. Every unmarked planned set is a working-set target.

7. **Nutrition context is informational, not a load trigger**:
   - A single logged day, surplus, deficit, or missed calorie target must NOT directly change weights, reps, set count, or progression status.
   - Mention nutrition briefly and factually, with its absolute date if available. Do not claim it caused performance changes or prescribe aggressive overload from one day of data.

8. **No form tips or exercise descriptions**. The user knows the exercises; provide only concise programming targets.

9. **Per-set targets format**: For each exercise, give a target for EVERY planned set.
   - Each set has weight (kg), reps (an integer inside that exercise's supplied range), and an optional short note.
   - Use "Arbeitssatz" or "Topset" only when useful. Do not use motivational failure cues such as "alles geben".

You MUST respond with valid JSON matching this exact schema:
{{
  "workout_title": "<string, name of the workout>",
  "nutrition_context": "<string, 2-3 sentences: how their current nutrition phase affects these targets. Reference actual numbers if available.>",
  "exercise_targets": [
    {{
      "name": "<string, exercise name>",
      "progression_status": "<string, one of: INCREASE_WEIGHT, KEEP_PROGRESSING, STAGNATED, REGRESSED, FIRST_SESSION>",
      "set_targets": [
        {{
          "set_number": <int, 1-based>,
          "weight_kg": <number, target weight in kg — use 0 for bodyweight exercises>,
          "reps": <int, target reps FOR THIS SPECIFIC SET — remember rep drop-off across sets!>,
          "note": "<string, optional short note like 'Aufwärmsatz' or 'Topset' or '' if none>"
        }}
      ],
      "reasoning": "<string, 1-2 sentences: reference the progression signal AND explain the target. E.g. 'Total reps increased from 28→31 at 60kg. First set hit 12 and all sets ≥8 → stepping up to 62.5kg. Expect reps around 9-10.'>"
    }}
  ],
  "new_exercises_to_try": [
    {{
      "name": "<string, exercise name to try>",
      "why": "<string, ONE sentence: why this complements their current program>",
      "suggested_sets_reps": "<string, e.g. '3×10-12 @ moderate weight'>"
    }}
  ],
  "general_advice": "<string, one actionable sentence tying nutrition + training together for the upcoming session>"
}}

Respond ONLY with the JSON object. No markdown, no explanation."""
    return base_prompt + _language_instruction(lang)


async def generate_workout_tips(
    yazio_data: Optional[dict],
    hevy_data: Optional[list],
    workout_name: str,
    language: str = "de",
    previous_tips_list: Optional[list[dict]] = None,
    routine_exercises: Optional[list[dict]] = None,
) -> dict:
    """
    Call Gemini to generate forward-looking per-set targets for a workout type.
    Uses the Hevy routine template (if available) for the definitive exercise list.
    Falls back to the most recent session if no routine template is found.
    When previous_tips_list is provided (up to 3), Gemini receives its own past coaching
    outputs for the same workout name, enabling deep continuity ("Coach Memory").
    """
    if not hevy_data and not routine_exercises:
        return FALLBACK_WORKOUT_TIPS

    # Prefer the routine template's exercise list (fetched directly from Hevy routines API).
    # Fall back to the most recent matching session if no routine template was found.
    matching_sessions = [w for w in (hevy_data or []) if w.get("title", "").strip().lower() == workout_name.strip().lower()]

    if routine_exercises:
        full_template_exercises = routine_exercises
        exercise_source = "routine template"

        # Merge notes from the most recent workout session into the routine template.
        # Users write notes during training (e.g. "available weights: 57, 67 only"),
        # but these live in the workout, not the routine template.
        if matching_sessions:
            latest_session = matching_sessions[0]
            workout_notes: dict[str, str] = {}
            for ex in latest_session.get("exercises", []):
                note = ex.get("notes") or ex.get("note") or ""
                if note:
                    workout_notes[ex.get("title", "").strip().lower()] = note
            if workout_notes:
                for ex in full_template_exercises:
                    ex_key = ex.get("title", "").strip().lower()
                    if ex_key in workout_notes and not ex.get("notes"):
                        ex["notes"] = workout_notes[ex_key]
    else:
        selected = matching_sessions[0] if matching_sessions else {"title": workout_name, "exercises": [], "start_time": ""}
        full_template_exercises = selected.get("exercises", [])
        exercise_source = "most recent session"

    client = genai.Client(api_key=settings.gemini_api_key)

    profile = yazio_data.get("profile") if yazio_data else None
    system_prompt = _build_workout_tips_prompt(profile, lang=language)

    # Build user message: planned workout + history context + nutrition
    parts: list[str] = []
    parts.append(f"=== PLANNED WORKOUT (generate targets for ALL exercises listed below) ===")
    parts.append(f"Workout name: {workout_name}")
    if full_template_exercises:
        parts.append(f"Full exercise list for this workout ({len(full_template_exercises)} exercises from {exercise_source}):")
        for ex in full_template_exercises:
            sets_summary = []
            for s in ex.get("sets", []):
                weight = s.get("weight_kg")
                reps = s.get("reps")
                set_type = s.get("type", "normal")
                type_label = f" [{set_type}]" if set_type not in ("normal", "working", "") else ""
                if weight is not None and reps is not None:
                    sets_summary.append(f"{weight}kg×{reps}{type_label}")
                elif reps is not None:
                    sets_summary.append(f"{reps} reps{type_label}")
                elif s.get("duration_seconds"):
                    sets_summary.append(f"{s['duration_seconds']}s{type_label}")
            sets_str = ", ".join(sets_summary) if sets_summary else "no set data"
            muscle = f" [{ex.get('muscle_group')}]" if ex.get("muscle_group") else ""
            note_str = f"  📝 Note: {ex['notes']}" if ex.get("notes") else ""
            parts.append(f"  • {ex.get('title', '?')}{muscle}: {sets_str}{note_str}")
    parts.append("")
    parts.append("IMPORTANT: You MUST generate targets for EVERY exercise listed above. Do not skip any.")
    parts.append("IMPORTANT: If an exercise has a 📝 Note listing available weights, you MUST ONLY use weights from that exact list. Never suggest weights not in the list.")
    parts.append("")

    # Add nutrition context if available
    if yazio_data:
        totals = yazio_data.get("totals", {})
        goals = yazio_data.get("goals", {})
        cal_in = round(totals.get('calories', 0))
        prot_in = round(totals.get('protein', 0))
        carb_in = round(totals.get('carbs', 0))
        fat_in = round(totals.get('fat', 0))
        cal_goal = round(goals.get('calories', 0))
        prot_goal = round(goals.get('protein', 0))
        nutrition_date = yazio_data.get("date", (date.today() - timedelta(days=1)).isoformat())
        parts.append(f"=== NUTRITION FOR {nutrition_date} ===")
        parts.append(f"Eaten: {cal_in} kcal (P:{prot_in}g C:{carb_in}g F:{fat_in}g) | Goal: {cal_goal} kcal, P:{prot_goal}g")
        surplus_deficit = cal_in - cal_goal
        if surplus_deficit > 100:
            parts.append(f"→ Surplus ~{surplus_deficit} kcal.")
        elif surplus_deficit < -100:
            parts.append(f"→ Deficit ~{abs(surplus_deficit)} kcal.")
        else:
            parts.append("→ At maintenance.")
        parts.append("")

    # Only include sessions of the SAME workout type (max 3),
    # and filter each session to only exercises present in the current template.
    template_names = {ex.get("title", "").strip().lower() for ex in full_template_exercises} if full_template_exercises else set()
    relevant_history = matching_sessions[:3]
    if relevant_history:
        parts.append(f"=== RECENT SESSIONS OF '{workout_name}' ({len(relevant_history)} of {len(matching_sessions)} total) ===")
        for i, w in enumerate(relevant_history):
            filtered_w = dict(w)
            if template_names:
                filtered_w["exercises"] = [
                    ex for ex in w.get("exercises", [])
                    if ex.get("title", "").strip().lower() in template_names
                ]
            parts.append(f"\nSession {i + 1} ({w.get('start_time', 'unknown date')[:10]}):")
            parts.append(_format_workout(filtered_w))
    else:
        parts.append(f"=== NO PREVIOUS SESSIONS of '{workout_name}' found — first time ===")

    # ── Pre-computed Progression Analysis per exercise ──
    progression = _compute_exercise_progression(matching_sessions, full_template_exercises)
    if progression:
        parts.append("")
        parts.append("=== PROGRESSION ANALYSIS (pre-computed from workout history) ===")
        parts.append("USE these signals to guide your weight/rep targets. Do NOT ignore them.")
        parts.append("")
        for ex_key, data in progression.items():
            ex_name = data["exercise_name"]
            signal = data["signal"]
            suggestion = data["suggestion"]
            parts.append(f"📊 {ex_name}: **{signal}**")
            if data.get("current_weight_kg"):
                parts.append(f"   Current weight: {data['current_weight_kg']}kg | Sessions at this weight: {data.get('sessions_at_weight', '?')}")
            if data.get("rep_range"):
                parts.append(f"   Approved rep range: {data['rep_range']}")
            if data.get("latest_reps"):
                reps_str = "/".join(str(r) for r in data["latest_reps"])
                parts.append(f"   Latest reps per set: {reps_str} (total: {data.get('total_reps_latest', '?')})")
            if data.get("total_reps_trend") and len(data["total_reps_trend"]) > 1:
                trend_str = " → ".join(str(r) for r in reversed(data["total_reps_trend"]))
                parts.append(f"   Total reps trend (oldest→newest): {trend_str}")
            if data.get("suggested_weight_kg"):
                parts.append(f"   ➡️ Suggested next weight: {data['suggested_weight_kg']}kg")
            parts.append(f"   💡 {suggestion}")
            parts.append("")

    user_message = "\n".join(parts)

    # ── Coach Memory: append previous tips for continuity (up to 3) ──
    if previous_tips_list:
        user_message += _format_coaching_memory(previous_tips_list, memory_type="workout_tips")

    try:
        response = await client.aio.models.generate_content(
            model="gemini-3.6-flash",
            contents=user_message,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.7,
                max_output_tokens=8192,
                response_mime_type="application/json",
            ),
        )

        raw_content = response.text
        if not raw_content:
            logger.error("Gemini returned empty content for workout tips")
            return FALLBACK_WORKOUT_TIPS

        cleaned = re.sub(r"^```(?:json)?\s*", "", raw_content.strip())
        cleaned = re.sub(r"\s*```$", "", cleaned)

        parsed = json.loads(cleaned)

        # Ensure arrays exist
        if "exercise_targets" not in parsed:
            parsed["exercise_targets"] = []
        if "new_exercises_to_try" not in parsed:
            parsed["new_exercises_to_try"] = []

        # Targets are calculated server-side from the template and deterministic
        # progression data. Gemini may explain the targets, but it cannot invent
        # exercises, set counts, weights, or rep prescriptions.
        parsed["exercise_targets"] = _build_deterministic_set_targets(
            full_template_exercises,
            progression,
            parsed["exercise_targets"],
        )

        return parsed

    except json.JSONDecodeError as exc:
        logger.error("Failed to parse workout tips JSON: %s — raw: %s", exc, raw_content[:500])
        return FALLBACK_WORKOUT_TIPS
    except Exception as exc:
        logger.error("Gemini API error (workout tips): %s", exc)
        return FALLBACK_WORKOUT_TIPS


def _format_coaching_memory(previous_data_list: list[dict], memory_type: str = "session_review") -> str:
    """
    Format previous AI coaching outputs as context for the next session.
    Most recent session gets FULL detail; older sessions are ultra-compact (one line per exercise).
    """
    count = len(previous_data_list)

    if memory_type == "workout_tips_for_review":
        # Special section: the actual targets the user saw in the app
        parts: list[str] = [f"\n\n=== WORKOUT TIPS THE USER ACTUALLY SAW ({count} session{'s' if count != 1 else ''}) ==="]
        parts.append("⚠️ THESE are the targets the user received in the app. Use ONLY these when checking if they followed your advice.\n")
        for idx, tips_data in enumerate(previous_data_list):
            label = "Most recent tips" if idx == 0 else f"{idx + 1} sessions ago"
            parts.append(f"--- {label} ---")
            for et in tips_data.get("exercise_targets", []):
                set_targets = et.get("set_targets", [])
                sets_str = ", ".join(
                    f"{s.get('weight_kg', '?')}kg×{s.get('reps', '?')}"
                    for s in set_targets
                )
                parts.append(f"  • {et.get('name', '?')}: [{sets_str}]")
            parts.append("")
        return "\n".join(parts)

    parts: list[str] = [f"\n\n=== YOUR PREVIOUS COACHING ({count} session{'s' if count != 1 else ''}) ==="]
    parts.append("(Reference your past targets. Praise if followed, adjust if not.)\n")

    for idx, previous_data in enumerate(previous_data_list):
        is_most_recent = (idx == 0)
        label = "Last coaching" if is_most_recent else f"{idx + 1} sessions ago"
        parts.append(f"--- {label} ---")

        if memory_type == "session_review":
            ls = previous_data.get("last_session")
            if isinstance(ls, dict):
                if is_most_recent:
                    parts.append(f"Workout: {ls.get('title', '?')} on {ls.get('date', '?')}")
                    parts.append(f"Your feedback: {ls.get('overall_feedback', '')}")
                    for ex in ls.get("exercises", []):
                        parts.append(f"  • {ex.get('name', '?')}: best={ex.get('best_set', '?')}, "
                                     f"e1rm={ex.get('estimated_1rm', '?')}kg, "
                                     f"you said: \"{ex.get('feedback', '')}\" "
                                     f"target you set: \"{ex.get('next_target', '')}\"")
                else:
                    # Compact: one line per exercise
                    for ex in ls.get("exercises", []):
                        parts.append(f"  {ex.get('name', '?')}: target=\"{ex.get('next_target', '')}\", best={ex.get('best_set', '?')}")

        elif memory_type == "workout_tips":
            if is_most_recent:
                # Full detail for the most recent coaching
                for et in previous_data.get("exercise_targets", []):
                    set_targets = et.get("set_targets", [])
                    sets_str = ", ".join(
                        f"{s.get('weight_kg', '?')}kg×{s.get('reps', '?')}"
                        for s in set_targets
                    )
                    parts.append(f"  • {et.get('name', '?')}: [{sets_str}] — {et.get('reasoning', '')}")
                if previous_data.get("general_advice"):
                    parts.append(f"  Advice: {previous_data['general_advice']}")
            else:
                # Ultra-compact: one line per exercise, targets only
                for et in previous_data.get("exercise_targets", []):
                    set_targets = et.get("set_targets", [])
                    top_sets = [s for s in set_targets if s.get("note", "").lower() not in ("aufwärmsatz", "warmup", "")]
                    if not top_sets:
                        top_sets = set_targets[-2:] if len(set_targets) >= 2 else set_targets
                    compact = ", ".join(f"{s.get('weight_kg')}kg×{s.get('reps')}" for s in top_sets)
                    parts.append(f"  {et.get('name', '?')}: {compact}")
        parts.append("")

    return "\n".join(parts)


def _format_workout(w: dict) -> str:
    """Format a single workout dict into a readable string for the AI."""
    dur = f" ({w['duration_min']} min)" if w.get("duration_min") else ""
    lines = [f"{w.get('title', 'Untitled')}{dur} — {w.get('start_time', '?')}"]
    for ex in w.get("exercises", []):
        sets_summary = []
        for s in ex.get("sets", []):
            weight = s.get("weight_kg")
            reps = s.get("reps")
            if weight is not None and reps is not None:
                sets_summary.append(f"{weight}kg×{reps}")
            elif reps is not None:
                sets_summary.append(f"{reps} reps")
            elif s.get("duration_seconds"):
                sets_summary.append(f"{s['duration_seconds']}s")
        sets_str = ", ".join(sets_summary) if sets_summary else "no set data"
        muscle = f" [{ex.get('muscle_group')}]" if ex.get("muscle_group") else ""
        note_str = f"  📝 Note: {ex['notes']}" if ex.get("notes") else ""
        lines.append(f"  • {ex.get('title', '?')}{muscle}: {sets_str}{note_str}")
    return "\n".join(lines)


# ════════════════════════════════════════════════════════
#  AI CHAT — conversational coaching assistant
# ════════════════════════════════════════════════════════

def _build_chat_system_prompt(
    profile: Optional[dict],
    training_plan_enriched: Optional[list[dict]] = None,
    lang: str = "de",
) -> str:
    """Build the system prompt for the conversational Coach Chat.

    training_plan_enriched: list of {"name": str, "exercises": [str, ...]}
    """
    p = profile or {}
    name = " ".join(filter(None, [p.get("first_name"), p.get("last_name")])) or "Athlete"
    goal = (p.get("goal") or "general fitness").replace("_", " ")
    sex = p.get("sex", "")
    height = p.get("body_height_cm")
    current_weight = p.get("current_weight_kg")
    activity = (p.get("activity_degree") or "").replace("_", " ")
    diet_name = (p.get("diet_name") or "").replace("_", " ")

    context_lines: list[str] = [f"The user's name is **{name}**."]
    if sex:
        context_lines.append(f"Sex: {sex}.")
    if height:
        context_lines.append(f"Height: {height} cm.")
    if current_weight:
        context_lines.append(f"Current weight: {current_weight} kg.")
    context_lines.append(f"Goal: **{goal}**.")
    if activity:
        context_lines.append(f"Activity level: {activity}.")
    if diet_name:
        context_lines.append(f"Diet: {diet_name}.")

    plan_str = ""
    if training_plan_enriched:
        plan_lines = []
        for wp in training_plan_enriched:
            exercises = ", ".join(wp["exercises"]) if wp.get("exercises") else "(no exercise data yet)"
            plan_lines.append(f"  • {wp['name']}: {exercises}")
        plan_str = (
            "\n\n=== CURRENT TRAINING PLAN ===\n"
            "The user's active training plan:\n"
            + "\n".join(plan_lines) + "\n"
            "Use this plan to give advice that fits their overall program structure."
        )

    user_context = "\n".join(context_lines)
    today_str = date.today().isoformat()

    prompt = f"""You are a sharp, direct personal fitness coach. Your name is Forge.

You are not a friendly chatbot — you are a coach who has been watching this athlete's data closely and knows their patterns. You speak like a real coach: confident, brief, and specific. You cut to the chase.

=== TODAY'S DATE ===
Today is {today_str}.

=== USER PROFILE ===
{user_context}
{plan_str}

=== TEMPORAL REFERENCES ===
Nutrition data includes the ACTUAL DATE. Use the correct date or weekday name.
Never say "gestern" unless the data is actually from yesterday. Never say "heute" unless the data is from today.

You will receive:
1. The user's training plan (with exercises) and recent workout data from Hevy.
2. Recent nutrition data from Yazio WITH ACTUAL DATES.
3. Conversation history.

=== YOUR COACHING PHILOSOPHY ===
- You know the user's numbers cold: their lifts, their macros, their trends.
- When they ask a question, answer it with specifics from THEIR data. Not generic advice.
- If something is off (low protein, stalled lift, bad sleep pattern), call it out directly but without drama.
- Celebrate real wins — a PR, hitting macros for a week, consistency. Make it feel earned.
- Don't pad responses with filler. Every sentence should deliver value.
- If you don't have enough data to give a real answer, say so honestly.

=== HOW TO TALK ===
- Use the user's first name occasionally, not every sentence.
- Short answers for simple questions. Detailed breakdowns only when asked.
- No greetings after the first message — just answer.
- No "Great question!" or "Of course!" — get straight to the point.
- Markdown is fine (bold, lists) when it helps clarity.
- Do NOT give medical advice. Direct to a doctor if relevant.

The goal: every reply should feel like it came from someone who actually knows this athlete and cares about their progress — not a customer service bot."""

    return prompt + _language_instruction(lang)


async def generate_chat_response(
    message: str,
    conversation_history: list[dict],
    yazio_data: Optional[dict],
    hevy_data: Optional[list],
    training_plan_enriched: Optional[list[dict]] = None,
    language: str = "de",
    today_nutrition: Optional[dict] = None,
    day_before_yesterday_nutrition: Optional[dict] = None,
) -> str:
    """
    Generate a conversational AI coach response.
    conversation_history: list of {role: 'user'|'assistant', content: str}
    training_plan_enriched: list of {"name": str, "exercises": [str, ...]}
    """
    client = genai.Client(api_key=settings.gemini_api_key)

    profile = yazio_data.get("profile") if yazio_data else None
    system_prompt = _build_chat_system_prompt(profile, training_plan_enriched, lang=language)

    # Build context message with workout + nutrition data
    context_parts: list[str] = []

    if hevy_data:
        # Limit to last 3 sessions to keep context focused
        recent = hevy_data[:3]
        context_parts.append(f"=== USER'S LAST {len(recent)} WORKOUTS ===")
        for i, w in enumerate(recent):
            context_parts.append(f"\nWorkout {i + 1}:")
            context_parts.append(_format_workout(w))

    if yazio_data:
        totals = yazio_data.get("totals", {})
        goals = yazio_data.get("goals", {})
        nutrition_date = yazio_data.get("date", (date.today() - timedelta(days=1)).isoformat())
        context_parts.append(f"\n=== NUTRITION FOR {nutrition_date} ===")
        context_parts.append(f"Consumed: {totals.get('calories', 0)} kcal | "
                             f"P: {totals.get('protein', 0)}g | "
                             f"C: {totals.get('carbs', 0)}g | "
                             f"F: {totals.get('fat', 0)}g | "
                             f"Sugar: {totals.get('sugar', 0)}g | "
                             f"Fiber: {totals.get('fiber', 0)}g | "
                             f"Sat. Fat: {totals.get('saturated', 0)}g | "
                             f"Salt: {totals.get('salt', 0)}g")
        context_parts.append(f"Goals (DAILY TARGET): {goals.get('calories', 0)} kcal | "
                             f"P: {goals.get('protein', 0)}g | "
                             f"C: {goals.get('carbs', 0)}g | "
                             f"F: {goals.get('fat', 0)}g")
        # Include individual food items
        y_food = yazio_data.get("food_items", {})
        if y_food:
            context_parts.append(f"Meals for {nutrition_date} (individual items):")
            for meal_key in ["breakfast", "lunch", "dinner", "snack"]:
                items = y_food.get(meal_key, [])
                if items:
                    meal_label = meal_key.capitalize()
                    item_strs = [f"  - {fi['name']}" + (f" ({fi['brand']})" if fi.get('brand') else "") +
                                 f" {fi['amount']}g: {fi['calories']} kcal, P:{fi['protein']}g, C:{fi['carbs']}g, F:{fi['fat']}g"
                                 for fi in items]
                    context_parts.append(f"  {meal_label}:")
                    context_parts.extend(item_strs)

    # ── Day before yesterday's nutrition ──────────────
    if day_before_yesterday_nutrition:
        dby_totals = day_before_yesterday_nutrition.get("totals", {})
        dby_goals = day_before_yesterday_nutrition.get("goals", {})
        dby_date = day_before_yesterday_nutrition.get("date", (date.today() - timedelta(days=2)).isoformat())
        context_parts.append(f"\n=== NUTRITION FOR {dby_date} ===")
        context_parts.append(f"Consumed: {dby_totals.get('calories', 0)} kcal | "
                             f"P: {dby_totals.get('protein', 0)}g | "
                             f"C: {dby_totals.get('carbs', 0)}g | "
                             f"F: {dby_totals.get('fat', 0)}g | "
                             f"Sugar: {dby_totals.get('sugar', 0)}g | "
                             f"Fiber: {dby_totals.get('fiber', 0)}g | "
                             f"Sat. Fat: {dby_totals.get('saturated', 0)}g | "
                             f"Salt: {dby_totals.get('salt', 0)}g")
        context_parts.append(f"Goals (DAILY TARGET): {dby_goals.get('calories', 0)} kcal | "
                             f"P: {dby_goals.get('protein', 0)}g | "
                             f"C: {dby_goals.get('carbs', 0)}g | "
                             f"F: {dby_goals.get('fat', 0)}g")
        # Include individual food items
        dby_food = day_before_yesterday_nutrition.get("food_items", {})
        if dby_food:
            context_parts.append(f"Meals for {dby_date} (individual items):")
            for meal_key in ["breakfast", "lunch", "dinner", "snack"]:
                items = dby_food.get(meal_key, [])
                if items:
                    meal_label = meal_key.capitalize()
                    item_strs = [f"  - {fi['name']}" + (f" ({fi['brand']})" if fi.get('brand') else "") +
                                 f" {fi['amount']}g: {fi['calories']} kcal, P:{fi['protein']}g, C:{fi['carbs']}g, F:{fi['fat']}g"
                                 for fi in items]
                    context_parts.append(f"  {meal_label}:")
                    context_parts.extend(item_strs)

    if today_nutrition:
        t_totals = today_nutrition.get("totals", {})
        t_goals = today_nutrition.get("goals", {})
        today_date = today_nutrition.get("date", date.today().isoformat())
        context_parts.append(f"\n=== NUTRITION FOR {today_date} SO FAR (live data) ===")
        context_parts.append(f"Eaten so far: {t_totals.get('calories', 0)} kcal | "
                             f"P: {t_totals.get('protein', 0)}g | "
                             f"C: {t_totals.get('carbs', 0)}g | "
                             f"F: {t_totals.get('fat', 0)}g | "
                             f"Sugar: {t_totals.get('sugar', 0)}g | "
                             f"Fiber: {t_totals.get('fiber', 0)}g | "
                             f"Sat. Fat: {t_totals.get('saturated', 0)}g | "
                             f"Salt: {t_totals.get('salt', 0)}g")
        context_parts.append(f"Today's Goals (DAILY TARGET): {t_goals.get('calories', 0)} kcal | "
                             f"P: {t_goals.get('protein', 0)}g | "
                             f"C: {t_goals.get('carbs', 0)}g | "
                             f"F: {t_goals.get('fat', 0)}g")
        remaining_cal = t_goals.get('calories', 0) - t_totals.get('calories', 0)
        remaining_protein = t_goals.get('protein', 0) - t_totals.get('protein', 0)
        context_parts.append(f"Remaining today: {max(0, remaining_cal):.0f} kcal | "
                             f"P: {max(0, remaining_protein):.0f}g")
        # Include individual food items from today
        t_food = today_nutrition.get("food_items", {})
        if t_food:
            context_parts.append(f"Meals for {today_date} (individual items):")
            for meal_key in ["breakfast", "lunch", "dinner", "snack"]:
                items = t_food.get(meal_key, [])
                if items:
                    meal_label = meal_key.capitalize()
                    item_strs = [f"  - {fi['name']}" + (f" ({fi['brand']})" if fi.get('brand') else "") +
                                 f" {fi['amount']}g: {fi['calories']} kcal, P:{fi['protein']}g, C:{fi['carbs']}g, F:{fi['fat']}g"
                                 for fi in items]
                    context_parts.append(f"  {meal_label}:")
                    context_parts.extend(item_strs)

    # Build Gemini conversation with context as first user message
    contents: list[types.Content] = []

    # Inject context as the first "user" turn (invisible to the actual conversation)
    if context_parts:
        contents.append(types.Content(
            role="user",
            parts=[types.Part(text="[CONTEXT DATA — do not repeat this to the user]\n" + "\n".join(context_parts))],
        ))
        contents.append(types.Content(
            role="model",
            parts=[types.Part(text="Got it — I have the user's workout and nutrition data ready. What's up?")],
        ))

    # Add conversation history
    for msg in conversation_history:
        role = "model" if msg["role"] == "assistant" else "user"
        contents.append(types.Content(
            role=role,
            parts=[types.Part(text=msg["content"])],
        ))

    # Add the new message
    contents.append(types.Content(
        role="user",
        parts=[types.Part(text=message)],
    ))

    try:
        response = await client.aio.models.generate_content(
            model="gemini-3.6-flash",
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.7,
                max_output_tokens=8192,
            ),
        )

        text = response.text
        if not text:
            logger.error("Gemini returned empty chat response")
            return "Sorry, I couldn't generate a response. Please try again."

        return text.strip()

    except Exception as exc:
        logger.error("Gemini chat error: %s", exc)
        return "Sorry, something went wrong. Please try again in a moment."


async def generate_nutrition_analysis(
    yazio_yesterday: Optional[dict],
    yazio_today: Optional[dict],
    language: str = "de",
) -> dict:
    """
    Generate a comprehensive AI nutrition analysis covering yesterday, today, goals, and recommendations.
    """
    client = genai.Client(api_key=settings.gemini_api_key)

    # Build context
    context_parts = []

    if yazio_yesterday:
        totals = yazio_yesterday.get("totals", {})
        goals = yazio_yesterday.get("goals", {})
        yesterday_date = yazio_yesterday.get("date", (date.today() - timedelta(days=1)).isoformat())
        context_parts.append(f"=== ERNÄHRUNG FÜR {yesterday_date} ===")
        context_parts.append(f"Gegessen: {totals.get('calories', 0):.0f} kcal (Ziel: {goals.get('calories', 0):.0f} kcal)")
        context_parts.append(f"Protein: {totals.get('protein', 0):.0f}g (Ziel: {goals.get('protein', 0):.0f}g)")
        context_parts.append(f"Kohlenhydrate: {totals.get('carbs', 0):.0f}g (Ziel: {goals.get('carbs', 0):.0f}g)")
        context_parts.append(f"Fett: {totals.get('fat', 0):.0f}g (Ziel: {goals.get('fat', 0):.0f}g)")
        context_parts.append(f"Zucker: {totals.get('sugar', 0):.0f}g | Ballaststoffe: {totals.get('fiber', 0):.0f}g | "
                             f"Gesättigte Fettsäuren: {totals.get('saturated', 0):.0f}g | Salz: {totals.get('salt', 0):.1f}g")

        y_food = yazio_yesterday.get("food_items", {})
        if y_food:
            context_parts.append(f"\nGegessen am {yesterday_date}:")
            for meal_key in ["breakfast", "lunch", "dinner", "snack"]:
                items = y_food.get(meal_key, [])
                if items:
                    meal_names = {"breakfast": "Frühstück", "lunch": "Mittagessen", "dinner": "Abendessen", "snack": "Snacks"}
                    context_parts.append(f"  {meal_names.get(meal_key, meal_key)}:")
                    for fi in items[:10]:  # Limit to 10 items per meal
                        context_parts.append(f"    - {fi['name']} ({fi['amount']:.0f}g): "
                                             f"{fi['calories']:.0f} kcal, P:{fi['protein']:.0f}g, K:{fi.get('carbs', 0):.0f}g, F:{fi.get('fat', 0):.0f}g")

    if yazio_today:
        t_totals = yazio_today.get("totals", {})
        t_goals = yazio_today.get("goals", {})
        today_date = yazio_today.get("date", date.today().isoformat())
        context_parts.append(f"\n=== ERNÄHRUNG FÜR {today_date} (bisher) ===")
        context_parts.append(f"Bisher gegessen: {t_totals.get('calories', 0):.0f} kcal (Ziel: {t_goals.get('calories', 0):.0f} kcal)")
        context_parts.append(f"Protein: {t_totals.get('protein', 0):.0f}g (Ziel: {t_goals.get('protein', 0):.0f}g)")
        context_parts.append(f"Kohlenhydrate: {t_totals.get('carbs', 0):.0f}g (Ziel: {t_goals.get('carbs', 0):.0f}g)")
        context_parts.append(f"Fett: {t_totals.get('fat', 0):.0f}g (Ziel: {t_goals.get('fat', 0):.0f}g)")
        
        remaining_cal = max(0, t_goals.get('calories', 0) - t_totals.get('calories', 0))
        remaining_protein = max(0, t_goals.get('protein', 0) - t_totals.get('protein', 0))
        remaining_carbs = max(0, t_goals.get('carbs', 0) - t_totals.get('carbs', 0))
        remaining_fat = max(0, t_goals.get('fat', 0) - t_totals.get('fat', 0))
        context_parts.append(f"\nNoch übrig heute: {remaining_cal:.0f} kcal | P: {remaining_protein:.0f}g | K: {remaining_carbs:.0f}g | F: {remaining_fat:.0f}g")

        t_food = yazio_today.get("food_items", {})
        if t_food:
            context_parts.append(f"\nGegessen am {today_date}:")
            for meal_key in ["breakfast", "lunch", "dinner", "snack"]:
                items = t_food.get(meal_key, [])
                if items:
                    meal_names = {"breakfast": "Frühstück", "lunch": "Mittagessen", "dinner": "Abendessen", "snack": "Snacks"}
                    context_parts.append(f"  {meal_names.get(meal_key, meal_key)}:")
                    for fi in items[:10]:
                        context_parts.append(f"    - {fi['name']} ({fi['amount']:.0f}g): "
                                             f"{fi['calories']:.0f} kcal, P:{fi['protein']:.0f}g")

    lang_instruction = _language_instruction(language)

    today_str = date.today().isoformat()

    system_prompt = f"""Du bist ein erfahrener Ernährungsberater und Fitness-Coach. Analysiere die Ernährungsdaten des Nutzers und erstelle eine ausführliche, personalisierte Analyse.

Heute ist {today_str}.

WICHTIG: Die Ernährungsdaten enthalten das TATSÄCHLICHE DATUM. Verwende immer das korrekte Datum oder den Wochentag, wenn du dich auf Ernährungsdaten beziehst.
Sage NICHT "gestern" wenn die Daten nicht von gestern sind. Sage NICHT "heute" wenn die Daten nicht von heute sind.

{chr(10).join(context_parts)}

Schreibe eine AUSFÜHRLICHE Ernährungsanalyse (mindestens 200-300 Wörter) die folgendes abdeckt:

1. **Letzte Bilanz**: Wie waren die Makros im Vergleich zu den Zielen? Was war gut, was nicht optimal? Welche Lebensmittel haben positiv/negativ beigetragen?

2. **Aktuelle Situation**: Was wurde heute schon gegessen? Wie sieht die verbleibende Kalorienbilanz aus? Was fehlt noch an Makros?

3. **Konkrete Empfehlungen**: Was sollte der Nutzer heute noch essen, um seine Ziele zu erreichen? Nenne konkrete Lebensmittel oder Mahlzeiten. Wenn Protein fehlt: schlage proteinreiche Optionen vor. Wenn zu viel Fett: empfehle leichtere Alternativen.

4. **Tipps & Beobachtungen**: Gibt es Muster? Zu viel Zucker/Salz? Zu wenig Ballaststoffe? Gib praktische Tipps.

Sei motivierend aber ehrlich. Beziehe dich auf konkrete Lebensmittel aus den Daten. Schreibe in einem freundlichen, coachenden Ton.
{lang_instruction}

Antworte NUR mit einem JSON-Objekt in diesem Format (der Text muss in einer Zeile sein, keine Zeilenumbrüche im String):
{{"analysis": "Deine ausführliche Analyse hier..."}}"""

    try:
        response = await client.aio.models.generate_content(
            model="gemini-3.6-flash",
            contents=system_prompt,
            config=types.GenerateContentConfig(
                temperature=0.7,
                max_output_tokens=8192,
            ),
        )

        text = response.text
        if not text:
            return {
                "analysis": "Keine Analyse verfügbar.",
            }

        # Log raw response for debugging
        logger.info("Gemini nutrition raw response (first 1000 chars): %s", text[:1000])

        # Parse JSON - handle markdown code blocks
        text = text.strip()
        if text.startswith("```"):
            # Remove opening code block (```json or ```)
            text = re.sub(r'^```(?:json)?\s*\n?', '', text)
            # Remove closing code block
            text = re.sub(r'\n?```\s*$', '', text)
        
        # Extract the "analysis" field
        def extract_field(field_name: str, source: str) -> str:
            """Extract a JSON string field value, handling multiline and special chars."""
            pattern = rf'"{field_name}"\s*:\s*"'
            match = re.search(pattern, source)
            if not match:
                return ""
            
            start = match.end()
            result_chars = []
            i = start
            while i < len(source):
                char = source[i]
                if char == '"':
                    # Check if escaped
                    num_backslashes = 0
                    j = i - 1
                    while j >= start and source[j] == '\\':
                        num_backslashes += 1
                        j -= 1
                    if num_backslashes % 2 == 0:
                        # Not escaped, this is the closing quote
                        break
                result_chars.append(char)
                i += 1
            
            value = ''.join(result_chars)
            # Unescape common escape sequences
            value = value.replace('\\n', '\n').replace('\\r', '').replace('\\"', '"').replace('\\\\', '\\')
            # Replace actual \r with nothing
            value = value.replace('\r', '')
            return value.strip()
        
        analysis = extract_field("analysis", text)
        logger.info("Extracted analysis (first 200 chars): %s", analysis[:200] if analysis else "EMPTY")
        
        if analysis:
            return {"analysis": analysis}
        
        # Fallback: try standard JSON parse
        try:
            parsed = json.loads(text)
            return {"analysis": parsed.get("analysis", "Keine Analyse verfügbar.")}
        except json.JSONDecodeError:
            logger.warning("All JSON parsing methods failed for nutrition analysis")
            # Return raw text if nothing else works
            if len(text) > 50:
                return {"analysis": text}
            return {"analysis": "Analyse konnte nicht gelesen werden."}

    except Exception as exc:
        logger.error("Gemini nutrition analysis error: %s", exc)
        return {"analysis": "Analyse konnte nicht generiert werden."}


async def generate_forge_exercise_draft(instructions: str, language: str = "de") -> dict:
    """Generate a transient custom-exercise draft; callers must explicitly save it."""
    fallback = {
        "name": "Neue Übung" if language == "de" else "New exercise",
        "icon": "Dumbbell",
        "equipment": "other",
        "primary_muscle_group": "Other",
        "secondary_muscle_groups": [],
        "machine_profiles": [],
    }
    system_prompt = """You create ONE concise custom exercise draft for a private training app.
Return JSON only with: name, icon, equipment, primary_muscle_group, secondary_muscle_groups, machine_profiles.
Equipment MUST be exactly one of: none, barbell, dumbbell, kettlebell, machine, other.
icon is a relevant Lucide icon name such as Dumbbell, Cable, CircleDot, Activity, or Weight.
primary_muscle_group and secondary_muscle_groups use plain muscle-group names. secondary_muscle_groups is an array of at most 4 values.
machine_profiles is an array of {name, model, notes}; use it only for machine equipment and only where the user specifies or reasonably needs a machine brand/profile.
Do not claim the draft has been saved and do not include instructions outside the JSON.""" + _language_instruction(language)
    try:
        client = genai.Client(api_key=settings.gemini_api_key)
        response = await client.aio.models.generate_content(
            model="gemini-3.6-flash",
            contents=f"Create an exercise draft from this request:\n{instructions}",
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.25,
                response_mime_type="application/json",
            ),
        )
        raw_content = response.text or ""
        draft = json.loads(re.sub(r"\s*```$", "", re.sub(r"^```(?:json)?\s*", "", raw_content.strip())))
        if not isinstance(draft, dict) or not isinstance(draft.get("name"), str):
            return fallback
        draft["equipment"] = draft.get("equipment") if draft.get("equipment") in {
            "none", "barbell", "dumbbell", "kettlebell", "machine", "other"
        } else "other"
        draft["icon"] = str(draft.get("icon") or "Dumbbell")[:64]
        draft["primary_muscle_group"] = str(draft.get("primary_muscle_group") or "Other")[:64]
        draft["secondary_muscle_groups"] = [str(value)[:64] for value in draft.get("secondary_muscle_groups", [])[:4]]
        draft["machine_profiles"] = draft.get("machine_profiles", []) if draft["equipment"] == "machine" else []
        return draft
    except Exception as exc:
        logger.error("Gemini exercise draft generation failed: %s", exc)
        return fallback


async def generate_forge_plan_draft(
    instructions: str,
    exercises: list[dict],
    language: str = "de",
    goal: str = "",
) -> dict:
    """Generate a transient plan draft constrained to the caller's selected exercises."""
    allowed_ids = {str(exercise["id"]) for exercise in exercises}
    fallback = {
        "name": "Neuer Trainingsplan" if language == "de" else "New training plan",
        "description": "",
        "exercises": [
            {
                "exercise_id": str(exercise["id"]),
                "machine_profile_id": None,
                "notes": "",
                "sets": [{"set_type": "working", "current_weight_kg": None, "current_reps": 10, "coach_suggested_weight_kg": None, "coach_suggested_reps": 10, "note": ""} for _ in range(3)],
            }
            for exercise in exercises
        ],
    }
    catalog = json.dumps(exercises, ensure_ascii=False)
    system_prompt = """You create a DRAFT workout plan for a private training app. The user must explicitly save it later.
Return JSON only with: name, description, exercises.
Each exercises item MUST contain exercise_id, machine_profile_id (or null), notes, sets.
You may use ONLY exercise IDs and machine profile IDs supplied in the catalog. Never invent an ID.
Each set must contain set_type (warmup or working), current_weight_kg (number or null), current_reps (integer or null), coach_suggested_weight_kg (number or null), coach_suggested_reps (integer or null), and note.
Use conservative, hypertrophy-oriented set suggestions. Do not fabricate a user-specific load when history is absent: use null for weight and provide only sensible reps.
Do not claim the draft was saved.""" + _language_instruction(language)
    try:
        client = genai.Client(api_key=settings.gemini_api_key)
        response = await client.aio.models.generate_content(
            model="gemini-3.6-flash",
            contents=(f"User goal: {goal or 'not provided'}\nRequest: {instructions}\n"
                      f"Allowed exercise catalog: {catalog}"),
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.25,
                response_mime_type="application/json",
            ),
        )
        raw_content = response.text or ""
        draft = json.loads(re.sub(r"\s*```$", "", re.sub(r"^```(?:json)?\s*", "", raw_content.strip())))
        if not isinstance(draft, dict) or not isinstance(draft.get("exercises"), list):
            return fallback
        valid_exercises = []
        profiles_by_exercise = {
            str(exercise["id"]): {str(profile["id"]) for profile in exercise.get("machine_profiles", [])}
            for exercise in exercises
        }
        for item in draft["exercises"][:30]:
            if not isinstance(item, dict) or str(item.get("exercise_id")) not in allowed_ids:
                continue
            exercise_id = str(item["exercise_id"])
            profile_id = item.get("machine_profile_id")
            if profile_id is not None and str(profile_id) not in profiles_by_exercise[exercise_id]:
                profile_id = None
            sets = []
            for set_data in item.get("sets", [])[:12]:
                if not isinstance(set_data, dict):
                    continue
                reps = set_data.get("coach_suggested_reps")
                if not isinstance(reps, int) or not 1 <= reps <= 200:
                    reps = 10
                sets.append({
                    "set_type": "warmup" if set_data.get("set_type") == "warmup" else "working",
                    "current_weight_kg": set_data.get("current_weight_kg") if isinstance(set_data.get("current_weight_kg"), (int, float)) else None,
                    "current_reps": set_data.get("current_reps") if isinstance(set_data.get("current_reps"), int) else None,
                    "coach_suggested_weight_kg": set_data.get("coach_suggested_weight_kg") if isinstance(set_data.get("coach_suggested_weight_kg"), (int, float)) else None,
                    "coach_suggested_reps": reps,
                    "note": str(set_data.get("note") or "")[:300],
                })
            valid_exercises.append({
                "exercise_id": exercise_id,
                "machine_profile_id": str(profile_id) if profile_id else None,
                "notes": str(item.get("notes") or "")[:500],
                "sets": sets or fallback["exercises"][0]["sets"],
            })
        if not valid_exercises:
            return fallback
        return {
            "name": str(draft.get("name") or fallback["name"])[:255],
            "description": str(draft.get("description") or "")[:500],
            "exercises": valid_exercises,
        }
    except Exception as exc:
        logger.error("Gemini plan draft generation failed: %s", exc)
        return fallback


async def generate_forge_session_chat(
    message: str,
    session: dict,
    exercise_catalog: list[dict],
    history: list[dict],
    language: str = "de",
) -> dict:
    """Return session-scoped coaching text and one optional, user-confirmed action."""
    fallback = {
        "message": "Ich kann dir helfen, aber ändere die Session erst, wenn du einen konkreten Vorschlag bestätigst.",
        "action": None,
    }
    system_prompt = """You are Forge, a direct in-session lifting coach. You know only the active workout session,
its logged/planned sets, and the user's own exercise catalog. Return JSON only with {message, action}.
message must be short, specific, and in the requested language. Never claim an action already happened.
action is either null or one confirmed-by-user proposal with {type, title, payload}.
Only these action types are allowed:
- adjust_set: payload {session_set_id, target_weight_kg, target_reps}
- add_set: payload {session_exercise_id, target_weight_kg, target_reps, note}
- add_exercise: payload {exercise_id, target_reps, notes}
Use IDs that appear exactly in the supplied session or catalog. Give at most one action. Suggest an action only when it is clearly useful; otherwise return null. Do not prescribe unsafe, extreme, or invented loads.""" + _language_instruction(language)
    try:
        client = genai.Client(api_key=settings.gemini_api_key)
        contents = json.dumps({
            "user_message": message,
            "active_session": session,
            "exercise_catalog": exercise_catalog,
            "recent_chat": history[-12:],
        }, ensure_ascii=False)
        response = await client.aio.models.generate_content(
            model="gemini-3.6-flash",
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.3,
                response_mime_type="application/json",
            ),
        )
        raw_content = response.text or ""
        parsed = json.loads(re.sub(r"\s*```$", "", re.sub(r"^```(?:json)?\s*", "", raw_content.strip())))
        if not isinstance(parsed, dict) or not isinstance(parsed.get("message"), str):
            return fallback
        return {"message": parsed["message"][:4000], "action": parsed.get("action")}
    except Exception as exc:
        logger.error("Gemini session chat failed: %s", exc)
        return fallback
