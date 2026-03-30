"""
Yazio API service – fetches daily nutrition summaries.

Uses the undocumented Yazio v15 REST API.
Handles missing data gracefully (water, incomplete meals, etc.).
"""
import asyncio
import logging
from datetime import date, timedelta
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

YAZIO_BASE_URL = "https://yzapi.yazio.com/v15"
YAZIO_CLIENT_ID = "1_4hiybetvfksgw40o0sog4s884kwc840wwso8go4k8c04goo4c"
YAZIO_CLIENT_SECRET = "6rok2m65xuskgkgogw40wkkk8sw0osg84s8cggsc4woos4s8o"

MEAL_KEYS = ["breakfast", "lunch", "dinner", "snack"]

# Secondary nutrient keys we need from products (per 1 gram)
_SECONDARY_NUTRIENT_KEYS = {
    "nutrient.sugar": "sugar",
    "nutrient.dietaryfiber": "fiber",
    "nutrient.saturated": "saturated",
    "nutrient.salt": "salt",
}


async def _yazio_login(client: httpx.AsyncClient, email: str, password: str) -> Optional[str]:
    """Authenticate with Yazio and return the bearer token, or None on failure."""
    try:
        resp = await client.post(
            f"{YAZIO_BASE_URL}/oauth/token",
            json={
                "client_id": YAZIO_CLIENT_ID,
                "client_secret": YAZIO_CLIENT_SECRET,
                "username": email,
                "password": password,
                "grant_type": "password",
            },
        )
        if resp.status_code != 200:
            logger.warning("Yazio login failed (HTTP %s): %s", resp.status_code, resp.text[:200])
            return None
        return resp.json().get("access_token")
    except Exception as exc:
        logger.error("Yazio login error: %s", exc)
        return None


async def _fetch_daily_summary(client: httpx.AsyncClient, token: str, target_date: str) -> Optional[dict]:
    """Fetch the Yazio daily-summary widget for a given date string (YYYY-MM-DD)."""
    try:
        resp = await client.get(
            f"{YAZIO_BASE_URL}/user/widgets/daily-summary",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            params={"date": target_date},
        )
        if resp.status_code != 200:
            logger.warning("Yazio daily-summary failed (HTTP %s)", resp.status_code)
            return None
        return resp.json()
    except Exception as exc:
        logger.error("Yazio daily-summary error: %s", exc)
        return None


async def _fetch_user_profile(client: httpx.AsyncClient, token: str) -> Optional[dict]:
    """Fetch the full Yazio user profile (/v15/user)."""
    try:
        resp = await client.get(
            f"{YAZIO_BASE_URL}/user",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
        if resp.status_code != 200:
            logger.warning("Yazio user profile failed (HTTP %s)", resp.status_code)
            return None
        return resp.json()
    except Exception as exc:
        logger.error("Yazio user profile error: %s", exc)
        return None


async def _fetch_consumed_items(client: httpx.AsyncClient, token: str, target_date: str) -> list[dict]:
    """Fetch all consumed items for a date. Each item has product_id, amount, daytime.
    
    The API returns {"products": [...], "recipe_portions": [...], "simple_products": [...]}.
    We extract the 'products' list.
    """
    try:
        resp = await client.get(
            f"{YAZIO_BASE_URL}/user/consumed-items",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            params={"date": target_date},
        )
        if resp.status_code != 200:
            logger.warning("Yazio consumed-items failed (HTTP %s)", resp.status_code)
            return []
        data = resp.json()
        if isinstance(data, dict):
            return data.get("products", [])
        return []
    except Exception as exc:
        logger.error("Yazio consumed-items error: %s", exc)
        return []


async def _fetch_product(
    client: httpx.AsyncClient, token: str, product_id: str, cache: dict
) -> Optional[dict]:
    """Fetch a product's nutrient data. Uses a cache dict to avoid duplicate requests."""
    if product_id in cache:
        return cache[product_id]
    try:
        resp = await client.get(
            f"{YAZIO_BASE_URL}/products/{product_id}",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
        if resp.status_code != 200:
            cache[product_id] = None
            return None
        data = resp.json()
        cache[product_id] = data
        return data
    except Exception as exc:
        logger.error("Yazio product fetch error for %s: %s", product_id, exc)
        cache[product_id] = None
        return None


async def _compute_secondary_macros(
    client: httpx.AsyncClient, token: str, target_date: str
) -> tuple[dict[str, dict[str, float]], dict[str, list[dict]]]:
    """
    Fetch consumed-items for a date, resolve each product, and compute
    secondary macros (sugar, fiber, saturated fat, salt) per meal.

    Returns a tuple of:
      1) meal_macros: dict keyed by meal name with secondary macro values
      2) food_items: dict keyed by meal name with list of food item dicts
         e.g. {"breakfast": [{"name": "Milk", "amount": 200, "serving": "ml", "calories": 130, ...}]}
    """
    items = await _fetch_consumed_items(client, token, target_date)
    if not items:
        return {}, {}

    product_cache: dict[str, Optional[dict]] = {}

    # Collect unique product IDs
    product_ids = {item.get("product_id") for item in items if item.get("product_id")}

    # Fetch products concurrently (limit concurrency)
    semaphore = asyncio.Semaphore(5)

    async def fetch_with_sem(pid: str):
        async with semaphore:
            await _fetch_product(client, token, pid, product_cache)

    await asyncio.gather(*[fetch_with_sem(pid) for pid in product_ids])

    # Now compute secondary macros per meal and collect food items
    meal_macros: dict[str, dict[str, float]] = {}
    food_items: dict[str, list[dict]] = {}
    for key in MEAL_KEYS:
        meal_macros[key] = {"sugar": 0.0, "fiber": 0.0, "saturated": 0.0, "salt": 0.0}
        food_items[key] = []

    for item in items:
        product_id = item.get("product_id")
        amount = item.get("amount", 0)  # in grams
        daytime = item.get("daytime", "snack")  # string: breakfast/lunch/dinner/snack
        meal_key = daytime if daytime in MEAL_KEYS else "snack"

        product = product_cache.get(product_id)
        if not product:
            continue

        nutrients = product.get("nutrients", {})
        for yazio_key, our_key in _SECONDARY_NUTRIENT_KEYS.items():
            per_gram = nutrients.get(yazio_key, 0) or 0
            meal_macros[meal_key][our_key] += per_gram * amount

        # Collect food item info
        cal_per_g = nutrients.get("energy.energy", 0) or 0
        prot_per_g = nutrients.get("nutrient.protein", 0) or 0
        carb_per_g = nutrients.get("nutrient.carb", 0) or 0
        fat_per_g = nutrients.get("nutrient.fat", 0) or 0
        food_items[meal_key].append({
            "name": product.get("name", "Unknown"),
            "brand": product.get("producer", ""),
            "amount": amount,
            "serving": item.get("serving", "g"),
            "calories": round(cal_per_g * amount, 1),
            "protein": round(prot_per_g * amount, 1),
            "carbs": round(carb_per_g * amount, 1),
            "fat": round(fat_per_g * amount, 1),
        })

    # Round values
    for meal_key in meal_macros:
        for k, v in meal_macros[meal_key].items():
            meal_macros[meal_key][k] = round(v, 2 if k == "salt" else 1)

    return meal_macros, food_items


def _parse_profile(raw: dict, summary_user: dict) -> dict:
    """
    Extract relevant user profile data from the /user endpoint
    and the daily-summary 'user' field.
    """
    diet = raw.get("diet", {})
    return {
        "first_name": raw.get("first_name", ""),
        "last_name": raw.get("last_name", ""),
        "sex": raw.get("sex", ""),
        "date_of_birth": raw.get("date_of_birth", ""),
        "body_height_cm": raw.get("body_height"),
        "current_weight_kg": summary_user.get("current_weight"),
        "start_weight_kg": summary_user.get("start_weight") or raw.get("start_weight"),
        "goal": summary_user.get("goal") or raw.get("goal", ""),
        "activity_degree": raw.get("activity_degree", ""),
        "weight_change_per_week_kg": raw.get("weight_change_per_week"),
        "diet_name": diet.get("name", ""),
        "diet_carb_pct": diet.get("carb_percentage"),
        "diet_fat_pct": diet.get("fat_percentage"),
        "diet_protein_pct": diet.get("protein_percentage"),
    }


def _parse_summary(raw: dict) -> dict:
    """
    Normalise a Yazio daily-summary into a clean dict.

    Handles missing meals/nutrients gracefully — if a key doesn't exist
    we just default to 0 instead of crashing.
    """
    meals = raw.get("meals", {})
    goals = raw.get("goals", {})
    user_info = raw.get("user", {})

    parsed_meals: dict[str, dict] = {}
    totals = {
        "calories": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0,
        "sugar": 0.0, "fiber": 0.0, "saturated": 0.0, "salt": 0.0,
    }

    for key in MEAL_KEYS:
        meal_data = meals.get(key, {})
        nutrients = meal_data.get("nutrients", {})

        cal  = nutrients.get("energy.energy", 0)
        prot = nutrients.get("nutrient.protein", 0)
        carb = nutrients.get("nutrient.carb", 0)
        fat  = nutrients.get("nutrient.fat", 0)
        sugar = nutrients.get("nutrient.sugar", 0)
        fiber = nutrients.get("nutrient.dietaryfiber", 0)
        saturated = nutrients.get("nutrient.saturated", 0)
        salt = nutrients.get("nutrient.salt", 0)

        parsed_meals[key] = {
            "calories": round(cal, 1),
            "protein":  round(prot, 1),
            "carbs":    round(carb, 1),
            "fat":      round(fat, 1),
            "sugar":    round(sugar, 1),
            "fiber":    round(fiber, 1),
            "saturated": round(saturated, 1),
            "salt":     round(salt, 2),
        }
        totals["calories"] += cal
        totals["protein"]  += prot
        totals["carbs"]    += carb
        totals["fat"]      += fat
        totals["sugar"]    += sugar
        totals["fiber"]    += fiber
        totals["saturated"] += saturated
        totals["salt"]     += salt

    # Round totals
    totals = {k: round(v, 1) if k != "salt" else round(v, 2) for k, v in totals.items()}

    goal_data = {
        "calories": round(goals.get("energy.energy", 0), 1),
        "protein":  round(goals.get("nutrient.protein", 0), 1),
        "carbs":    round(goals.get("nutrient.carb", 0), 1),
        "fat":      round(goals.get("nutrient.fat", 0), 1),
        "sugar":    round(goals.get("nutrient.sugar", 0), 1),
        "fiber":    round(goals.get("nutrient.dietaryfiber", 0), 1),
        "saturated": round(goals.get("nutrient.saturated", 0), 1),
        "salt":     round(goals.get("nutrient.salt", 0), 2),
    }

    # Water – might simply be missing
    water_ml = raw.get("consumed_water", 0) or 0
    water_goal_ml = raw.get("water_goal", 0) or 0

    # Steps / activity – also optional
    steps = raw.get("steps", 0) or 0
    activity_kcal = raw.get("activity_energy", 0) or 0

    return {
        "meals": parsed_meals,
        "totals": totals,
        "goals": goal_data,
        "water_ml": water_ml,
        "water_goal_ml": water_goal_ml,
        "steps": steps,
        "activity_kcal": round(activity_kcal, 1),
    }


async def fetch_yazio_summary(email: str, password: str, target_date: Optional[date] = None) -> Optional[dict]:
    """
    High-level function: login → fetch yesterday's summary + user profile → parse.

    Returns a dict with keys: meals, totals, goals, water_ml, steps, activity_kcal, profile.
    Returns None if anything goes wrong.
    """
    if target_date is None:
        target_date = date.today() - timedelta(days=1)

    date_str = target_date.isoformat()

    async with httpx.AsyncClient(timeout=30.0) as client:
        token = await _yazio_login(client, email, password)
        if not token:
            return None

        raw = await _fetch_daily_summary(client, token, date_str)
        if not raw:
            return None

        # Fetch full user profile for name, height, goal, diet etc.
        raw_profile = await _fetch_user_profile(client, token)

        # Fetch secondary macros (sugar, fiber, saturated, salt) via consumed-items + products
        secondary, food_items = await _compute_secondary_macros(client, token, date_str)

    result = _parse_summary(raw)

    # Include the actual date this data is from (critical for temporal accuracy in AI prompts)
    result["date"] = date_str

    # Merge secondary macros into meals and totals
    if secondary:
        for meal_key in MEAL_KEYS:
            if meal_key in secondary and meal_key in result["meals"]:
                for nutrient_key, value in secondary[meal_key].items():
                    result["meals"][meal_key][nutrient_key] = value
        # Recompute totals for secondary macros from the merged meal data
        for nutrient_key in ("sugar", "fiber", "saturated", "salt"):
            total = sum(
                result["meals"].get(mk, {}).get(nutrient_key, 0) for mk in MEAL_KEYS
            )
            result["totals"][nutrient_key] = round(total, 2 if nutrient_key == "salt" else 1)

    # Include individual food items per meal (for chat context)
    if food_items:
        result["food_items"] = food_items

    # Merge profile data
    summary_user = raw.get("user", {})
    if raw_profile:
        result["profile"] = _parse_profile(raw_profile, summary_user)
    else:
        # Fallback: use whatever the daily-summary 'user' field has
        result["profile"] = {
            "first_name": "",
            "last_name": "",
            "sex": summary_user.get("sex", ""),
            "date_of_birth": "",
            "body_height_cm": None,
            "current_weight_kg": summary_user.get("current_weight"),
            "start_weight_kg": summary_user.get("start_weight"),
            "goal": summary_user.get("goal", ""),
            "activity_degree": "",
            "weight_change_per_week_kg": None,
            "diet_name": "",
            "diet_carb_pct": None,
            "diet_fat_pct": None,
            "diet_protein_pct": None,
        }

    return result


async def fetch_nutrition_dates(
    email: str, password: str, days: int = 180
) -> list[dict]:
    """
    Check which dates have tracked nutrition over the last `days` days.
    Returns a list of {date: "YYYY-MM-DD", calories: float, protein: float}.
    Used for the GitHub-style activity heatmap.
    """
    import asyncio

    async with httpx.AsyncClient(timeout=30.0) as client:
        token = await _yazio_login(client, email, password)
        if not token:
            return []

        tracked: list[dict] = []
        today = date.today()

        # Fetch in batches to avoid hammering the API
        # Check each day — but limit concurrency
        semaphore = asyncio.Semaphore(5)

        async def check_date(d: date) -> Optional[dict]:
            async with semaphore:
                try:
                    resp = await client.get(
                        f"{YAZIO_BASE_URL}/user/widgets/daily-summary",
                        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                        params={"date": d.isoformat()},
                    )
                    if resp.status_code != 200:
                        return None
                    data = resp.json()
                    meals = data.get("meals", {})
                    total_cal = 0.0
                    total_protein = 0.0
                    for key in MEAL_KEYS:
                        nutrients = meals.get(key, {}).get("nutrients", {})
                        total_cal += nutrients.get("energy.energy", 0)
                        total_protein += nutrients.get("nutrient.protein", 0)
                    # Only count as tracked if any calories were logged
                    if total_cal > 0:
                        return {
                            "date": d.isoformat(),
                            "calories": round(total_cal, 1),
                            "protein": round(total_protein, 1),
                        }
                    return None
                except Exception:
                    return None

        dates_to_check = [today - timedelta(days=i) for i in range(days)]
        results = await asyncio.gather(*[check_date(d) for d in dates_to_check])

        tracked = [r for r in results if r is not None]
        return tracked
