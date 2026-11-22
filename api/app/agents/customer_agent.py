from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

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

# Authoritative allergen synonym map (used by BOTH structured LLM clamp and regex fallback)
ALLERGEN_SYNONYMS: dict[str, str] = {
    "nut": "tree_nuts",
    "nuts": "tree_nuts",
    "tree nut": "tree_nuts",
    "tree nuts": "tree_nuts",
    "tree_nuts": "tree_nuts",
    "almond": "tree_nuts",
    "almonds": "tree_nuts",
    "cashew": "tree_nuts",
    "cashews": "tree_nuts",
    "hazelnut": "tree_nuts",
    "hazelnuts": "tree_nuts",
    "walnut": "tree_nuts",
    "walnuts": "tree_nuts",
    "pistachio": "tree_nuts",
    "pistachios": "tree_nuts",
    "peanut": "tree_nuts",
    "peanuts": "tree_nuts",
    "dairy": "dairy",
    "milk": "dairy",
    "lactose": "dairy",
    "cream": "dairy",
    "butter": "dairy",
    "oat": "oats",
    "oats": "oats",
    "gluten": "gluten",
    "wheat": "gluten",
    "coconut": "coconut",
    "sesame": "sesame",
}

ALLERGEN_TO_KEYWORDS: dict[str, set[str]] = {
    "tree_nuts": {"almond", "cashew", "hazelnut", "walnut", "pistachio", "nut"},
    "dairy": {"milk", "dairy", "cream", "butter", "cappuccino", "condensed"},
    "oats": {"oat", "oats"},
    "gluten": {"croissant", "danish", "loaf", "sourdough", "gluten"},
    "coconut": {"coconut"},
    "sesame": {"sesame"},
}

POSITIVE_KEYWORDS = [
    "oat",
    "almond",
    "matcha",
    "cold brew",
    "tonic",
    "espresso",
    "chai",
    "croissant",
    "coconut",
    "decaf",
    "hibiscus",
    "v60",
]


class StructuredIntentOutput(BaseModel):
    """Strict Pydantic schema for Gemini structured constraint extraction."""

    intent: Literal["focus", "grab_and_go", "catch_up", "explore"] = "explore"
    maxPriceRupees: int | None = Field(default=None, ge=50, le=5000)
    readyWithinMinutes: int | None = Field(default=None, ge=3, le=120)
    temperature: Literal["hot", "cold", "ambient"] | None = None
    notTooSweet: bool = False
    dietaryTags: list[str] = Field(default_factory=list)
    excludeAllergens: list[str] = Field(default_factory=list)
    caffeineFree: bool = False
    needsSeat: bool = False
    needsOutlet: bool = False
    quietPreferred: bool = False
    preferredKeywords: list[str] = Field(default_factory=list)


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


def _extract_negated_allergens(text: str) -> tuple[set[str], set[str], str]:
    """
    Detect allergy and negation phrases BEFORE any positive keyword matching!
    Returns (excluded_allergens, negated_raw_terms, scrubbed_text_without_negated_spans).
    """
    excluded: set[str] = set()
    negated_terms: set[str] = set()
    scrubbed = text

    term_pattern = "|".join(sorted((re.escape(k) for k in ALLERGEN_SYNONYMS), key=len, reverse=True))
    # Support lists like "allergic to almonds and cashews" or "no milk or nuts"
    list_group = rf"({term_pattern})(?:\s*(?:,|and|or)\s*({term_pattern}))*"

    negation_patterns = [
        rf"\b(?:allergic\s+to|allergy\s+to|intolerant\s+to|can'?t\s+(?:have|eat|drink)|cannot\s+(?:have|eat|drink)|avoid(?:ing)?|without|no)\s+{list_group}\b",
        rf"\b({term_pattern})[\s-]+(?:free|allergy|intolerant|intolerance)\b",
    ]

    for pat in negation_patterns:
        for match in re.finditer(pat, text, flags=re.IGNORECASE):
            span = match.group(0).lower()
            for raw_term, canonical in ALLERGEN_SYNONYMS.items():
                if re.search(rf"\b{re.escape(raw_term)}\b", span):
                    excluded.add(canonical)
                    negated_terms.add(raw_term)
                    negated_terms.update(ALLERGEN_TO_KEYWORDS.get(canonical, set()))
            # Scrub the negated span so downstream positive keyword detectors never match inside it
            scrubbed = scrubbed.replace(match.group(0), " ")

    return excluded, negated_terms, scrubbed


def parse_constraints_from_text(req: VisitPlanRequest) -> dict[str, Any]:
    """
    Deterministic constraint parser with allergy/negation precedence and strict word boundaries.
    Used both as standalone fallback and as deterministic safety overlay on LLM structured output.
    """
    raw_text = req.message.lower()

    # 1. Allergy & negation extraction FIRST (critical safety invariant!)
    neg_allergens, negated_terms, positive_text = _extract_negated_allergens(raw_text)

    exclude_allergens = {ALLERGEN_SYNONYMS.get(a.lower().strip(), a.lower().strip()) for a in req.excludeAllergens}
    exclude_allergens.update(neg_allergens)

    # 2. Budget extraction — NEVER match "within N min"! Handle "under/below/no more than/not over N rupees"
    max_price_rupees = req.maxBudgetRupees
    if max_price_rupees is None:
        budget_patterns = [
            r"\b(?:under|below|less\s+than|no\s+more\s+than|not\s+over|at\s+most|max(?:imum)?|up\s+to|budget(?:\s+of)?)\s*(?:₹|rs\.?|inr)?\s*(\d{2,4})(?:\s*(?:₹|rs\.?|rupees|inr))?(?!\s*(?:min|mins|minute|minutes|hr|hrs|hour|hours|sec|secs|db))\b",
            r"(?:₹|rs\.?|inr)\s*(\d{2,4})(?!\s*(?:min|mins|minute|minutes))",
            r"\b(\d{2,4})\s*(?:rupees|rs\.?|inr)\b",
        ]
        for bp in budget_patterns:
            m = re.search(bp, raw_text)
            if m:
                val = int(m.group(1))
                if 30 <= val <= 5000:
                    max_price_rupees = val
                    break
    max_price_paise = max_price_rupees * 100 if max_price_rupees is not None else None

    # 3. Ready-within time extraction
    ready_within = req.readyWithinMinutes
    if ready_within is None:
        tm = re.search(r"\b(\d{1,2})\s*(?:min|mins|minute|minutes)\b", raw_text)
        if tm:
            ready_within = int(tm.group(1))
        elif re.search(r"\b(?:quick|hurry|rush|grab\s+and\s+go|grab\s*&\s*go)\b", raw_text):
            ready_within = 10

    # 4. Temperature (word-bounded)
    temperature = None
    if re.search(r"\b(?:cold|iced|chilled|refreshing|tonic|cold\s+brew)\b", positive_text):
        temperature = "cold"
    elif re.search(r"\b(?:hot|warm|steamed|flat\s+white|cappuccino|chai|v60|cortado)\b", positive_text):
        temperature = "hot"

    # 5. Sweetness
    not_too_sweet = bool(
        re.search(
            r"\b(?:not\s+too\s+sweet|not\s+sweet|unsweetened|no\s+sugar|sugar[\s-]+free|less\s+sweet|low\s+sugar)\b",
            raw_text,
        )
    )

    # 6. Dietary tags (NEVER add a milk/tag that was negated or allergen-excluded!)
    dietary = {t.lower().strip() for t in req.dietaryTags if t.strip()}
    if "dairy" in exclude_allergens or re.search(r"\b(?:vegan|plant\s+milk)\b", positive_text):
        dietary.add("dairy-free")
        exclude_allergens.add("dairy")
    if re.search(r"\bvegan\b", positive_text):
        dietary.add("vegan")
    # Positive oat / almond preference ONLY if NOT excluded by allergy!
    if "oats" not in exclude_allergens and re.search(r"\boat(?:s|\s+milk)?\b", positive_text):
        dietary.add("oat")
        dietary.add("dairy-free")
        exclude_allergens.add("dairy")
    if "tree_nuts" not in exclude_allergens and re.search(r"\balmond(?:\s+milk)?\b", positive_text):
        dietary.add("dairy-free")
        exclude_allergens.add("dairy")

    caffeine_free = bool(re.search(r"\b(?:caffeine[\s-]+free|no\s+caffeine|decaf)\b", raw_text))

    # 7. Seat & Intent (word-bounded, social beats generic "meeting friends")
    social_signal = bool(re.search(r"\b(?:friend|friends|catch\s+up|chat|meetup|group|social)\b", raw_text))
    needs_outlet = req.needsOutlet if req.needsOutlet is not None else bool(
        re.search(r"\b(?:outlet|socket|plug|charging|charger|laptop)\b", raw_text)
    )
    quiet_preferred = req.quietPreferred if req.quietPreferred is not None else (
        bool(re.search(r"\b(?:quiet|focus|study|deep\s+work|call|read|reading)\b", raw_text))
        or (bool(re.search(r"\bmeeting\b", raw_text)) and not social_signal)
    )
    needs_seat = req.needsSeat if req.needsSeat is not None else (
        quiet_preferred
        or social_signal
        or needs_outlet
        or bool(re.search(r"\b(?:seat|table|sit|corner|booth|work|stay|two\s+hours)\b", raw_text))
    )

    intent = req.intent
    if not intent:
        if social_signal and not quiet_preferred:
            intent = "catch_up"
        elif quiet_preferred or re.search(r"\b(?:work|meeting)\b", raw_text):
            intent = "focus"
        elif re.search(r"\b(?:quick|grab|hurry|to\s+go|takeaway)\b", raw_text) or (
            ready_within is not None and ready_within <= 10 and not needs_seat
        ):
            intent = "grab_and_go"
        else:
            intent = "explore"

    # 8. Positive keyword boost — strictly word-bounded AND never includes any negated/allergen-excluded keyword!
    banned_kws = set(negated_terms)
    for alg in exclude_allergens:
        banned_kws.update(ALLERGEN_TO_KEYWORDS.get(alg, set()))

    keyword_boost = []
    for kw in POSITIVE_KEYWORDS:
        if kw in banned_kws:
            continue
        if re.search(rf"\b{re.escape(kw)}\b", positive_text):
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


async def extract_constraints_with_gemini(
    req: VisitPlanRequest,
    settings: Settings,
) -> dict[str, Any]:
    """
    Uses Gemini structured output (Pydantic schema) to extract constraints when live credentials
    are active, then deterministically clamps and overlays regex allergy/negation protections.
    Falls back cleanly to deterministic parser if unavailable.
    """
    fallback = parse_constraints_from_text(req)
    if not settings.has_gemini_credentials:
        return fallback

    try:
        from google import genai
        from google.genai import types

        if settings.google_genai_use_vertexai and settings.google_cloud_project:
            client = genai.Client(
                vertexai=True,
                project=settings.google_cloud_project,
                location=settings.google_cloud_location,
            )
        elif settings.google_api_key:
            client = genai.Client(api_key=settings.google_api_key)
        else:
            return fallback

        sys_prompt = (
            "Extract café visit constraints from the customer's message into JSON. "
            "Map almond, cashew, hazelnut, walnut, pistachio, and peanut allergies to 'tree_nuts'. "
            "Map 'no milk' / 'lactose' / 'dairy-free' to excludeAllergens=['dairy'] and dietaryTags=['dairy-free']. "
            "Never put an allergen or negated item into preferredKeywords. "
            "Never confuse 'within N minutes' with a rupee budget."
        )
        resp = await asyncio.wait_for(
            asyncio.to_thread(
                client.models.generate_content,
                model=settings.gemini_model,
                contents=req.message,
                config=types.GenerateContentConfig(
                    system_instruction=sys_prompt,
                    response_mime_type="application/json",
                    response_schema=StructuredIntentOutput,
                    temperature=0.0,
                ),
            ),
            timeout=8.0,
        )
        parsed = StructuredIntentOutput.model_validate_json(resp.text or "{}")

        # Deterministically clamp & merge safety-critical allergen exclusions from BOTH LLM & regex
        merged_allergens = set(fallback["excludeAllergens"])
        for a in parsed.excludeAllergens:
            merged_allergens.add(ALLERGEN_SYNONYMS.get(a.lower().strip(), a.lower().strip()))

        banned_kws: set[str] = set()
        for alg in merged_allergens:
            banned_kws.update(ALLERGEN_TO_KEYWORDS.get(alg, set()))

        merged_dietary = set(fallback["dietaryTags"]) | {t.lower().strip() for t in parsed.dietaryTags if t.strip()}
        if "oats" in merged_allergens:
            merged_dietary.discard("oat")
        if "dairy" in merged_allergens:
            merged_dietary.add("dairy-free")

        safe_kws = [
            kw.lower().strip()
            for kw in (parsed.preferredKeywords or fallback["keywordBoost"])
            if kw.lower().strip() in POSITIVE_KEYWORDS and kw.lower().strip() not in banned_kws
        ]

        max_rs = req.maxBudgetRupees or parsed.maxPriceRupees or fallback["maxPriceRupees"]
        if max_rs is not None:
            max_rs = max(30, min(5000, int(max_rs)))

        ready_min = req.readyWithinMinutes or parsed.readyWithinMinutes or fallback["readyWithinMinutes"]
        if ready_min is not None:
            ready_min = max(3, min(120, int(ready_min)))

        return {
            "intent": req.intent or parsed.intent or fallback["intent"],
            "maxPricePaise": max_rs * 100 if max_rs is not None else None,
            "maxPriceRupees": max_rs,
            "readyWithinMinutes": ready_min,
            "temperature": parsed.temperature or fallback["temperature"],
            "notTooSweet": bool(parsed.notTooSweet or fallback["notTooSweet"]),
            "dietaryTags": sorted(merged_dietary),
            "excludeAllergens": sorted(merged_allergens),
            "caffeineFree": bool(parsed.caffeineFree or fallback["caffeineFree"]),
            "needsSeat": bool(req.needsSeat if req.needsSeat is not None else (parsed.needsSeat or fallback["needsSeat"])),
            "needsOutlet": bool(req.needsOutlet if req.needsOutlet is not None else (parsed.needsOutlet or fallback["needsOutlet"])),
            "quietPreferred": bool(req.quietPreferred if req.quietPreferred is not None else (parsed.quietPreferred or fallback["quietPreferred"])),
            "keywordBoost": safe_kws,
            "extractionSource": "gemini_structured",
        }
    except Exception as exc:
        logger.warning("Gemini structured constraint extraction fell back to deterministic parser: %s", exc)
        return fallback


def validate_grounded_summary(
    summary: str,
    grounded_candidates: list[dict[str, Any]],
    unavailable_candidates: list[dict[str, Any]],
    all_menu_items: list[dict[str, Any]],
    max_price_rupees: int | None = None,
) -> tuple[bool, str | None]:
    """
    Post-generation grounding validator for Gemini prose:
      1. Every ₹ amount mentioned must match an exact candidate rupee price (or user's stated budget).
      2. Every catalog drink name mentioned must belong strictly to grounded_candidates or unavailable_candidates.
    Returns (is_valid, failure_reason).
    """
    allowed_rupees: set[int] = set()
    for c in grounded_candidates + unavailable_candidates:
        if "priceRupees" in c:
            allowed_rupees.add(int(round(float(c["priceRupees"]))))
        elif "pricePaise" in c:
            allowed_rupees.add(int(round(int(c["pricePaise"]) / 100.0)))
    if max_price_rupees is not None:
        allowed_rupees.add(int(max_price_rupees))

    for m in re.finditer(r"(?:₹|rs\.?)\s*(\d+(?:\.\d+)?)", summary, flags=re.IGNORECASE):
        mentioned = int(round(float(m.group(1))))
        if mentioned not in allowed_rupees:
            return False, f"Ungrounded price ₹{mentioned} not in verified candidates {sorted(allowed_rupees)}"

    allowed_names = {c["name"].lower() for c in grounded_candidates + unavailable_candidates}
    lower_summary = summary.lower()
    for item in all_menu_items:
        iname = item["name"].lower()
        if iname in lower_summary and iname not in allowed_names:
            return False, f"Mentioned unverified or excluded drink '{item['name']}'"

    return True, None


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
            "NEVER mention drinks outside the verified lists. "
            "NEVER claim an order has been placed — always state that the customer must click Confirm to reserve stock. "
            "Respond in 2-3 crisp sentences explaining why the top recommended drink(s) and optional seat match the guest's request, "
            "noting exact rupee prices (₹) and estimated prep window."
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

    # 2. Extract constraints (Gemini structured output with deterministic clamp, or deterministic fallback)
    constraints = (
        parse_constraints_from_text(req)
        if force_deterministic
        else await extract_constraints_with_gemini(req, cfg)
    )
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

    # Boost ONLY safe, non-negated positive keywords
    kws = constraints.get("keywordBoost", [])
    if kws and matches:
        matches.sort(
            key=lambda x: (
                -sum(1 for kw in kws if kw in x["name"].lower() or kw in " ".join(x["allergens"]).lower()),
                x["pricePaise"],
            )
        )

    # If exact constraints returned 0 in-stock items, find real in-stock substitutes respecting ALLERGEN EXCLUSIONS!
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
    if top_ids:
        tools["check_ingredients"](top_ids)
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

    # 5. Seat search
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

    # 6. Proposed cart + approval preview (server-issued token; agent NEVER commits orders)
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

    # 7. Optional Gemini ADK explanation + strict grounding validation
    source: str = "deterministic"
    model_id: str | None = None
    summary: str = ""

    if not force_deterministic and cfg.has_gemini_credentials:
        cand_dicts = [r.model_dump() for r in (rec_drinks or alt_drinks)]
        llm_text, used_model, err = await _run_adk_explanation(
            settings=cfg,
            user_message=req.message,
            constraints=constraints,
            grounded_candidates=cand_dicts,
            unavailable_candidates=unavailable,
            seat_candidate=seat_dict,
            eta=eta,
            tools_dict=tools,
            user_id=user.uid if user else "guest",
        )
        if llm_text:
            is_valid, fail_reason = validate_grounded_summary(
                summary=llm_text,
                grounded_candidates=cand_dicts,
                unavailable_candidates=unavailable,
                all_menu_items=store.list_menu_items(cafe_id),
                max_price_rupees=constraints.get("maxPriceRupees"),
            )
            if is_valid:
                summary = llm_text
                source = "gemini"
                model_id = used_model
            else:
                logger.warning("Rejected ungrounded Gemini summary (%s); using deterministic summary", fail_reason)
                warnings.append("AI explanation failed grounding check; showing verified deterministic summary.")
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
