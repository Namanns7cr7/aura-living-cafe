export type UserRole = "guest" | "customer" | "barista" | "manager";

export interface AuthUser {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  cafeId: string;
  isDemo: boolean;
}

export interface RecipeRequirement {
  ingredientId: string;
  qty: number;
}

export interface MenuModifier {
  id: string;
  name: string;
  priceDeltaPaise: number;
  recipeDeltas: RecipeRequirement[];
  replaceIngredientId?: string | null;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  pricePaise: number;
  priceRupees: number;
  category: "espresso" | "cold_coffee" | "signature" | "tea_matcha" | "bakery";
  temperature: "hot" | "cold" | "ambient";
  sweetness: "unsweetened" | "lightly_sweet" | "balanced" | "sweet";
  allergens: string[];
  dietaryTags: string[];
  recipe: RecipeRequirement[];
  modifiers: MenuModifier[];
  active: boolean;
  prepWorkUnits: number;
  tastingNotes: string[];
  availableServings: number;
  isAvailable: boolean;
  limitingIngredientId?: string | null;
  limitingIngredientName?: string | null;
}

export interface TableItem {
  id: string;
  label: string;
  zone: "quiet" | "window" | "social" | "bar";
  seats: number;
  hasOutlet: boolean;
  status: "free" | "reserved" | "occupied";
  ambientNoiseDb: number;
  noiseSource: "simulated";
  reservationExpiresAt?: string | null;
  reservedByMe?: boolean;
  x: number;
  y: number;
  updatedAt: string;
}

export interface IngredientFlowNode {
  id: string;
  label: string;
  servingsEstimate: number;
  healthRatio: number;
  status: "healthy" | "low" | "out";
}

export interface EtaEstimate {
  minMinutes: number;
  maxMinutes: number;
  estimatedReadyAt: string;
  queuedOrders: number;
  queuedWorkUnits: number;
  currentOrderWorkUnits: number;
  activeBaristas: number;
  source: string;
  scenario: "calm" | "rush" | "low_stock";
  isSimulatedLoad: boolean;
  disclaimer: string;
}

export interface CafeOverview {
  cafeId: string;
  availableMenuCount: number;
  totalMenuCount: number;
  freeSeatsCount: number;
  totalTablesCount: number;
  activeQueueCount: number;
  etaEstimate: EtaEstimate;
  lowStockAlertCount: number;
  ingredientFlowNodes: IngredientFlowNode[];
  scenario: "calm" | "rush" | "low_stock";
  scenarioLabel: string;
  promoBanner?: string | null;
  dataAsOf: string;
}

export interface OrderItemInput {
  menuItemId: string;
  qty: number;
  selectedModifierIds: string[];
}

export interface OrderItemSnapshot {
  menuItemId: string;
  name: string;
  qty: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  selectedModifierIds: string[];
  selectedModifierNames: string[];
  recipeSnapshot: RecipeRequirement[];
}

export interface ApprovalPreview {
  approvalToken: string;
  expiresAt: string;
  items: OrderItemSnapshot[];
  totalPaise: number;
  totalRupees: number;
  tableId?: string | null;
  etaMinMinutes: number;
  etaMaxMinutes: number;
  ingredientImpact: {
    ingredientId: string;
    ingredientName: string;
    required: number;
    unit: string;
    availableBefore: number;
    availableAfter: number;
  }[];
  warnings: string[];
}

export interface Order {
  id: string;
  cafeId: string;
  userId: string;
  customerName: string;
  items: OrderItemSnapshot[];
  totalPaise: number;
  status: "confirmed" | "preparing" | "ready" | "collected" | "cancelled";
  estimatedReadyAt: string;
  etaMinMinutes: number;
  etaMaxMinutes: number;
  tableId?: string | null;
  reservationId?: string | null;
  idempotencyKey: string;
  consumedAt?: string | null;
  cancelledAt?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderEvent {
  id: string;
  orderId: string;
  fromStatus?: string | null;
  toStatus: string;
  actorId: string;
  actorRole: string;
  at: string;
  reason: string;
}

export interface RecommendedDrink {
  menuItemId: string;
  name: string;
  pricePaise: number;
  priceRupees: number;
  availableServings: number;
  why: string;
  dietaryTags: string[];
  allergens: string[];
  category: string;
  temperature: string;
}

export interface RecommendedSeat {
  tableId: string;
  label: string;
  zone: string;
  hasOutlet: boolean;
  ambientNoiseDb: number;
  why: string;
}

export interface VisitPlanResponse {
  intent: string;
  summary: string;
  constraints: Record<string, unknown>;
  recommendations: RecommendedDrink[];
  alternativeSuggestions: RecommendedDrink[];
  seat?: RecommendedSeat | null;
  eta: EtaEstimate;
  proposedCart: OrderItemInput[];
  approvalPreview?: ApprovalPreview | null;
  requiresApproval: boolean;
  toolEvidence: Record<string, unknown>[];
  source: "gemini" | "deterministic" | "error";
  modelId?: string | null;
  warnings: string[];
  dataAsOf: string;
}

export interface IngredientView {
  id: string;
  name: string;
  category: string;
  unit: "ml" | "g" | "each";
  onHand: number;
  reserved: number;
  available: number;
  lowThreshold: number;
  status: "healthy" | "low" | "critical" | "out";
  affectedDrinks: string[];
  updatedAt: string;
  version: number;
}

export interface InventoryEvent {
  id: string;
  ingredientId: string;
  ingredientName: string;
  deltaOnHand: number;
  deltaReserved: number;
  eventType: "reserve" | "consume" | "release" | "restock" | "adjust";
  orderId?: string | null;
  actorId: string;
  reason: string;
  at: string;
}

export interface OperationalRecommendation {
  id: string;
  type: "restock" | "substitute_promo" | "waste_prevention" | "queue_alert";
  title: string;
  rationale: string;
  evidence: Record<string, unknown>;
  suggestedAction: string;
  status: "pending" | "approved" | "dismissed";
  source: "gemini" | "deterministic";
  createdAt: string;
  decidedBy?: string | null;
  decidedAt?: string | null;
}

export interface CommunitySessionView {
  id: string;
  title: string;
  description: string;
  tags: string[];
  hostDisplayName: string;
  zoneHint: string;
  startTimeLabel: string;
  joinPolicy: "approval" | "open";
  maxMembers: number;
  memberCount: number;
  isHost: boolean;
  isApprovedMember: boolean;
  isPending: boolean;
  meetingNote?: string | null;
  pendingRequests: { userId: string; displayName: string; note: string; requestedAt: string }[];
  createdAt: string;
}

export interface OpsInsightResponse {
  summary: string;
  lowStockItems: Record<string, unknown>[];
  servingsAtRisk: { menuItemId: string; name: string; availableServings: number; limitingIngredient?: string | null }[];
  demandLeaders: { menuItemId: string; name: string; unitsOrdered: number; revenueRupees: number }[];
  proposedRecommendations: OperationalRecommendation[];
  toolEvidence: Record<string, unknown>[];
  source: "gemini" | "deterministic" | "error";
  modelId?: string | null;
  requiresManagerApproval: boolean;
  dataAsOf: string;
}
