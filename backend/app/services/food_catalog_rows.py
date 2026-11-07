"""Row mapping shared by the full import tool, the daily OFF delta sync and the live barcode lookup.

Pure standard library on purpose: it is imported both inside the backend container and by
tools/food_catalog_import.py, whose heavy dependencies (DuckDB, pandas) the backend does not ship.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
from typing import Any

EMBEDDING_MODEL = os.getenv("FOOD_EMBEDDING_MODEL", "google/gemini-embedding-2")
EMBEDDING_DIMENSIONS = int(os.getenv("FOOD_EMBEDDING_DIMENSIONS", "768"))

# Products sold in Germany, or registered with a German GS1 prefix (400-440).
GERMAN_GS1 = re.compile(r"^4[0-4]\d{11}$")

# Columns written by every importer (search_text, embedding, seen_run, updated_at are managed separately).
ROW_COLUMNS = [
    "source", "source_id", "name", "name_alt", "brand", "category", "unit", "kcal", "protein", "carbs", "fat",
    "sugar", "fiber", "saturated", "salt", "nutrients", "serving_g", "serving_label", "package_g", "quantity_label",
    "ingredients", "allergens", "scans", "completeness", "quality", "countries", "embed_text", "embed_hash",
]

# Open Food Facts nutriments worth showing. OFF normalises every "100g" value to grams,
# so the factor converts grams into the display unit.
OFF_EXTRA = {
    "monounsaturated-fat": ("Einfach ungesättigte Fettsäuren", "g", 1, "Fette"),
    "polyunsaturated-fat": ("Mehrfach ungesättigte Fettsäuren", "g", 1, "Fette"),
    "trans-fat": ("Transfettsäuren", "g", 1, "Fette"),
    "omega-3-fat": ("Omega-3-Fettsäuren", "g", 1, "Fette"),
    "cholesterol": ("Cholesterin", "mg", 1e3, "Fette"),
    "starch": ("Stärke", "g", 1, "Kohlenhydrate"),
    "lactose": ("Laktose", "g", 1, "Kohlenhydrate"),
    "polyols": ("Mehrwertige Alkohole", "g", 1, "Kohlenhydrate"),
    "added-sugars": ("Zugesetzter Zucker", "g", 1, "Kohlenhydrate"),
    "alcohol": ("Alkohol", "g", 1, "Sonstiges"),
    "caffeine": ("Koffein", "mg", 1e3, "Sonstiges"),
    "sodium": ("Natrium", "mg", 1e3, "Mineralstoffe"),
    "potassium": ("Kalium", "mg", 1e3, "Mineralstoffe"),
    "calcium": ("Calcium", "mg", 1e3, "Mineralstoffe"),
    "magnesium": ("Magnesium", "mg", 1e3, "Mineralstoffe"),
    "phosphorus": ("Phosphor", "mg", 1e3, "Mineralstoffe"),
    "iron": ("Eisen", "mg", 1e3, "Mineralstoffe"),
    "zinc": ("Zink", "mg", 1e3, "Mineralstoffe"),
    "iodine": ("Iod", "µg", 1e6, "Mineralstoffe"),
    "selenium": ("Selen", "µg", 1e6, "Mineralstoffe"),
    "copper": ("Kupfer", "mg", 1e3, "Mineralstoffe"),
    "manganese": ("Mangan", "mg", 1e3, "Mineralstoffe"),
    "vitamin-a": ("Vitamin A", "µg", 1e6, "Vitamine"),
    "vitamin-d": ("Vitamin D", "µg", 1e6, "Vitamine"),
    "vitamin-e": ("Vitamin E", "mg", 1e3, "Vitamine"),
    "vitamin-k": ("Vitamin K", "µg", 1e6, "Vitamine"),
    "vitamin-c": ("Vitamin C", "mg", 1e3, "Vitamine"),
    "vitamin-b1": ("Vitamin B1", "mg", 1e3, "Vitamine"),
    "vitamin-b2": ("Vitamin B2", "mg", 1e3, "Vitamine"),
    "vitamin-pp": ("Niacin", "mg", 1e3, "Vitamine"),
    "vitamin-b6": ("Vitamin B6", "mg", 1e3, "Vitamine"),
    "vitamin-b9": ("Folat", "µg", 1e6, "Vitamine"),
    "vitamin-b12": ("Vitamin B12", "µg", 1e6, "Vitamine"),
    "biotin": ("Biotin", "µg", 1e6, "Vitamine"),
    "pantothenic-acid": ("Pantothensäure", "mg", 1e3, "Vitamine"),
}


def clean_text(value: Any, limit: int | None = None) -> str | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    if not text:
        return None
    return text[:limit] if limit else text


def clean_brand(value: Any) -> str | None:
    """'Nutella, Ferrero, FERRERO' -> 'Nutella, Ferrero' (dedupe case-insensitively, keep two)."""
    text = clean_text(value)
    if not text:
        return None
    seen, parts = set(), []
    for part in text.split(","):
        part = part.strip()
        if part and part.lower() not in seen:
            seen.add(part.lower())
            parts.append(part)
    return ", ".join(parts[:2])[:120] or None


def embed_text_for(name: str, brand: str | None, name_alt: str | None) -> str:
    parts = [name]
    if brand:
        parts.append(brand)
    if name_alt and name_alt.lower() != name.lower():
        parts.append(name_alt)
    return " | ".join(parts)


def text_hash(value: str) -> str:
    return hashlib.sha1(f"{EMBEDDING_MODEL}|{EMBEDDING_DIMENSIONS}|{value}".encode("utf-8")).hexdigest()


def finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def quality_for(kcal, protein, carbs, fat) -> str:
    if None in (kcal, protein, carbs, fat):
        return "incomplete"
    if min(kcal, protein, carbs, fat) < 0 or protein + carbs + fat > 100.5 or kcal > 900:
        return "suspect"
    if kcal > 20 and abs(kcal - (4 * protein + 4 * carbs + 9 * fat)) > 0.25 * kcal:
        return "suspect"
    return "ok"


def off_extras(pairs) -> list[dict[str, Any]]:
    """(nutriment name, grams per 100 g) pairs -> display list for the nutrients column."""
    extras = []
    for name, raw in pairs:
        meta = OFF_EXTRA.get(name)
        value = finite(raw)
        if meta and value is not None and value >= 0:
            label, unit, factor, group = meta
            extras.append({"k": name, "l": label, "u": unit, "v": round(value * factor, 4), "g": group})
    return extras


def build_off_row(*, code: str, name_de: str | None, name_main: str | None, brands: Any, category: Any,
                  quantity_unit: Any, quantity: Any, package_g: Any, serving_g: Any, serving_size: Any,
                  core: dict[str, Any], extras: list[dict[str, Any]], ingredients: Any, allergens: Any,
                  scans: Any, completeness: Any, countries: Any) -> dict[str, Any] | None:
    """One normalised OFF catalog row, regardless of where the product data came from."""
    code = clean_text(code)
    name_de = clean_text(name_de, 300)
    name_main = clean_text(name_main, 300)
    name = name_de or name_main
    if not code or not name:
        return None
    brand = clean_brand(brands)
    values = {field: finite(core.get(field)) for field in ("kcal", "protein", "carbs", "fat", "sugar", "fiber", "saturated", "salt")}
    quantity_label = clean_text(quantity, 60)
    unit_raw = (clean_text(quantity_unit) or "").lower()
    serving_label = clean_text(serving_size, 60)
    is_liquid = unit_raw in {"ml", "cl", "l"} or bool(re.search(r"\d\s*(ml|cl|l)\b", f"{quantity_label or ''} {serving_label or ''}", re.I))
    serving = finite(serving_g)
    package = finite(package_g)
    name_alt = name_main if name_de and name_main and name_main.lower() != name_de.lower() else None
    text = embed_text_for(name, brand, name_alt)
    return {
        "source": "off", "source_id": code, "name": name, "name_alt": name_alt, "brand": brand,
        "category": clean_text(category, 120), "unit": "ml" if is_liquid else "g", **values,
        "nutrients": json.dumps(extras, ensure_ascii=False),
        "serving_g": serving if serving and 0 < serving <= 2000 else None,
        "serving_label": serving_label,
        "package_g": package if package and 0 < package <= 10000 else None,
        "quantity_label": quantity_label,
        "ingredients": clean_text(ingredients, 3000),
        "allergens": clean_text(allergens, 500),
        "scans": int(finite(scans) or 0),
        "completeness": finite(completeness),
        "quality": quality_for(values["kcal"], values["protein"], values["carbs"], values["fat"]),
        "countries": clean_text(countries, 300),
        "embed_text": text, "embed_hash": text_hash(text),
    }


def is_german(product: dict[str, Any]) -> bool:
    code = str(product.get("code") or "")
    return "en:germany" in (product.get("countries_tags") or []) or bool(GERMAN_GS1.match(code))


_MASS_FACTOR = {"g": 1.0, "mg": 1e-3, "µg": 1e-6, "μg": 1e-6, "mcg": 1e-6, "ug": 1e-6}


def _aggregated_per100(product: dict[str, Any]) -> dict[str, float]:
    """Nutrients from the schema-1004 `nutrition.aggregated_set`, normalised to g (energy to kcal) per 100 g/ml."""
    aggregated = (product.get("nutrition") or {}).get("aggregated_set") or {}
    if aggregated.get("per") not in ("100g", "100ml") or aggregated.get("preparation", "as_sold") != "as_sold":
        return {}
    values: dict[str, float] = {}
    for name, item in (aggregated.get("nutrients") or {}).items():
        if not isinstance(item, dict):
            continue
        value = finite(item.get("value"))
        if value is None:
            value = finite(item.get("value_computed"))
        if value is None:
            continue
        unit = str(item.get("unit") or "g")
        if name in ("energy-kcal",) and unit == "kcal":
            values["energy-kcal"] = value
        elif name in ("energy-kj", "energy") and unit.lower() == "kj":
            values.setdefault("energy-kj", value)
        elif unit in _MASS_FACTOR:
            values[name] = value * _MASS_FACTOR[unit]
    if "energy-kcal" not in values and "energy-kj" in values:
        values["energy-kcal"] = values["energy-kj"] / 4.184
    return values


def off_row_from_product(product: dict[str, Any]) -> dict[str, Any] | None:
    """Map an OFF product document (live API v2 or the daily JSONL delta export).

    Older documents carry `nutriments` with `<name>_100g` keys (already in grams); schema 1004
    documents may only have `nutrition.aggregated_set`, which is used as the fallback.
    """
    nutriments = product.get("nutriments") or {}
    aggregated = _aggregated_per100(product)

    def per100(key: str):
        value = nutriments.get(f"{key}_100g")
        return value if finite(value) is not None else aggregated.get(key)

    categories = product.get("categories_tags") or []
    return build_off_row(
        code=product.get("code"),
        name_de=product.get("product_name_de"),
        name_main=product.get("product_name"),
        brands=product.get("brands"),
        category=categories[-1] if categories else None,
        quantity_unit=product.get("product_quantity_unit"),
        quantity=product.get("quantity"),
        package_g=product.get("product_quantity"),
        serving_g=product.get("serving_quantity"),
        serving_size=product.get("serving_size"),
        core={"kcal": per100("energy-kcal"), "protein": per100("proteins"), "carbs": per100("carbohydrates"), "fat": per100("fat"),
              "sugar": per100("sugars"), "fiber": per100("fiber"), "saturated": per100("saturated-fat"), "salt": per100("salt")},
        extras=off_extras((name, per100(name)) for name in OFF_EXTRA),
        ingredients=product.get("ingredients_text_de") or product.get("ingredients_text"),
        allergens=",".join(product.get("allergens_tags") or []) or None,
        scans=product.get("unique_scans_n"),
        completeness=product.get("completeness"),
        countries=",".join((product.get("countries_tags") or [])[:6]) or None,
    )
