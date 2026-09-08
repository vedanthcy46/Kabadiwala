# Kabadiwala Connect — Updated Deliverables

**New role split:**
- **Yashas** — Database & Datasets + Pitch Deck (PPT)
- **Vedanth** — Backend (APIs & Business Logic)
- **Tanush** — Frontend (Collector-facing + Recycler-facing, full UI)

**Getting started (run the backend + connect a frontend):** see
[`backend/docs/RUNNING.md`](backend/docs/RUNNING.md) — exact Postgres +
migrate + seed + start steps, the `/v1` base URL, CORS, and a Vite proxy snippet.
API reference: [`backend/docs/API.md`](backend/docs/API.md).
Pricing & Ingestion Engine: [`docs/PRICE_TRENDS_AND_MARKET_INGESTION.md`](docs/PRICE_TRENDS_AND_MARKET_INGESTION.md).

---

## YASHAS — Database & Datasets + PPT

### 1. Database Schema & Datasets
*(PS: "Dataset Requirements" section — explicit, detailed spec)*
Design and implement all 6 required datasets as real tables:
- **Material Dataset** — category, sub-category, description, image, approx. weight, condition, source type, estimated value
- **Price Dataset** — material category, location, date/time, buying price, quoted/selling price, unit, recycler/aggregator, historical price
- **Recycler Dataset** — name, location, materials accepted, authorization status/details, contact, offered rate, pickup availability, service area
- **Transaction Dataset** — lot ID, collector ID, material category, quantity/weight, quoted price, final price, recycler ID, collection/handover location, date/time, payment status, transaction status
- **Traceability Dataset** — lot ID, photographs, weight, timestamp, GPS, handover reference number, recycler confirmation, subsequent status
- **Collector Dataset** — minimal profile: collector ID, preferred language, general operating location, transaction/earnings history (avoid excess personal data, per spec)

### 2. Seed Data
**Deliverable:**
- 8-10 realistic recycler records (mixed authorization status, varied rates/locations)
- 30-40 historical price records across 6+ material categories with real day-to-day variation (not flat numbers — needed for trend charts and valuation logic to look genuine)

### 3. AI/ML Dataset Documentation
*(PS: explicitly requires teams to "clearly identify the source, quality, size, and limitations" of the AI/ML training dataset)*
**Deliverable:** A short written document covering where any ML-relevant data comes from, how much there is, and its known limitations — this is judged content, not just a technical nice-to-have.

### 4. Dataset Governance Write-Up
*(PS: "demonstrate how the dataset is generated, stored, validated, updated, and used... rather than treating the dataset as a static database")*
**Deliverable:** Short explanation of validation/update logic — be ready to answer this directly if a judge asks.

### 5. Pitch Deck (PPT)
**Deliverable:** Full presentation covering:
- Problem (informal collectors' exclusion from formal recycling)
- The gap (informational + institutional, not just technological — per PS background)
- Solution walkthrough (tied to what Tanush actually builds)
- Live demo moment (coordinate exact flow with Tanush before finalizing slides)
- Unit-economics summary slide (coordinate with whoever owns field research/econ numbers)
- Impact/closing

**Note:** Since dataset work usually finishes before frontend/backend are fully done, build the PPT skeleton early and fill in demo screenshots/numbers as they become available — don't leave it until the last two days.

---

## VEDANTH — Backend (APIs & Business Logic)

### 1. Instant Valuation Logic
*(PS: "enter approximate weight, and receive an instant value estimate")*
**Deliverable:** API endpoint calculating real value estimates from Yashas's price dataset (material + location + weight) — genuine calculation, not fixed/random.

### 2. Price Trend API
*(PS: "identify basic price trends")*
**Deliverable:** Endpoint returning aggregated historical price data for Tanush's trend chart.

### 3. Recycler Matching Engine
*(PS: "identify and rank suitable authorized recyclers... based on location, material category, offered rate, pickup availability, and authorization status")*
**Deliverable:**
- Filter to `authorization_status = authorized` only
- Filter to recyclers accepting the lot's material category
- Real distance calculation (Haversine formula)
- Ranking logic combining distance + rate + pickup availability

### 4. Handover & Traceability Logic
*(PS: "digital and verifiable handover/transfer record containing photographs, weight, timestamp, GPS/location details, and a unique reference that can be confirmed by the recycler")*
**Deliverable:**
- Unique handover reference generation
- Recycler confirmation endpoint (status: pending → confirmed) with audit trail

### 5. Recycler Profile APIs
**Deliverable:** CRUD endpoints for recycler profile management (used by Tanush's recycler interface).

### 6. Anomaly Detection
*(PS: "identification of abnormal or inconsistent transaction values, wherever sufficient training data is available")*
**Deliverable:** Statistical outlier check flagging transactions significantly outside a material's typical price range.

### 7. Offline Sync Backend
*(PS: "operate in low-connectivity environments... synchronized when connectivity becomes available")*
**Deliverable:** Batch endpoint accepting offline-queued records from Tanush's frontend, handling duplicate-submission safely.

### 8. Payment Status Logic
*(PS: "Allow cash-based transactions while keeping digital payment optional and not making it a prerequisite")*
**Deliverable:** Transaction/payment fields treating cash as default — digital payment stays genuinely optional in the data model.

---

## TANUSH — Frontend (Full UI — Collector + Recycler)

> **Before writing any UI code:** get the backend running and confirm you can hit
> the `/v1` endpoints (valuation, trends, matching). Follow
> [`backend/docs/RUNNING.md`](backend/docs/RUNNING.md). All responses wrap data
> in `{ success, data }`; see [`backend/docs/API.md`](backend/docs/API.md).

**Heads up before the list:** this is now the entire frontend scope for one person — collector app, recycler interface, traceability UI, multilingual support, and offline-first architecture. That's meaningfully more than what was previously split across two people. Flagging this now so you can prioritize deliberately rather than discover the crunch late. Suggested priority order is at the bottom.

### 1. Lot Creation Flow
*(PS: photo, categorize, weight, instant value estimate)*
- Photo capture/upload with preview
- Category/sub-category selector (exact PS material list: CRTs, LCD panels, PCBs, cables, batteries, motors/magnet-bearing assemblies, mixed plastics)
- Weight input
- Live instant-value display (calls Vedanth's API)

### 2. Price Discovery Board
*(PS: current rates, spoken price info, basic trends)*
- Price table/cards by material + location
- Trend chart (Recharts/Chart.js) from Vedanth's API
- Spoken price read-aloud (Web Speech API — explicit PS requirement)

### 3. Earnings Ledger
*(PS: transactions, payments, pending dues)*
- Transaction history, real totals from API data

### 4. Safety Guidance Page
*(PS: burning, unsafe battery/CRT handling — pictorial and/or audio)*
- Cover all three named hazards, with audio playback

### 5. Recycler Interface
*(PS: explicit required deliverable)*
- Recycler profile view/edit
- Incoming matched-lots dashboard

### 6. Matched Recycler Results Display
- Ranked recycler list shown to collector post-lot-creation

### 7. Handover & Traceability UI
- Collector: initiate handover, GPS capture, reference display
- Recycler: confirm-received action with live status update

### 8. Offline-First Architecture
*(PS: explicit requirement)*
- IndexedDB local storage, sync queue, connectivity-based auto-sync, real status indicator

### 9. Multilingual + Low-Literacy UI
*(PS: Hindi + Marathi minimum, genuinely usable for low-literacy users)*
- Apply across all screens above

### 10. Device Constraints
- Lean bundle size, entry-level Android performance consideration

---

## Suggested Priority Order for Tanush (given the scope concentration)
Given one person now owns all frontend, build in this order so that if time runs out, you cut from the bottom, not the middle:

1. Lot Creation + Price Board (core collector flow — must work)
2. Recycler Interface + Matching Display (core recycler flow — must work)
3. Handover & Traceability UI (required deliverable, judges will look for this specifically)
4. Earnings Ledger
5. Multilingual pass (can be partial if time-constrained — prioritize the two most-used screens first: Lot Creation and Price Board)
6. Offline-First Architecture (technically demanding — start early if possible, don't leave for the final days)
7. Safety Guidance Page
8. Spoken price/audio polish, device-size optimization

## Cross-Team Dependencies
| Tanush needs help from Vedanth | Vedanth needs from Yashas |
|---|---|
| Valuation, price-trend, matching, handover, recycler-CRUD, offline-sync APIs | Finalized schema + seeded data to build real logic against |

**Practical note:** Yashas finishing the schema and seed data early unblocks Vedanth immediately, who in turn unblocks Tanush — so the DB work genuinely sits on the critical path even though it looks like the "lighter" role on paper.
