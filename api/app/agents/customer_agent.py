from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any

from app.agents.tools import build_approval_preview, build_customer_tools
from app.auth import UserContext
from app.config import Settings, get_settings
from app.models import (
    OrderItemInput,
    RecommendedDrink,
    RecommendedSeat,
    VisitPlanRequest,
    VisitPlanResponse,
)
from app.store.base import CafeStore

logger = logging.getLogger("aura.customer_agent")

# Prompt-injection & unauthorized-action patterns blocked before any LLM or tool action
INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?(previous|prior|system)?\s*(instructions|policies|rules)",
    r"(set|override|change|make)\s+(the\s+)?price\s*(to|=)?\s*[₹$]?\s*\d+",
    r"(free|₹\s*0|rs\.?\s*0|zero\s+rupees)\s+order",
    r"(reduce|deduct|set|wipe|delete|modify)\s+(the\s+)?(stock|inventory|database)",
    r"(show|dump|reveal|give)\s+(me\s+)?(?:(?:all|raw|confidential|internal|exact|full)\s+)*(inventory|stock\s+ledger|supplier|other\s+customer|everyone'?s\s+order)",
    r"(place|confirm|execute|commit)\s+(the\s+)?order\s+without\s+(my\s+)?(approval|confirmation)",
    r"pretend\s+(you\s+are|to\s+be)\s+(a\s+)?manager",
    r"another\s+customer'?s\s+order|user\s+b'?s\s+order|seed-ord-\d+",
]


def detect_policy_violation(message: str) -> str | None:
    lower = message.lower()
    for pat in INJECTION_PATTERNS:
        if re.search(pat, lower):
            if "price" in pat or "zero" in pat:
                return "Prices are fixed by the café catalog and cannot be overridden via chat."
            if "stock" in pat or "inventory" in pat:
                return "Internal inventory quantities and stock adjustments are restricted to authorized café staff."
            if "another" in pat or "other" in pat:
                return "For privacy and security, you can only inspect your own orders."
            if "without" in pat:
                return "Every order requires your explicit confirmation click before anything is reserved or placed."
            if "manager" in pat:
                return "Staff and manager privileges require verified staff authentication."
            return "I can't override café safety, pricing, or privacy policies—let me help you find available drinks and seats instead."
    return None


def parse_constraints_from_text(req: VisitPlanRequest) -> dict[str, Any]:
    """Deterministic NLP parser extracting budget, temperature, sweetness, dietary, allergens, time, and seat intent."""
    text = req.message.lower()

    # Budget extraction (e.g. "under ₹250", "under 250", "below rs 200", "budget 180")
    max_price_rupees = req.maxBudgetRupees
    if max_price_rupees is None:
        m = re.search(r"(?:under|below|less\s+than|max|within|budget(?:\s+of)?)\s*(?:₹|rs\.?|inr)?\s*(\d{2,4})", text)
        if m:
            max_price_rupees = int(m.group(1))
    max_price_paise = max_price_rupees * 100 if max_price_rupees is not None else None

    # Ready-within time extraction (e.g. "10 min", "15 minutes", "quick")
    ready_within = req.readyWithinMinutes
    if ready_within is None:
        tm = re.search(r"(\d{1,2})\s*(?:min|mins|minute|minutes)", text)
        if tm:
            ready_within = int(tm.group(1))
        elif any(w in text for w in ["quick", "hurry", "rush", "grab and go", "grab & go"]):
            ready_within = 10

    # Temperature
    temperature = None
    if any(w in text for w in ["cold", "iced", "chilled", "refreshing", "tonic", "cold brew"]):
        temperature = "cold"
    elif any(w in text for w in ["hot", "warm", "steamed", "flat white", "cappuccino", "chai", "v60", "cortado"]):
        temperature = "hot"

    # Sweetness
    not_too_sweet = any(
        w in text for w in ["not too sweet", "not sweet", "unsweetened", "no sugar", "sugar-free", "sugar free", "less sweet", "low sugar"]
    )

    # Dietary & Allergens
    dietary = set(t.lower() for t in req.dietaryTags)
    exclude_allergens = set(a.lower() for a in req.excludeAllergens)

    if any(w in text for w in ["dairy-free", "dairy free", "no dairy", "lactose", "vegan", "plant milk", "oat", "almond"]):
        dietary.add("dairy-free")
        exclude_allergens.add("dairy")
    if "vegan" in text:
        dietary.add("vegan")
    if "oat" in text:
        dietary.add("oat")
    if any(w in text for w in ["nut allergy", "no nuts", "nut-free", "nut free", "allergic to nuts", "peanut"]):
        exclude_allergens.add("tree_nuts")
    if any(w in text for w in ["gluten-free", "gluten free", "no gluten", "celiac"]):
        exclude_allergens.add("gluten")
    if any(w in text for w in ["caffeine-free", "caffeine free", "no caffeine", "decaf"]):
        caffeine_free = True
    else:
        caffeine_free = False

    # Seat & Intent
    social_signal = any(w in text for w in ["friend", "friends", "catch up", "chat", "meetup", "group", "social"])
    needs_outlet = req.needsOutlet if req.needsOutlet is not None else any(
        w in text for w in ["outlet", "socket", "plug", "charging", "charger", "laptop"]
    )
    quiet_preferred = req.quietPreferred if req.quietPreferred is not None else (
        any(w in text for w in ["quiet", "focus", "study", "deep work", "call", "read", "reading"])
        or ("meeting" in text and not social_signal)
    )
    needs_seat = req.needsSeat if req.needsSeat is not None else (
        quiet_preferred
        or social_signal
        or needs_outlet
        or any(w in text for w in ["seat", "table", "sit", "corner", "booth", "work", "stay", "two hours"])
    )

    intent = req.intent
    if not intent:
        if social_signal and not quiet_preferred:
            intent = "catch_up"
        elif quiet_preferred or "work" in text or "meeting" in text:
            intent = "focus"
        elif any(w in text for w in ["quick", "grab", "hurry", "to go", "takeaway"]) or (ready_within and ready_within <= 10 and not needs_seat):
            intent = "grab_and_go"
        else:
            intent = "explore"

    # Specific drink mention detection (e.g. "oat latte", "matcha", "cold brew", "almond")
    keyword_boost = []
    for kw in ["oat", "almond", "matcha", "cold brew", "tonic", "espresso", "chai", "croissant", "coconut", "decaf", "hibiscus", "v60"]:
        if kw in text:
            keyword_boost.append(kw)

    return {
        "intent": intent,
        "maxPricePaise": max_price_paise,
        "maxPriceRupees": max_price_rupees,
        "readyWithinMinutes": ready_within,
        "temperature": temperature,
        "notTooSweet": not_too_sweet,
        "dietaryTags": sorted(dietary),
        "excludeAllergens": sorted(exclude_allergens),
        "caffeineFree": caffeine_free,
        "needsSeat": needs_seat,
        "needsOutlet": needs_outlet,
        "quietPreferred": quiet_preferred,
        "keywordBoost": keyword_boost,
    }


async def _run_adk_explanation(
    settings: Settings,
    user_message: str,
    constraints: dict[str, Any],
    grounded_candidates: list[dict[str, Any]],
    unavailable_candidates: list[dict[str, Any]],
    seat_candidate: dict[str, Any] | None,
    eta: dict[str, Any],
    tools_dict: dict[str, Any],
    user_id: str,
) -> tuple[str | None, str | None, str | None]:
    """
    Runs a genuine Google ADK LlmAgent backed by Gemini Flash via Vertex AI / Google GenAI SDK.
    Returns (summary_text, model_id, error_reason).
    Grounded strictly on verified tool outputs; never allowed to invent items, stock, or prices.
    """
    if not settings.has_gemini_credentials:
        return None, None, "no_credentials"

    try:
        from google.adk.agents import LlmAgent
        from google.adk.runners import Runner
        from google.adk.sessions import InMemorySessionService
        from google.genai import types

        if settings.google_genai_use_vertexai and settings.google_cloud_project:
            os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "TRUE"
            os.environ["GOOGLE_CLOUD_PROJECT"] = settings.google_cloud_project
            os.environ["GOOGLE_CLOUD_LOCATION"] = settings.google_cloud_location
        elif settings.google_api_key:
            os.environ["GOOGLE_API_KEY"] = settings.google_api_key
            os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "FALSE"

        instruction = (
            "You are AURA, a warm, concise specialty café concierge. "
            "You MUST rely strictly on the verified live tool data provided below. "
            "NEVER invent menu items, prices, stock quantities, or pickup times. "
            "NEVER claim an order has been placed — always state that the customer must click Confirm to reserve stock. "
            "Respond in 2-3 crisp sentences explaining why the top recommended drink(s) and optional seat match the guest's request, "
            "noting real rupee prices (₹) and estimated prep window. If an item was unavailable due to stock, mention the in-stock substitute."
        )

        agent = LlmAgent(
            name="aura_customer_concierge",
            model=settings.gemini_model,
            instruction=instruction,
            tools=[tools_dict["check_ingredients"], tools_dict["estimate_wait"]],
        )
        session_service = InMemorySessionService()
        app_name = "aura_concierge"
        session_id = f"sess_{user_id}_{int(datetime.now(timezone.utc).timestamp())}"
        await session_service.create_session(app_name=app_name, user_id=user_id, session_id=session_id)

        runner = Runner(agent=agent, app_name=app_name, session_service=session_service)
        grounded_context = {
            "customerRequest": user_message,
            "parsedConstraints": constraints,
            "verifiedInStockOptions": grounded_candidates[:3],
            "currentlyUnavailableMatchingOptions": unavailable_candidates[:2],
            "verifiedAvailableSeat": seat_candidate,
            "deterministicEtaEstimate": {
                "minMinutes": eta["minMinutes"],
                "maxMinutes": eta["maxMinutes"],
                "scenario": eta["scenario"],
            },
        }
        prompt_text = (
            f"Customer message: {user_message}\n\n"
            f"Verified café data (authoritative — do not contradict or invent facts):\n"
            f"{json.dumps(grounded_context, ensure_ascii=False)}\n\n"
            "Write a concise, grounded 2-3 sentence concierge recommendation asking the guest to review and click Confirm."
        )
        content = types.Content(role="user", parts=[types.Part(text=prompt_text)])

        final_text = None
        async with asyncio.timeout(12.0):
            async for event in runner.run_async(user_id=user_id, session_id=session_id, new_message=content):
                if event.is_final_response() and event.content and event.content.parts:
                    final_text = "".join(p.text for p in event.content.parts if getattr(p, "text", None)).strip()

        if final_text:
            return final_text, settings.gemini_model, None
        return None, settings.gemini_model, "empty_response"
    except Exception as exc:
        logger.warning("ADK/Gemini customer call failed; using deterministic fallback: %s", exc)
        return None, settings.gemini_model, str(exc)


async def generate_visit_plan(
    store: CafeStore,
    cafe_id: str,
    req: VisitPlanRequest,
    user: UserContext | None,
    settings: Settings | None = None,
    force_deterministic: bool = False,
) -> VisitPlanResponse:
    cfg = settings or get_settings()
    now_iso = datetime.now(timezone.utc).isoformat()
    tool_evidence: list[dict[str, Any]] = []
    warnings: list[str] = []

    # 1. Policy & Prompt-Injection Guardrail
    violation = detect_policy_violation(req.message)
    if violation:
        return VisitPlanResponse(
            intent="policy_guard",
            summary=violation,
            constraints={"blockedReason": violation},
            recommendations=[],
            alternativeSuggestions=[],
            seat=None,
            eta={"source": "queue_estimator", "skipped": True},
            proposedCart=[],
            approvalPreview=None,
            requiresApproval=True,
            toolEvidence=[{"tool": "policy_guard", "status": "blocked", "reason": violation}],
            source="deterministic",
            modelId=None,
            warnings=[violation],
            dataAsOf=now_iso,
        )

    # 2. Extract constraints + incorporate consent-granted user preferences
    constraints = parse_constraints_from_text(req)
    if user is not None:
        prefs = store.get_preferences(cafe_id, user.uid)
        if prefs.get("consentGranted"):
            for dtag in prefs.get("dietaryPreferences", []):
                if dtag not in constraints["dietaryTags"]:
                    constraints["dietaryTags"].append(dtag)
                    if dtag in ("dairy-free", "vegan") and "dairy" not in constraints["excludeAllergens"]:
                        constraints["excludeAllergens"].append("dairy")
            tool_evidence.append({"tool": "get_customer_context", "consentGranted": True})
        else:
            tool_evidence.append({"tool": "get_customer_context", "consentGranted": False})

    # 3. Execute grounded read tools
    tools = build_customer_tools(store, cafe_id, user)
    drink_search = tools["find_available_drinks"](
        max_price_paise=constraints["maxPricePaise"],
        temperature=constraints["temperature"],
        not_too_sweet=constraints["notTooSweet"],
        dietary_tags=constraints["dietaryTags"],
        exclude_allergens=constraints["excludeAllergens"],
        caffeine_free=constraints["caffeineFree"],
    )
    tool_evidence.append(
        {
            "tool": "find_available_drinks",
            "matchedCount": drink_search["totalAvailableMatches"],
            "unavailableCount": len(drink_search["unavailableMatches"]),
        }
    )

    matches = drink_search["matches"]
    unavailable = drink_search["unavailableMatches"]

    # Boost keyword matches gently (e.g., user asked specifically for "oat" or "cold brew")
    kws = constraints.get("keywordBoost", [])
    if kws and matches:
        matches.sort(
            key=lambda x: (
                -sum(1 for kw in kws if kw in x["name"].lower() or kw in " ".join(x["allergens"]).lower()),
                x["pricePaise"],
            )
        )

    # If exact constraints returned 0 in-stock items (e.g., oat milk sold out!), find real in-stock substitutes!
    alternatives: list[dict[str, Any]] = []
    if not matches:
        relaxed_tags = [t for t in constraints["dietaryTags"] if t != "oat"]
        relaxed = tools["find_available_drinks"](
            max_price_paise=constraints["maxPricePaise"],
            temperature=constraints["temperature"],
            not_too_sweet=constraints["notTooSweet"],
            dietary_tags=relaxed_tags,
            exclude_allergens=constraints["excludeAllergens"],
            caffeine_free=constraints["caffeineFree"],
        )
        alternatives = relaxed["matches"][:3]
        if not alternatives and constraints["maxPricePaise"] is not None:
            broader = tools["find_available_drinks"](
                max_price_paise=None,
                temperature=constraints["temperature"],
                not_too_sweet=constraints["notTooSweet"],
                dietary_tags=relaxed_tags,
                exclude_allergens=constraints["excludeAllergens"],
                caffeine_free=constraints["caffeineFree"],
            )
            alternatives = broader["matches"][:3]
        if unavailable:
            warnings.append(
                f"Currently out of stock: {', '.join(u['name'] for u in unavailable[:2])}. Showing real in-stock alternatives."
            )
        else:
            warnings.append("No single drink matched every strict filter; showing the closest available in-stock options.")

    top_pool = matches[:3] if matches else alternatives[:3]
    top_ids = [d["id"] for d in top_pool]
    stock_checks = tools["check_ingredients"](top_ids) if top_ids else []
    tool_evidence.append({"tool": "check_ingredients", "checkedItemIds": top_ids})

    # 4. Deterministic ETA check
    eta = tools["estimate_wait"]([top_pool[0]["id"]] if top_pool else [])
    tool_evidence.append(
        {
            "tool": "estimate_wait",
            "minMinutes": eta["minMinutes"],
            "maxMinutes": eta["maxMinutes"],
            "scenario": eta["scenario"],
        }
    )

    ready_limit = constraints.get("readyWithinMinutes")
    if ready_limit is not None and eta["minMinutes"] > ready_limit:
        warnings.append(
            f"Current barista queue estimate is {eta['minMinutes']}–{eta['maxMinutes']} min, which may exceed your {ready_limit}-minute window."
        )

    # 5. Seat search (only if requested or intent benefits from a seat)
    seat_obj: RecommendedSeat | None = None
    seat_dict: dict[str, Any] | None = None
    if constraints["needsSeat"]:
        zone = "quiet" if constraints["quietPreferred"] else ("social" if constraints["intent"] == "catch_up" else None)
        seats = tools["get_available_seats"](zone=zone, needs_outlet=constraints["needsOutlet"])
        if not seats and zone:
            seats = tools["get_available_seats"](zone=None, needs_outlet=constraints["needsOutlet"])
        if not seats and constraints["needsOutlet"]:
            seats = tools["get_available_seats"](zone=None, needs_outlet=False)
        tool_evidence.append({"tool": "get_available_seats", "zone": zone, "freeMatches": len(seats)})
        if seats:
            best = seats[0]
            why_parts = [f"{best['zone']} zone", f"~{best['ambientNoiseDb']} dB (simulated)"]
            if best["hasOutlet"]:
                why_parts.append("power outlet")
            why_parts.append(f"{best['seats']} seats")
            seat_obj = RecommendedSeat(
                tableId=best["tableId"],
                label=best["label"],
                zone=best["zone"],
                hasOutlet=best["hasOutlet"],
                ambientNoiseDb=best["ambientNoiseDb"],
                why=", ".join(why_parts),
            )
            seat_dict = seat_obj.model_dump()
        else:
            warnings.append("No free matching seats are currently open; you can still order for pickup.")

    # 6. Format grounded drink recommendations
    def _to_rec(d: dict[str, Any]) -> RecommendedDrink:
        reasons = [f"₹{int(d['priceRupees'])}", f"{d['availableServings']} servings in stock"]
        if d["sweetness"] in ("unsweetened", "lightly_sweet"):
            reasons.append(d["sweetness"].replace("_", " "))
        if "dairy-free" in d["dietaryTags"]:
            reasons.append("dairy-free")
        return RecommendedDrink(
            menuItemId=d["id"],
            name=d["name"],
            pricePaise=d["pricePaise"],
            priceRupees=d["priceRupees"],
            availableServings=d["availableServings"],
            why=" · ".join(reasons),
            dietaryTags=d["dietaryTags"],
            allergens=d["allergens"],
            category=d["category"],
            temperature=d["temperature"],
        )

    rec_drinks = [_to_rec(d) for d in matches[:3]]
    alt_drinks = [_to_rec(d) for d in alternatives[:3]]

    # 7. Proposed cart + approval preview (if user is authenticated and a valid drink exists)
    proposed_cart: list[OrderItemInput] = []
    approval_preview = None
    chosen = rec_drinks[0] if rec_drinks else (alt_drinks[0] if alt_drinks else None)
    if chosen:
        proposed_cart = [OrderItemInput(menuItemId=chosen.menuItemId, qty=1, selectedModifierIds=[])]
        if user is not None:
            try:
                approval_preview = build_approval_preview(
                    store=store,
                    cafe_id=cafe_id,
                    user=user,
                    items=proposed_cart,
                    table_id=seat_obj.tableId if seat_obj else None,
                    settings=cfg,
                )
            except ValueError as exc:
                warnings.append(str(exc))

    # 8. Optional Gemini ADK explanation layer (clearly labeled as "gemini" vs "deterministic")
    source: str = "deterministic"
    model_id: str | None = None
    summary: str = ""

    if not force_deterministic and cfg.has_gemini_credentials:
        llm_text, used_model, err = await _run_adk_explanation(
            settings=cfg,
            user_message=req.message,
            constraints=constraints,
            grounded_candidates=[r.model_dump() for r in (rec_drinks or alt_drinks)],
            unavailable_candidates=unavailable,
            seat_candidate=seat_dict,
            eta=eta,
            tools_dict=tools,
            user_id=user.uid if user else "guest",
        )
        if llm_text:
            summary = llm_text
            source = "gemini"
            model_id = used_model
        elif err and err != "no_credentials":
            warnings.append("AI language layer temporarily unavailable; showing verified deterministic café plan.")

    if not summary:
        if rec_drinks:
            top = rec_drinks[0]
            seat_text = f" Paired with {seat_obj.label} ({seat_obj.why})." if seat_obj else ""
            summary = (
                f"Recommended: {top.name} (₹{int(top.priceRupees)}, {top.availableServings} servings in stock), "
                f"estimated ready in {eta['minMinutes']}–{eta['maxMinutes']} min.{seat_text} "
                "Review the breakdown and click Confirm to reserve stock."
            )
        elif alt_drinks:
            top = alt_drinks[0]
            unavail_names = ", ".join(u["name"] for u in unavailable[:2])
            prefix = f"{unavail_names} is currently out of stock. " if unavail_names else ""
            summary = (
                f"{prefix}Closest in-stock alternative: {top.name} (₹{int(top.priceRupees)}, "
                f"{top.availableServings} servings available), estimated ready in {eta['minMinutes']}–{eta['maxMinutes']} min."
            )
        else:
            summary = "No drinks currently match all filters with live inventory. Try widening your budget or dietary filters."

    return VisitPlanResponse(
        intent=constraints["intent"],
        summary=summary,
        constraints=constraints,
        recommendations=rec_drinks,
        alternativeSuggestions=alt_drinks,
        seat=seat_obj,
        eta=eta,
        proposedCart=proposed_cart,
        approvalPreview=approval_preview,
        requiresApproval=True,
        toolEvidence=tool_evidence,
        source=source,  # type: ignore[arg-type]
        modelId=model_id,
        warnings=warnings,
        dataAsOf=now_iso,
    )
