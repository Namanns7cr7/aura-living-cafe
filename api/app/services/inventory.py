from __future__ import annotations

from collections import Counter
from typing import Any

from app.models import (
    Ingredient,
    IngredientView,
    MenuItem,
    MenuItemWithAvailability,
    RecipeRequirement,
)


def compute_available_units(ingredient: dict[str, Any]) -> int:
    return max(0, int(ingredient["onHand"]) - int(ingredient.get("reserved", 0)))


def ingredient_status(ingredient: dict[str, Any]) -> str:
    avail = compute_available_units(ingredient)
    threshold = int(ingredient["lowThreshold"])
    if avail <= 0:
        return "out"
    if avail <= max(1, threshold // 2):
        return "critical"
    if avail <= threshold:
        return "low"
    return "healthy"


def resolve_effective_recipe(
    item: dict[str, Any],
    selected_modifier_ids: list[str] | None = None,
) -> tuple[list[dict[str, Any]], int, list[str]]:
    """
    Deterministic recipe & price resolver applying configured modifiers.
    Returns (aggregated_recipe_list, unit_price_paise, modifier_names).
    Raises ValueError if an unknown modifier is supplied.
    """
    selected = selected_modifier_ids or []
    mod_map = {m["id"]: m for m in item.get("modifiers", [])}

    # Start from base recipe as ingredientId -> qty
    totals: dict[str, int] = {}
    for req in item.get("recipe", []):
        iid = req["ingredientId"]
        totals[iid] = totals.get(iid, 0) + int(req["qty"])

    unit_price = int(item["pricePaise"])
    mod_names: list[str] = []

    for mod_id in selected:
        if mod_id not in mod_map:
            raise ValueError(f"Modifier '{mod_id}' is not configured for item '{item['id']}'")
        mod = mod_map[mod_id]
        unit_price += int(mod.get("priceDeltaPaise", 0))
        mod_names.append(mod["name"])
        replace_id = mod.get("replaceIngredientId")
        if replace_id and replace_id in totals:
            del totals[replace_id]
        for delta in mod.get("recipeDeltas", []):
            iid = delta["ingredientId"]
            totals[iid] = totals.get(iid, 0) + int(delta["qty"])

    recipe_list = [{"ingredientId": k, "qty": v} for k, v in sorted(totals.items()) if v > 0]
    return recipe_list, unit_price, mod_names


def calculate_item_servings(
    item: dict[str, Any],
    ingredients_by_id: dict[str, dict[str, Any]],
    selected_modifier_ids: list[str] | None = None,
) -> tuple[int, str | None, str | None]:
    """
    Pure deterministic availability math:
      available_i = max(0, onHand_i - reserved_i)
      servings = min(floor(available_i / perServing_i))
    Returns (servings, limiting_ingredient_id, limiting_ingredient_name).
    """
    if not item.get("active", True):
        return 0, None, "Temporarily unavailable"

    recipe, _, _ = resolve_effective_recipe(item, selected_modifier_ids)
    if not recipe:
        return 0, None, "Unconfigured recipe"

    min_servings: int | None = None
    limiting_id: str | None = None
    limiting_name: str | None = None

    for req in recipe:
        iid = req["ingredientId"]
        per_serving = int(req["qty"])
        if per_serving <= 0:
            continue
        ing = ingredients_by_id.get(iid)
        if ing is None:
            return 0, iid, f"Missing ingredient ({iid})"
        avail = compute_available_units(ing)
        possible = avail // per_serving
        if min_servings is None or possible < min_servings:
            min_servings = possible
            limiting_id = iid
            limiting_name = ing["name"]

    return (min_servings or 0), limiting_id, limiting_name


def enrich_menu_with_availability(
    menu_items: list[dict[str, Any]],
    ingredients_by_id: dict[str, dict[str, Any]],
) -> list[MenuItemWithAvailability]:
    enriched: list[MenuItemWithAvailability] = []
    for item in menu_items:
        servings, lim_id, lim_name = calculate_item_servings(item, ingredients_by_id)
        enriched.append(
            MenuItemWithAvailability(
                **item,
                availableServings=servings,
                isAvailable=bool(item.get("active", True) and servings > 0),
                limitingIngredientId=lim_id,
                limitingIngredientName=lim_name,
                priceRupees=round(int(item["pricePaise"]) / 100.0, 2),
            )
        )
    return enriched


def enrich_ingredients_view(
    ingredients: list[dict[str, Any]],
    menu_items: list[dict[str, Any]],
) -> list[IngredientView]:
    ing_to_drinks: dict[str, list[str]] = {}
    for item in menu_items:
        for req in item.get("recipe", []):
            ing_to_drinks.setdefault(req["ingredientId"], []).append(item["name"])

    views: list[IngredientView] = []
    for ing in ingredients:
        avail = compute_available_units(ing)
        st = ingredient_status(ing)
        views.append(
            IngredientView(
                **ing,
                available=avail,
                status=st,  # type: ignore[arg-type]
                affectedDrinks=ing_to_drinks.get(ing["id"], []),
            )
        )
    return sorted(views, key=lambda x: ({"out": 0, "critical": 1, "low": 2, "healthy": 3}[x.status], x.name))


def aggregate_cart_requirements(
    cart_items: list[dict[str, Any]],
    menu_by_id: dict[str, dict[str, Any]],
) -> tuple[dict[str, int], list[dict[str, Any]], int]:
    """
    Aggregates ingredient quantities and validates prices across the whole cart.
    Returns (ingredient_id -> total_required_qty, order_item_snapshots, total_paise).
    """
    total_reqs: dict[str, int] = {}
    snapshots: list[dict[str, Any]] = []
    total_paise = 0

    for entry in cart_items:
        mid = entry["menuItemId"]
        qty = int(entry["qty"])
        if qty <= 0:
            raise ValueError("Item quantity must be at least 1")
        if mid not in menu_by_id:
            raise ValueError(f"Unknown menu item '{mid}'")
        item = menu_by_id[mid]
        if not item.get("active", True):
            raise ValueError(f"'{item['name']}' is currently unavailable")

        mod_ids = entry.get("selectedModifierIds", [])
        recipe, unit_price, mod_names = resolve_effective_recipe(item, mod_ids)
        line_total = unit_price * qty
        total_paise += line_total

        for req in recipe:
            iid = req["ingredientId"]
            total_reqs[iid] = total_reqs.get(iid, 0) + int(req["qty"]) * qty

        snapshots.append(
            {
                "menuItemId": mid,
                "name": item["name"],
                "qty": qty,
                "unitPricePaise": unit_price,
                "lineTotalPaise": line_total,
                "selectedModifierIds": list(mod_ids),
                "selectedModifierNames": mod_names,
                "recipeSnapshot": recipe,
            }
        )

    return total_reqs, snapshots, total_paise


def find_in_stock_substitutes(
    unavailable_item: dict[str, Any],
    all_menu_enriched: list[MenuItemWithAvailability],
    max_price_paise: int | None = None,
    limit: int = 3,
) -> list[MenuItemWithAvailability]:
    """Finds genuinely in-stock alternatives matching category/temperature/dietary profile."""
    target_tags = set(unavailable_item.get("dietaryTags", []))
    candidates = []
    for item in all_menu_enriched:
        if item.id == unavailable_item["id"] or not item.isAvailable:
            continue
        if max_price_paise is not None and item.pricePaise > max_price_paise:
            continue
        score = 0
        if item.category == unavailable_item.get("category"):
            score += 3
        if item.temperature == unavailable_item.get("temperature"):
            score += 3
        score += len(target_tags.intersection(set(item.dietaryTags))) * 2
        score += min(item.availableServings, 10) * 0.1
        candidates.append((score, item))
    candidates.sort(key=lambda pair: (-pair[0], pair[1].pricePaise))
    return [c[1] for c in candidates[:limit]]


def compute_demand_leaders(orders: list[dict[str, Any]], top_n: int = 5) -> list[dict[str, Any]]:
    counts: Counter[str] = Counter()
    names: dict[str, str] = {}
    revenue: Counter[int | str] = Counter()
    for order in orders:
        if order.get("status") == "cancelled":
            continue
        for item in order.get("items", []):
            mid = item["menuItemId"]
            counts[mid] += int(item["qty"])
            names[mid] = item["name"]
            revenue[mid] += int(item["lineTotalPaise"])
    return [
        {
            "menuItemId": mid,
            "name": names[mid],
            "unitsOrdered": qty,
            "revenueRupees": round(int(revenue[mid]) / 100.0, 2),
        }
        for mid, qty in counts.most_common(top_n)
    ]
