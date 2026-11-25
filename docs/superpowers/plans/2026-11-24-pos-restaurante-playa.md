# POS Restaurante de Playa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete, offline-first beach restaurant POS (React + TypeScript + Vite + Tailwind + Capacitor Android + Firebase Firestore) with 10 tables and 18 beach toldos, three strictly isolated station views (Mesonero, Cocina, Caja/Admin), dual-currency USD/VES checkout, recipe-based ingredient inventory (escandallo), sales/operations analytics, and direct 80mm Wi-Fi ESC/POS thermal printing.

**Architecture:** Clean domain-driven frontend with pure TypeScript domain engines (`currency`, `recipes`, `analytics`, `escpos`), a decoupled `PosRepository` supporting both offline-first local persistence (`localStorage` + `BroadcastChannel` multi-tab live sync for instant browser testing) and Firebase Firestore (`persistentLocalCache`) for 3-tablet cloud sync, plus a serialized `PrintCoordinator` targeting Capacitor TCP:9100 ESC/POS on Android with a realistic 80mm preview modal on web.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS v4, Lucide React icons, Vitest + Testing Library, Firebase SDK v11, Capacitor Android (`@capacitor/core`, `@capacitor/android`).

**Spec:** `docs/superpowers/specs/2026-11-24-pos-restaurante-playa-design.md`

## Global Constraints

- Exact venue layout: **10 mesas** (`Mesa 1`..`Mesa 10`) and **18 toldos** (`Toldo 1`..`Toldo 18`) in two clear zones (`mesas`, `toldos`).
- Strict 3-role isolation via 4-digit PIN + station binding:
  - **Mesonero**: ONLY sees the 10 mesas + 18 toldos grid, order taking, item notes, status badges, and "Pedir cuenta". NEVER renders or exposes caja, totals of the day, cash close, inventory quantities, recipes, analytics, or settings.
  - **Cocina**: ONLY sees incoming kitchen comandas (FIFO, elapsed time warnings, `En preparación` -> `Listo`, void alerts, Reprint 80mm, 30-min recent history). NEVER shows prices, table grid, caja, inventory, or analytics.
  - **Caja / Admin**: Full access to floor grid with USD/Bs balances, checkout, cash close, recipe-based ingredient inventory, analytics, menu/users/rate/printer settings.
- Pricing & billing: Final all-inclusive USD prices (`totalUSD = sum(qty * priceUSD)`, `totalBs = totalUSD * exchangeRate`). Zero extra IVA, zero 10% service, zero IGTF, zero discounts/courtesies, single account per table/toldo (no split bills, no partial early deposits).
- Payment methods (mixed payments supported): `zelle` (USD), `efectivo_usd` (USD), `debito_punto` (VES), `efectivo_bs` (VES). Freeze `exchangeRate` on closed order and each payment. Estimated change shown visually only (no change-currency accounting).
- Cash close: Simple sales-based shift close (no opening float, no cash expenses/withdrawals), warns if tables/toldos remain open, breaks down totals by each of the 4 payment methods, prints 80mm summary.
- Recipe inventory (escandallo): 1-level recipes (`menuItem -> { ingredientId, quantity }`), units `g | kg | ml | L | unidad`, idempotent deduction by `comandaId` upon comanda confirmation, kardex movement history, void choice (**Devolver al inventario** vs **Merma**), low-stock alerts without blocking rush sales unless manually toggled **Agotado** (Mesoneros see `Agotado` badge only, never numeric stock).
- Non-kitchen items (`sendsToKitchen: false`): excluded from Cocina KDS and kitchen paper tickets; still added to order total and recipe inventory deduction.
- 80mm Wi-Fi printing: 48-column ESC/POS byte generator (Comanda, Anulación, Pre-cuenta, Cierre de Caja), idempotent `printJobId` preventing duplicates, Cocina serialized print coordinator + automatic LAN fallback when cloud offline.
- Visual craft (Operate mode): Outdoor-readable sunlit light theme (`#FAF8F4` canvas, `#0F2A36` ink, `#0E7490` ocean accent) for Mesonero & Caja, high-contrast dark slate (`#111827`) for Cocina KDS, `lucide-react` icons only (no emoji icon replacements), tabular numerals for money/stock/timers, monospace strictly for 80mm ticket preview, touch targets >= 48px, no decorative eyebrow kickers or thick colored card border stripes.

## Review Focus

1. **Duplicate comanda & inventory double-deduction on flaky beach Wi-Fi**: Re-submitting or syncing the same `comandaId` twice must never deduct recipe ingredients twice or print duplicate kitchen tickets. (Pinned in Tasks 2 & 3 tests.)
2. **Mixed-payment rounding & frozen exchange rate**: Paying partially in `efectivo_usd` and partially in `debito_punto` (Bs) with fractional cents must settle cleanly without floating-point remainder traps, and changing tomorrow's `exchangeRate` must never mutate past closed orders or cash closes. (Pinned in Task 1 tests.)
3. **Role leakage across views**: Logging in as Mesonero or Cocina must make it impossible to navigate to or render Caja, Cash Close, Inventory, Analytics, or Settings routes/panels; Mesonero must never see numeric stock levels or shift revenue. (Pinned in Task 4 & 5 UI tests.)
4. **Non-kitchen rounds & voided items**: A round containing only `sendsToKitchen: false` items (e.g. cold beers) must deduct inventory and update table balance without creating a Cocina KDS ticket; voiding a kitchen item must emit a Cocina `ANULACIÓN` alert/ticket and obey the `restock` vs `merma` choice accurately. (Pinned in Tasks 2 & 3 tests.)
5. **Cross-unit recipe math & negative stock handling**: Deducting `200 g` from an ingredient tracked in `kg` (or `200 g` from `g`) must compute accurately without unit bugs, and stock dropping below zero must record the true negative balance + trigger low-stock alert without crashing order submission. (Pinned in Task 2 tests.)

---

### Task 1: Project Scaffolding, Domain Types & Dual-Currency Checkout Engine

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/index.css`, `src/main.tsx`, `.gitignore`, `.env.example`
- Create: `src/types/pos.ts`
- Create: `src/domain/currency.ts`
- Test: `tests/domain/currency.test.ts`

**Interfaces:**
- Produces in `src/types/pos.ts`: `Role`, `Zone`, `LocationStatus`, `Location`, `Unit`, `Ingredient`, `RecipeLine`, `MenuCategory`, `MenuItem`, `OrderItem`, `ComandaStatus`, `PrintStatus`, `Comanda`, `VoidDisposition`, `PaymentMethod`, `PaymentEntry`, `Order`, `InventoryMovementType`, `InventoryMovement`, `Shift`, `UserProfile`, `PrinterConfig`, `AppSettings`, `PosState`
- Produces in `src/domain/currency.ts`:
  - `roundMoney(value: number): number`
  - `usdToBs(usd: number, rate: number): number`
  - `bsToUsd(bs: number, rate: number): number`
  - `calculateOrderTotalUsd(items: OrderItem[]): number`
  - `calculatePaymentSummary(totalUsd: number, payments: PaymentEntry[], rate: number): { paidUsd: number; remainingUsd: number; remainingBs: number; changeUsd: number; changeBs: number; isSettled: boolean }`
  - `summarizePaymentsByMethod(orders: Order[]): Record<PaymentMethod, { count: number; totalUsd: number; totalBs: number }>`

- [ ] **Step 1: Scaffold Vite + React + TypeScript + Tailwind v4 + Vitest + Lucide project & install deps**
  Create config files and run `npm install` (with `BypassSandbox: true` only if network is blocked).
- [ ] **Step 2: Define all domain types in `src/types/pos.ts`**
  Exact types covering 10 mesas + 18 toldos, 3 roles, 4 payment methods (`zelle`, `efectivo_usd`, `debito_punto`, `efectivo_bs`), 1-level recipes, ingredients (`g | kg | ml | L | unidad`), comandas, orders, shifts, print jobs, and settings.
- [ ] **Step 3: Write failing unit tests in `tests/domain/currency.test.ts`**
  Test `usdToBs`/`bsToUsd`, `calculateOrderTotalUsd` (ignoring voided items), `calculatePaymentSummary` with mixed USD + Bs payments including floating-point edge cases (`10.33` split across `efectivo_usd` + `debito_punto`), change calculation when overpaid, and `summarizePaymentsByMethod` proving frozen `exchangeRate` per order is never affected by later rate changes.
- [ ] **Step 4: Run `npx vitest run tests/domain/currency.test.ts` and verify RED failure**
- [ ] **Step 5: Implement `src/domain/currency.ts`**
- [ ] **Step 6: Run `npx vitest run tests/domain/currency.test.ts` and verify GREEN**
- [ ] **Step 7: Commit** (`feat: scaffold project, domain types and dual-currency engine`)

---

### Task 2: Recipe Inventory (Escandallo), Analytics Engine & 80mm ESC/POS Generator

**Files:**
- Create: `src/domain/recipes.ts`
- Create: `src/domain/analytics.ts`
- Create: `src/domain/escpos.ts`
- Test: `tests/domain/recipes.test.ts`
- Test: `tests/domain/analytics.test.ts`
- Test: `tests/domain/escpos.test.ts`

**Interfaces:**
- Consumes: `src/types/pos.ts`, `src/domain/currency.ts`
- Produces in `src/domain/recipes.ts`:
  - `convertUnitQuantity(amount: number, from: Unit, to: Unit): number`
  - `applyComandaRecipeDeductions(ingredients: Ingredient[], menu: MenuItem[], comanda: Comanda, existingMovements: InventoryMovement[]): { ingredients: Ingredient[]; newMovements: InventoryMovement[] }`
  - `applyVoidInventoryResolution(ingredients: Ingredient[], menu: MenuItem[], item: OrderItem, disposition: VoidDisposition, reason: string, userId: string, nowIso: string): { ingredients: Ingredient[]; newMovements: InventoryMovement[] }`
  - `getLowStockIngredients(ingredients: Ingredient[]): Ingredient[]`
- Produces in `src/domain/analytics.ts`:
  - `computeAnalytics(orders: Order[], movements: InventoryMovement[], ingredients: Ingredient[], users: UserProfile[], range: { fromIso: string; toIso: string }): AnalyticsReport`
- Produces in `src/domain/escpos.ts`:
  - `formatTicketText(payload: TicketPayload): string` (48-column plain-text preview)
  - `buildEscPosBytes(payload: TicketPayload): Uint8Array` (ESC/POS init, double-height header, ASCII/CP850 normalized lines, paper feed & GS V partial cut)

- [ ] **Step 1: Write failing tests for `recipes.ts`, `analytics.ts`, and `escpos.ts`**
  Cover: 200g meat + 1 bun hamburger deduction, cross-unit `g -> kg` and `ml -> L`, idempotent deduction when same `comandaId` is re-processed (Review Focus #1), negative stock allowed with low-stock alert (Review Focus #5), void `restock` vs `merma` (Review Focus #4), analytics top/bottom dishes, Mesas vs Toldos breakdown, peak hours, waiter sales, ingredient usage, and 48-col ESC/POS byte markers (`0x1B 0x40`, cut `0x1D 0x56`) for Comanda, Anulación, Pre-cuenta, and Cierre de Caja.
- [ ] **Step 2: Run `npx vitest run tests/domain/` and verify RED failure**
- [ ] **Step 3: Implement `src/domain/recipes.ts`, `src/domain/analytics.ts`, and `src/domain/escpos.ts`**
- [ ] **Step 4: Run `npx vitest run tests/domain/` and verify GREEN**
- [ ] **Step 5: Commit** (`feat: add recipe inventory, analytics and 80mm ESC/POS engines`)

---

### Task 3: Seed Data, Offline-First Repository, Firebase Adapter, Print Coordinator & Store

**Files:**
- Create: `src/services/seedData.ts`
- Create: `src/services/posRepository.ts`
- Create: `src/services/firebaseRepository.ts`
- Create: `src/services/printerService.ts`
- Create: `src/store/PosProvider.tsx`
- Test: `tests/services/posRepository.test.ts`
- Test: `tests/services/printerService.test.ts`

**Interfaces:**
- Consumes: `src/types/pos.ts`, `src/domain/currency.ts`, `src/domain/recipes.ts`, `src/domain/escpos.ts`
- Produces:
  - `createInitialPosState(): PosState` (10 Mesas, 18 Toldos, realistic beach menu with recipes & ingredients, 3 demo users: Mesonero PIN `1111`, Cocina PIN `2222`, Caja/Admin PIN `0000`)
  - `LocalPosRepository` implementing `PosRepository` (`submitComanda`, `updateComandaStatus`, `requestCheck`, `voidOrderItem`, `settleOrder`, `openShift`, `closeShift`, `adjustIngredientStock`, `saveMenuItem`, `toggleMenuOutOfStock`, `saveIngredient`, `updateExchangeRate`, `saveUser`, `savePrinterConfig`, `markPrintJob`, `resetDemoData`) with `localStorage` persistence, `BroadcastChannel` multi-tab sync, and simulated/real offline queue (`pendingSync`).
  - `FirebasePosRepository` implementing `PosRepository` using Firestore `persistentLocalCache` when `VITE_FIREBASE_API_KEY` is configured.
  - `PrintCoordinator` with serialized queue, `printJobId` idempotency, Capacitor TCP:9100 native bridge call, ISP-outage direct-LAN fallback (`printedLocally`), and web preview callback.
  - `usePos()` hook from `PosProvider.tsx`.

- [ ] **Step 1: Write failing tests in `tests/services/posRepository.test.ts` and `tests/services/printerService.test.ts`**
  Cover: 10 Mesas + 18 Toldos seeded, submitting comanda while offline queues with `pendingSync: true` and flushes idempotently on reconnect without double-deducting ingredients, non-kitchen round bypasses Cocina KDS while still deducting inventory & updating table total, voiding kitchen item emits `ANULACIÓN` print job + KDS alert and honors `restock` vs `merma`, closing order freezes exchange rate and marks location `libre`, print coordinator deduplicates `printJobId` and falls back to direct LAN when cloud offline.
- [ ] **Step 2: Run `npx vitest run tests/services/` and verify RED failure**
- [ ] **Step 3: Implement `seedData.ts`, `posRepository.ts`, `firebaseRepository.ts`, `printerService.ts`, and `PosProvider.tsx`**
- [ ] **Step 4: Run `npx vitest run` and verify all domain + service tests GREEN**
- [ ] **Step 5: Commit** (`feat: add offline-first repository, Firebase adapter and print coordinator`)

---

### Task 4: PIN Login Shell, Mesonero View (10 Mesas + 18 Toldos) & Cocina KDS View

**Files:**
- Create: `src/components/PinLoginScreen.tsx`
- Create: `src/components/StatusBanner.tsx`
- Create: `src/components/TicketPreviewModal.tsx`
- Create: `src/components/mesonero/MesoneroWorkspace.tsx`
- Create: `src/components/mesonero/OrderComposer.tsx`
- Create: `src/components/cocina/CocinaWorkspace.tsx`
- Test: `tests/ui/roleIsolation.test.tsx`

**Interfaces:**
- Consumes: `usePos()`, `formatTicketText()`
- Produces: Complete isolated Mesonero and Cocina interfaces plus reusable 80mm thermal ticket preview modal and PIN authentication screen.

- [ ] **Step 1: Write failing UI tests in `tests/ui/roleIsolation.test.tsx`**
  Test: PIN `1111` (Mesonero) renders 10 Mesas & 18 Toldos grid, allows taking an order with notes, shows `Agotado` badge on unavailable items, NEVER renders Caja, Cierre de Caja, Inventario, Estadísticas, or numeric stock counts; PIN `2222` (Cocina) renders ONLY incoming kitchen comandas (never prices, tables grid, caja, or inventory), allows marking `En preparación` -> `Listo` and clicking `Reimprimir 80mm`, and hides non-kitchen items.
- [ ] **Step 2: Run `npx vitest run tests/ui/roleIsolation.test.tsx` and verify RED failure**
- [ ] **Step 3: Implement `PinLoginScreen.tsx`, `StatusBanner.tsx`, `TicketPreviewModal.tsx`, `MesoneroWorkspace.tsx`, `OrderComposer.tsx`, and `CocinaWorkspace.tsx`** following Impeccable Operate-mode outdoor & KDS design rules (warm sunlight contrast for Mesonero, high-contrast dark slate for Cocina, `lucide-react` icons, >= 48px touch targets).
- [ ] **Step 4: Run `npx vitest run tests/ui/roleIsolation.test.tsx` and verify GREEN**
- [ ] **Step 5: Commit** (`feat: build PIN auth, Mesonero floor grid and Cocina KDS views`)

---

### Task 5: Caja / Admin Complete Suite & App Wiring

**Files:**
- Create: `src/components/caja/CajaLayout.tsx`
- Create: `src/components/caja/CajaFloorView.tsx`
- Create: `src/components/caja/CheckoutModal.tsx`
- Create: `src/components/caja/CashCloseView.tsx`
- Create: `src/components/caja/InventoryRecipesView.tsx`
- Create: `src/components/caja/AnalyticsView.tsx`
- Create: `src/components/caja/SettingsView.tsx`
- Modify: `src/App.tsx`, `src/main.tsx`, `index.html`, `src/index.css`
- Test: `tests/ui/cajaWorkflows.test.tsx`

**Interfaces:**
- Consumes: `usePos()`, `calculatePaymentSummary()`, `computeAnalytics()`, `getLowStockIngredients()`
- Produces: Complete Caja/Admin operational workspace wired into `App.tsx` with strict role router.

- [ ] **Step 1: Write failing UI integration tests in `tests/ui/cajaWorkflows.test.tsx`**
  Test: PIN `0000` (Caja/Admin) opens full workspace; settling a table with mixed `zelle` + `debito_punto` frees the table and updates Cash Close totals; viewing Inventory shows ingredient stock deducted by recipes and allows restock/recipe editing; Analytics shows top-selling dishes and Mesas vs Toldos breakdown; Settings updates daily VES exchange rate.
- [ ] **Step 2: Run `npx vitest run tests/ui/cajaWorkflows.test.tsx` and verify RED failure**
- [ ] **Step 3: Implement all 7 Caja/Admin views and wire `src/App.tsx`**
- [ ] **Step 4: Run full test suite (`npx vitest run`) and production build (`npm run build`) and verify GREEN**
- [ ] **Step 5: Commit** (`feat: build Caja/Admin billing, cash close, recipe inventory, analytics and settings`)

---

### Task 6: Firestore Security Rules (`firestore-rules-author`), Capacitor Android Config & Final E2E Verification

**Files:**
- Create: `firestore.rules` (MANDATORY: delegated to `firestore-rules-author` subagent)
- Create: `capacitor.config.ts`
- Create: `README.md` (clear Spanish guide: running locally, building Android APK with Capacitor, configuring 80mm Wi-Fi printer IP:9100, connecting Firebase)

- [ ] **Step 1: Delegate `firestore.rules` authoring to `firestore-rules-author` subagent**
  Enforce strict station-role isolation (`mesonero`, `cocina`, `caja-admin`) so Mesonero/Cocina cannot read or write `inventory`, `inventoryMovements`, `cashShifts`, `analytics`, or `settings/rate`.
- [ ] **Step 2: Add `capacitor.config.ts` and `README.md`**
- [ ] **Step 3: Run full test suite (`npx vitest run`) and TypeScript + Vite production build (`npm run build`)**
- [ ] **Step 4: Verify live running app visually across all 3 roles (Mesonero, Cocina, Caja/Admin) and commit** (`feat: add Firestore security rules, Capacitor Android config and docs`)
