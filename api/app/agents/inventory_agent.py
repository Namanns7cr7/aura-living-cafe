from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from app.agents.tools import build_inventory_tools
from app.config import Settings, get_settings
from app.models import OperationalRecommendation, OpsInsightRequest, OpsInsightResponse
from app.store.base import CafeStore

logger = logging.getLogger("aura.inventory_agent")


async def _run_adk_ops_summary(
    settings: Settings,
    question: str,
    evidence_bundle: dict[str, Any],
    tools_dict: dict[str, Any],
    actor_id: str,
) -> tuple[str | None, str | None]:
    if not settings.has_gemini_credentials:
        return None, None
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

        agent = LlmAgent(
            name="aura_inventory_operations",
            model=settings.gemini_model,
            instruction=(
                "You are AURA's Inventory Operations Assistant for café managers. "
                "Ground every number strictly in the verified inventory tool outputs provided. "
                "Never claim you mutated stock or placed supplier orders—every action requires manager approval. "
                "Give a crisp 2-4 sentence operational brief citing exact ingredient units, remaining servings, and safe in-stock substitutes."
            ),
            tools=[tools_dict["find_low_stock_items"], tools_dict["explain_shortages"]],
        )
        session_service = InMemorySessionService()
        app_name = "aura_ops"
        session_id = f"ops_{actor_id}_{int(datetime.now(timezone.utc).timestamp())}"
        await session_service.create_session(app_name=app_name, user_id=actor_id, session_id=session_id)

        runner = Runner(agent=agent, app_name=app_name, session_service=session_service)
        prompt = (
            f"Manager question: {question}\n\n"
            f"Verified live café operations telemetry:\n{json.dumps(evidence_bundle, ensure_ascii=False)}\n\n"
            "Provide a clear, factual 2-4 sentence operations brief citing actual units and proposing approval-only next steps."
        )
        content = types.Content(role="user", parts=[types.Part(text=prompt)])

        final_text = None
        async with asyncio.timeout(12.0):
            async for event in runner.run_async(user_id=actor_id, session_id=session_id, new_message=content):
                if event.is_final_response() and event.content and event.content.parts:
                    final_text = "".join(p.text for p in event.content.parts if getattr(p, "text", None)).strip()
        return final_text, settings.gemini_model
    except Exception as exc:
        logger.warning("ADK/Gemini inventory ops call failed; using deterministic summary: %s", exc)
        return None, settings.gemini_model


async def generate_inventory_insights(
    store: CafeStore,
    cafe_id: str,
    req: OpsInsightRequest,
    actor_id: str,
    settings: Settings | None = None,
    persist_proposals: bool = True,
    force_deterministic: bool = False,
) -> OpsInsightResponse:
    cfg = settings or get_settings()
    now_iso = datetime.now(timezone.utc).isoformat()
    tools = build_inventory_tools(store, cafe_id)

    summary_data = tools["get_inventory_summary"]()
    servings_all = tools["calculate_available_servings"]()
    demand = tools["analyze_order_demand"]()
    restock_plan = tools["recommend_restock"]()
    shortages = tools["explain_shortages"]()
    demo_state = store.get_demo_state(cafe_id)

    tool_evidence = [
        {"tool": "get_inventory_summary", "atRiskCount": len(summary_data["atRisk"])},
        {"tool": "calculate_available_servings", "itemsChecked": len(servings_all)},
        {"tool": "analyze_order_demand", "ordersAnalyzed": demand["totalOrdersWindow"]},
        {"tool": "recommend_restock", "restockCandidates": len(restock_plan)},
        {"tool": "explain_shortages", "shortageItems": len(shortages)},
    ]

    servings_at_risk = [s for s in servings_all if s["availableServings"] <= 6][:6]
    proposed_recs: list[OperationalRecommendation] = []

    # 1. Restock proposals for genuinely low/critical/out ingredients
    for r in restock_plan[:2]:
        rec_doc = {
            "id": f"rec_restock_{r['ingredientId']}",
            "cafeId": cafe_id,
            "type": "restock",
            "title": f"Restock {r['ingredientName']} (+{r['suggestedRestockQty']}{r['unit']})",
            "rationale": (
                f"Available stock is {r['currentAvailable']}{r['unit']} (threshold: {r['lowThreshold']}{r['unit']}). "
                f"Affects: {', '.join(r['affectedDrinks'][:3]) or 'multiple recipes'}."
            ),
            "evidence": r,
            "suggestedAction": f"Approve +{r['suggestedRestockQty']}{r['unit']} restock of {r['ingredientName']}",
            "status": "pending",
            "source": "deterministic",
            "createdAt": now_iso,
            "decidedBy": None,
            "decidedAt": None,
        }
        if persist_proposals:
            saved = store.save_recommendation(cafe_id, rec_doc)
            proposed_recs.append(OperationalRecommendation(**saved))
        else:
            proposed_recs.append(OperationalRecommendation(**rec_doc))

    # 2. Safe in-stock substitute promotion proposal (ONLY for genuinely in-stock drinks)
    for sh in shortages[:2]:
        subs = sh.get("inStockSubstitutes", [])
        if subs:
            best_sub = subs[0]
            rec_doc = {
                "id": f"rec_sub_{sh['menuItemId']}_{best_sub['id']}",
                "cafeId": cafe_id,
                "type": "substitute_promo",
                "title": f"Feature {best_sub['name']} while {sh['name']} is tight",
                "rationale": (
                    f"{sh['name']} has only {sh['availableServings']} servings remaining (limited by {sh['limitingIngredient']}). "
                    f"{best_sub['name']} has {best_sub['availableServings']} servings ready at ₹{int(best_sub['priceRupees'])}."
                ),
                "evidence": sh,
                "suggestedAction": f"Featured today: Try our {best_sub['name']} (₹{int(best_sub['priceRupees'])}) — freshly stocked & ready fast!",
                "status": "pending",
                "source": "deterministic",
                "createdAt": now_iso,
                "decidedBy": None,
                "decidedAt": None,
            }
            if persist_proposals:
                saved = store.save_recommendation(cafe_id, rec_doc)
                proposed_recs.append(OperationalRecommendation(**saved))
            else:
                proposed_recs.append(OperationalRecommendation(**rec_doc))
            break

    # 3. Queue alert during Rush simulation
    if demo_state.get("scenario") == "rush":
        rec_doc = {
            "id": f"rec_queue_{uuid.uuid4().hex[:6]}",
            "cafeId": cafe_id,
            "type": "queue_alert",
            "title": "Rush Hour Queue Load — Highlight Fast-Prep Drinks",
            "rationale": (
                f"Active scenario is '{demo_state['scenario']}' with {demo_state['simulatedQueueWorkUnits']} simulated work units queued. "
                "Cold Brew and Double Espresso require only 2 work units."
            ),
            "evidence": {"demoState": demo_state},
            "suggestedAction": "Highlight 18-Hour Slow Cold Brew & Iced Long Black for fastest pickup during rush.",
            "status": "pending",
            "source": "deterministic",
            "createdAt": now_iso,
            "decidedBy": None,
            "decidedAt": None,
        }
        if persist_proposals:
            saved = store.save_recommendation(cafe_id, rec_doc)
            proposed_recs.append(OperationalRecommendation(**saved))
        else:
            proposed_recs.append(OperationalRecommendation(**rec_doc))

    source: str = "deterministic"
    model_id: str | None = None
    summary_text = ""

    if not force_deterministic and cfg.has_gemini_credentials:
        evidence_bundle = {
            "atRiskIngredients": summary_data["atRisk"][:5],
            "servingsAtRisk": servings_at_risk[:5],
            "demandLeaders": demand["demandLeaders"][:4],
            "shortageExplanations": shortages[:3],
            "scenario": demo_state["scenario"],
        }
        llm_summary, used_model = await _run_adk_ops_summary(cfg, req.question, evidence_bundle, tools, actor_id)
        if llm_summary:
            summary_text = llm_summary
            source = "gemini"
            model_id = used_model

    if not summary_text:
        if summary_data["atRisk"]:
            first = summary_data["atRisk"][0]
            summary_text = (
                f"{len(summary_data['atRisk'])} ingredient(s) are at or below reorder threshold — most urgent is "
                f"{first['name']} ({first['available']}{first['unit']} available vs {first['lowThreshold']}{first['unit']} threshold). "
                f"Review the {len(proposed_recs)} approval-gated recommendation(s) below; no stock or menu changes occur without manager approval."
            )
        else:
            top_drink = demand["demandLeaders"][0]["name"] if demand["demandLeaders"] else "Iced Oat Velvet Latte"
            summary_text = (
                f"All {summary_data['totalIngredients']} ingredients are above reorder thresholds. "
                f"Top current demand leader is {top_drink}. "
                f"Current operating mode: {demo_state['scenario'].upper()}."
            )

    return OpsInsightResponse(
        summary=summary_text,
        lowStockItems=summary_data["atRisk"],
        servingsAtRisk=servings_at_risk,
        demandLeaders=demand["demandLeaders"],
        proposedRecommendations=proposed_recs,
        toolEvidence=tool_evidence,
        source=source,  # type: ignore[arg-type]
        modelId=model_id,
        requiresManagerApproval=True,
        dataAsOf=now_iso,
    )
