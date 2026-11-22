from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from pydantic import BaseModel, Field, field_validator


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- Menu & Recipes ---

class RecipeRequirement(BaseModel):
    ingredientId: str
    qty: int = Field(..., gt=0, description="Integer base units per serving (ml, g, or each)")


class MenuModifier(BaseModel):
    id: str
    name: str
    priceDeltaPaise: int = 0
    recipeDeltas: list[RecipeRequirement] = Field(default_factory=list)
    replaceIngredientId: str | None = None


class MenuItem(BaseModel):
    id: str
    name: str
    description: str
    pricePaise: int = Field(..., gt=0)
    category: Literal["espresso", "cold_coffee", "signature", "tea_matcha", "bakery"]
    temperature: Literal["hot", "cold", "ambient"]
    sweetness: Literal["unsweetened", "lightly_sweet", "balanced", "sweet"]
    allergens: list[str] = Field(default_factory=list)
    dietaryTags: list[str] = Field(default_factory=list)
    recipe: list[RecipeRequirement]
    modifiers: list[MenuModifier] = Field(default_factory=list)
    active: bool = True
    prepWorkUnits: int = Field(..., ge=1, le=20)
    tastingNotes: list[str] = Field(default_factory=list)


class MenuItemWithAvailability(MenuItem):
    availableServings: int
    isAvailable: bool
    limitingIngredientId: str | None = None
    limitingIngredientName: str | None = None
    priceRupees: float


# --- Inventory ---

class Ingredient(BaseModel):
    id: str
    name: str
    category: Literal["beans", "milk", "syrup", "tea", "bakery", "packaging", "garnish"]
    unit: Literal["ml", "g", "each"]
    onHand: int = Field(..., ge=0)
    reserved: int = Field(0, ge=0)
    lowThreshold: int = Field(..., ge=0)
    updatedAt: str
    version: int = 1

    def available_units(self) -> int:
        return max(0, self.onHand - self.reserved)


class IngredientView(Ingredient):
    available: int
    status: Literal["healthy", "low", "critical", "out"]
    affectedDrinks: list[str] = Field(default_factory=list)


class InventoryEvent(BaseModel):
    id: str
    cafeId: str
    ingredientId: str
    ingredientName: str
    deltaOnHand: int
    deltaReserved: int
    eventType: Literal["reserve", "consume", "release", "restock", "adjust"]
    orderId: str | None = None
    actorId: str
    reason: str
    at: str


class RestockRequest(BaseModel):
    ingredientId: str
    deltaOnHand: int = Field(..., description="Positive for restock, negative for audited spoilage/shrinkage")
    reason: str = Field(..., min_length=3, max_length=240)
    expectedVersion: int | None = None


class ToggleMenuAvailabilityRequest(BaseModel):
    active: bool
    reason: str = Field(default="Staff availability update", max_length=200)


# --- Orders ---

OrderStatus = Literal["confirmed", "preparing", "ready", "collected", "cancelled"]


class OrderItemInput(BaseModel):
    menuItemId: str
    qty: int = Field(..., ge=1, le=10)
    selectedModifierIds: list[str] = Field(default_factory=list)


class OrderItemSnapshot(BaseModel):
    menuItemId: str
    name: str
    qty: int
    unitPricePaise: int
    lineTotalPaise: int
    selectedModifierIds: list[str] = Field(default_factory=list)
    selectedModifierNames: list[str] = Field(default_factory=list)
    recipeSnapshot: list[RecipeRequirement]


class Order(BaseModel):
    id: str
    cafeId: str
    userId: str
    customerName: str
    items: list[OrderItemSnapshot]
    totalPaise: int
    status: OrderStatus
    estimatedReadyAt: str
    etaMinMinutes: int
    etaMaxMinutes: int
    tableId: str | None = None
    reservationId: str | None = None
    idempotencyKey: str
    consumedAt: str | None = None
    cancelledAt: str | None = None
    notes: str | None = None
    createdAt: str
    updatedAt: str


class OrderEvent(BaseModel):
    id: str
    cafeId: str
    orderId: str
    fromStatus: str | None
    toStatus: OrderStatus
    actorId: str
    actorRole: str
    at: str
    reason: str


class PrepareApprovalRequest(BaseModel):
    items: list[OrderItemInput] = Field(..., min_length=1)
    tableId: str | None = None
    notes: str | None = Field(default=None, max_length=200)


class ApprovalPreviewResponse(BaseModel):
    approvalToken: str
    expiresAt: str
    items: list[OrderItemSnapshot]
    totalPaise: int
    totalRupees: float
    tableId: str | None = None
    etaMinMinutes: int
    etaMaxMinutes: int
    ingredientImpact: list[dict[str, Any]]
    warnings: list[str] = Field(default_factory=list)


class ConfirmOrderRequest(BaseModel):
    items: list[OrderItemInput] = Field(..., min_length=1)
    tableId: str | None = None
    notes: str | None = Field(default=None, max_length=200)
    idempotencyKey: str = Field(..., min_length=6, max_length=120)
    approvalToken: str = Field(..., min_length=10)


class OrderStatusUpdateRequest(BaseModel):
    status: OrderStatus
    reason: str = Field(default="Staff status update", max_length=200)


# --- Rooms & Seating ---

TableZone = Literal["quiet", "window", "social", "bar"]
TableStatus = Literal["free", "reserved", "occupied"]


class TableItem(BaseModel):
    id: str
    label: str
    zone: TableZone
    seats: int
    hasOutlet: bool
    status: TableStatus
    ambientNoiseDb: int
    noiseSource: Literal["simulated"] = "simulated"
    reservationId: str | None = None
    reservedByUserId: str | None = None
    reservationExpiresAt: str | None = None
    x: int
    y: int
    updatedAt: str


class Reservation(BaseModel):
    id: str
    cafeId: str
    tableId: str
    userId: str
    expiresAt: str
    state: Literal["active", "expired", "released", "completed"]
    createdAt: str


class ReserveTableRequest(BaseModel):
    tableId: str
    durationMinutes: int = Field(default=45, ge=15, le=180)
    approvalToken: str | None = None


# --- Opt-in People / Connect ---

class JoinRequestEntry(BaseModel):
    userId: str
    displayName: str
    note: str = ""
    requestedAt: str


class CommunitySession(BaseModel):
    id: str
    cafeId: str
    title: str
    description: str
    tags: list[str]
    hostId: str
    hostDisplayName: str
    zoneHint: TableZone
    meetingNoteForApproved: str = ""
    startTimeLabel: str
    joinPolicy: Literal["approval", "open"] = "approval"
    visibility: Literal["public", "hidden"] = "public"
    maxMembers: int = 6
    approvedMemberIds: list[str] = Field(default_factory=list)
    pendingRequests: list[JoinRequestEntry] = Field(default_factory=list)
    createdAt: str


class CreateSessionRequest(BaseModel):
    title: str = Field(..., min_length=3, max_length=80)
    description: str = Field(..., min_length=5, max_length=300)
    tags: list[str] = Field(default_factory=list, max_length=6)
    zoneHint: TableZone = "social"
    meetingNoteForApproved: str = Field(default="", max_length=160)
    startTimeLabel: str = Field(default="Starting soon", max_length=40)
    joinPolicy: Literal["approval", "open"] = "approval"
    maxMembers: int = Field(default=6, ge=2, le=12)


class JoinSessionRequest(BaseModel):
    note: str = Field(default="", max_length=160)


class DecideJoinRequest(BaseModel):
    targetUserId: str
    approve: bool


class CustomerPreferences(BaseModel):
    userId: str
    discoverableInConnect: bool = False
    interestTags: list[str] = Field(default_factory=list)
    dietaryPreferences: list[str] = Field(default_factory=list)
    defaultIntent: str | None = None
    consentGranted: bool = False
    updatedAt: str


class UpdatePreferencesRequest(BaseModel):
    discoverableInConnect: bool | None = None
    interestTags: list[str] | None = None
    dietaryPreferences: list[str] | None = None
    defaultIntent: str | None = None
    consentGranted: bool | None = None


# --- Operational Recommendations & Demo ---

class OperationalRecommendation(BaseModel):
    id: str
    cafeId: str
    type: Literal["restock", "substitute_promo", "waste_prevention", "queue_alert"]
    title: str
    rationale: str
    evidence: dict[str, Any]
    suggestedAction: str
    status: Literal["pending", "approved", "dismissed"] = "pending"
    source: Literal["gemini", "deterministic"] = "deterministic"
    createdAt: str
    decidedBy: str | None = None
    decidedAt: str | None = None


class DecideRecommendationRequest(BaseModel):
    decision: Literal["approved", "dismissed"]
    note: str = Field(default="", max_length=200)


class DemoState(BaseModel):
    cafeId: str
    scenario: Literal["calm", "rush", "low_stock"] = "calm"
    activeBaristas: int = 2
    workUnitsPerMinute: float = 2.0
    simulatedQueueWorkUnits: int = 0
    promoBanner: str | None = None
    updatedAt: str
    label: str = "Demo simulation"


class SetDemoScenarioRequest(BaseModel):
    scenario: Literal["calm", "rush", "low_stock"]


# --- Agents ---

class VisitPlanRequest(BaseModel):
    message: str = Field(..., min_length=2, max_length=600)
    intent: str | None = None
    maxBudgetRupees: int | None = Field(default=None, ge=50, le=5000)
    readyWithinMinutes: int | None = Field(default=None, ge=3, le=120)
    dietaryTags: list[str] = Field(default_factory=list)
    excludeAllergens: list[str] = Field(default_factory=list)
    needsSeat: bool | None = None
    needsOutlet: bool | None = None
    quietPreferred: bool | None = None
    cafeId: str | None = None

    @field_validator("message")
    @classmethod
    def strip_msg(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Message cannot be empty")
        return cleaned


class RecommendedDrink(BaseModel):
    menuItemId: str
    name: str
    pricePaise: int
    priceRupees: float
    availableServings: int
    why: str
    dietaryTags: list[str]
    allergens: list[str]
    category: str
    temperature: str


class RecommendedSeat(BaseModel):
    tableId: str
    label: str
    zone: str
    hasOutlet: bool
    ambientNoiseDb: int
    why: str


class VisitPlanResponse(BaseModel):
    intent: str
    summary: str
    constraints: dict[str, Any]
    recommendations: list[RecommendedDrink]
    alternativeSuggestions: list[RecommendedDrink] = Field(default_factory=list)
    seat: RecommendedSeat | None = None
    eta: dict[str, Any]
    proposedCart: list[OrderItemInput] = Field(default_factory=list)
    approvalPreview: ApprovalPreviewResponse | None = None
    requiresApproval: bool = True
    toolEvidence: list[dict[str, Any]] = Field(default_factory=list)
    source: Literal["gemini", "deterministic", "error"]
    modelId: str | None = None
    warnings: list[str] = Field(default_factory=list)
    dataAsOf: str


class OpsInsightRequest(BaseModel):
    question: str = Field(..., min_length=2, max_length=500)
    cafeId: str | None = None


class OpsInsightResponse(BaseModel):
    summary: str
    lowStockItems: list[dict[str, Any]]
    servingsAtRisk: list[dict[str, Any]]
    demandLeaders: list[dict[str, Any]]
    proposedRecommendations: list[OperationalRecommendation]
    toolEvidence: list[dict[str, Any]] = Field(default_factory=list)
    source: Literal["gemini", "deterministic", "error"]
    modelId: str | None = None
    requiresManagerApproval: bool = True
    dataAsOf: str
