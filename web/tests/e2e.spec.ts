import { test, expect } from "@playwright/test";

const STAFF_PASSCODE = process.env.DEMO_STAFF_PASSCODE || "aura-local-staff-2026";

test.describe("AURA — Full E2E Customer ↔ Inventory Connected Journeys", () => {
  test("1. Homepage loads fast with instant CTAs, 5-scene coffee physics narrative & real performance metrics", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const start = Date.now();
    await page.goto("/", { waitUntil: "load" });
    const loadMs = Date.now() - start;

    await expect(page.getByRole("heading", { level: 1 })).toContainText("AURA");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Every cup begins with understanding.");
    await expect(page.getByRole("link", { name: "Enter Your Café" }).first()).toBeVisible();
    await expect(page.getByText("More than coffee.")).toBeVisible();
    await expect(page.getByText("Every ingredient tells a story.")).toBeVisible();
    await expect(page.getByText("04 · Intelligent Inventory")).toBeVisible();
    await expect(page.getByText("One connected café.")).toBeVisible();

    await page.waitForTimeout(800);
    const perf = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      return {
        domContentLoaded: Math.round(nav?.domContentLoadedEventEnd || 0),
        loadEventEnd: Math.round(nav?.loadEventEnd || 0),
        hasCanvasOrFallback: Boolean(
          document.querySelector('[data-testid="hero-webgl-container"]') ||
            document.querySelector('[data-testid="hero-fallback-visual"]')
        ),
        stats3D: (window as unknown as { __AURA_3D_STATS__?: unknown }).__AURA_3D_STATS__ || null,
      };
    });
    expect(perf.hasCanvasOrFallback).toBe(true);
    console.log("PERF_HOME:", JSON.stringify({ loadMs, ...perf, pageErrors: errors }));

    // Enter Your Café CTA navigates immediately without waiting for scroll completion
    await page.getByRole("link", { name: "Enter Your Café" }).first().click();
    await expect(page).toHaveURL(/\/app/);
    await expect(page.getByRole("heading", { name: /What brings you in today/i })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("2. WebGL-disabled & reduced-motion fallback remains beautiful and operable", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        options?: unknown
      ) {
        if (type === "webgl" || type === "webgl2") return null;
        return orig.call(this, type as "2d", options as CanvasRenderingContext2DSettings);
      } as typeof orig;
    });

    await page.goto("/", { waitUntil: "load" });
    await expect(page.getByTestId("hero-fallback-visual")).toBeVisible();
    await expect(page.getByRole("link", { name: "Enter Your Café" }).first()).toBeVisible();
    await context.close();
  });

  test("3. Signature E2E: Customer Concierge -> Confirm Order -> Manager Sees & Marks Ready (Consume Once) -> Customer Sees Ready", async ({
    browser,
  }) => {
    const custContext = await browser.newContext();
    const staffContext = await browser.newContext();
    const custPage = await custContext.newPage();
    const staffPage = await staffContext.newPage();

    // A. Customer signs in as Ananya
    await custPage.goto("/login/", { waitUntil: "load" });
    await custPage.getByRole("button", { name: /Enter as Ananya/i }).click();
    await expect(custPage).toHaveURL(/\/app/);

    // B. Manager signs in as Meera with passcode
    await staffPage.goto("/login/", { waitUntil: "load" });
    await staffPage.getByLabel("Staff passcode").fill(STAFF_PASSCODE);
    await staffPage.getByRole("button", { name: /Enter as Meera/i }).click();
    await expect(staffPage).toHaveURL(/\/staff/);
    await expect(staffPage.getByRole("heading", { name: "Café Command Center" })).toBeVisible();

    // Verify customer cannot access /staff (403 gate)
    await custPage.goto("/staff/", { waitUntil: "load" });
    await expect(custPage.getByText(/403 · Staff Authorization Required/i)).toBeVisible();
    await custPage.goto("/app/", { waitUntil: "load" });

    // C. Customer asks AURA Concierge for signature cold oat under ₹250
    const input = custPage.locator("#concierge-input");
    await input.fill("I want something cold, not too sweet, dairy-free under ₹250, and I have 15 minutes.");
    await custPage.getByRole("button", { name: /Ask AURA/i }).click();
    await expect(custPage.getByText(/Explicit Confirmation Required/i)).toBeVisible({ timeout: 15000 });

    // D. Customer clicks Confirm Order & Reserve Stock
    await custPage.getByRole("button", { name: /Confirm Order & Reserve Stock/i }).click();
    await expect(custPage.getByText(/Order Confirmed!/i)).toBeVisible({ timeout: 15000 });
    await custPage.getByRole("link", { name: /Track Live Order/i }).click();
    await expect(custPage).toHaveURL(/\/app\/orders/);
    await expect(custPage.getByText(/Status: confirmed/i)).toBeVisible({ timeout: 15000 });

    // E. Manager sees the new order & advances Confirmed -> Preparing -> Ready (consumes stock once!)
    await staffPage.reload({ waitUntil: "load" });
    await expect(staffPage.getByText(/Ananya/i).first()).toBeVisible({ timeout: 15000 });
    await staffPage.getByRole("button", { name: /Mark Preparing/i }).first().click();
    await expect(staffPage.getByText(/moved to preparing/i)).toBeVisible({ timeout: 15000 });

    await staffPage.getByRole("button", { name: /Mark Ready \(Consume Stock\)/i }).first().click();
    await expect(staffPage.getByText(/reserved ingredients consumed once/i)).toBeVisible({ timeout: 15000 });

    // F. Customer sees live Ready status
    await custPage.reload({ waitUntil: "load" });
    await expect(custPage.getByText(/Status: ready/i)).toBeVisible({ timeout: 15000 });
    await expect(custPage.getByText(/Ingredients consumed on Ready/i)).toBeVisible();

    // G. Manager triggers Rush Hour & runs AI Ops Insights
    await staffPage.getByRole("button", { name: /rush/i }).click();
    await expect(staffPage.getByText(/Demo simulation switched to RUSH/i)).toBeVisible({ timeout: 15000 });

    await staffPage.goto("/staff/insights/", { waitUntil: "load" });
    await staffPage.getByRole("button", { name: /Analyze Operations/i }).click();
    await expect(staffPage.getByText(/Manager Approval Required/i)).toBeVisible({ timeout: 15000 });

    // H. Manager resets demo cleanly
    await staffPage.goto("/staff/", { waitUntil: "load" });
    await staffPage.getByRole("button", { name: /Reset Demo/i }).click();
    await expect(staffPage.getByText(/cleanly reset/i)).toBeVisible({ timeout: 15000 });

    await custContext.close();
    await staffContext.close();
  });

  test("4. Menu photography, Room floorplan & Responsive widths (390 / 768 / 1280 / 1440)", async ({ page }) => {
    await page.goto("/app/menu/", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: "Crafted Menu" })).toBeVisible();
    await expect(page.getByText("Iced Oat Velvet Latte")).toBeVisible({ timeout: 15000 });

    const brokenImgs = await page.evaluate(() =>
      Array.from(document.querySelectorAll("img")).filter((img) => !img.complete || img.naturalWidth === 0).length
    );
    expect(brokenImgs).toBe(0);

    await page.goto("/app/room/", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: "The Living Room" })).toBeVisible();
    await page.getByRole("button", { name: /Accessible List/i }).click();
    await expect(page.getByRole("table")).toBeVisible();

    for (const width of [390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/", { waitUntil: "load" });
      const homeOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(homeOverflow).toBeLessThanOrEqual(4);

      await page.goto("/app/", { waitUntil: "load" });
      const appOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(appOverflow).toBeLessThanOrEqual(4);
    }
  });
});
