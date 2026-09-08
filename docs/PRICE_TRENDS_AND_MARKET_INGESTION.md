# Dynamic E-Waste Price Trends & Market Ingestion Architecture
**Kabadiwala Connect (Reloop) — Smart India Hackathon (SIH Problem 229)**

---

## 1. Executive Summary

Informal waste collectors (*Kabadiwalas*) traditionally suffer from severe **information asymmetry**, receiving below-market rates for high-value electronic scrap (e-waste). To solve **SIH Problem 229**, our platform implements a **Dynamic Multi-Source Pricing & Nationwide Trend Analysis Engine**.

Rather than relying on static, single-city tables, the system synthesizes:
1. **Global & Domestic Commodity Scrap Indices** (LME Copper, MCX Wire, Gold extraction index, Lead/Lithium spot prices).
2. **Multi-Metro Regional Market Differentials** (9+ Indian industrial & aggregation hubs).
3. **Live Recycler-Offered Quoted Rates** (submitted directly by authorized recyclers).
4. **Historical Settled Transaction Feedback Loops** (actual completed transactions).

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           MULTI-SOURCE PRICING ENGINE                           │
└─────────────────────────────────────────────────────────────────────────────────┘
         │                                   │                           │
         ▼                                   ▼                           ▼
┌──────────────────┐               ┌──────────────────┐        ┌──────────────────┐
│ Global & MCX     │               │ Verified SPCB    │        │ Settled Handover │
│ Commodity Index  │               │ Recycler Quotes  │        │ Ledger Values    │
│ (LME, MCX, Spot) │               │ (/prices/ingest) │        │ (transactions)   │
└────────┬─────────┘               └────────┬─────────┘        └────────┬─────────┘
         │                                   │                           │
         └─────────────────┬─────────────────┴───────────────────────────┘
                           │
                           ▼
         ┌──────────────────────────────────────────────────┐
         │       Dynamic Regional Multiplier Engine         │
         │   (BLR, DEL, MUM, HYD, MAA, PNQ, CCU, AMD, JAI) │
         └─────────────────┬────────────────────────────────┘
                           │
                           ▼
         ┌──────────────────────────────────────────────────┐
         │               PostgreSQL Time-Series             │
         │     (`prices` table + `price_sources` registry)  │
         └─────────────────┬────────────────────────────────┘
                           │
         ┌─────────────────┴─────────────────┐
         ▼                                   ▼
┌─────────────────────────────────┐ ┌─────────────────────────────────┐
│   Instant Valuation Algorithm   │ │      Trend & Range Engine       │
│  (Recency-Weighted Moving Avg)  │ │   (High/Low Envelope + Chart)   │
│   GET /v1/valuation/instant     │ │      GET /v1/prices/trends      │
└─────────────────────────────────┘ └─────────────────────────────────┘
```

---

## 2. Core Pricing Data Sources & Methodology

### Source 1: Commodity Scrap Benchmarks & Value Drivers
Different e-waste fractions derive their intrinsic market scrap value from specific underlying recyclable commodities:

| Category | Scrap Item Subtypes | Underlying Commodity Benchmark Driver | Baseline Avg (₹/kg) | Volatility Band (₹/kg) |
| :--- | :--- | :--- | :--- | :--- |
| **`PCB`** | Motherboards, RAM, Server Boards, GPUs | **LME Copper spot + COMEX Gold extraction yield** | ₹380.00 | ₹320 – ₹460 |
| **`Cable`** | Heavy Gauge Copper, Data Wires, Mixed PVC | **MCX Copper Wire Scrap Grade-1 benchmark** | ₹320.00 | ₹270 – ₹390 |
| **`Battery`** | Li-Ion 18650, Lead-Acid UPS, NiMH packs | **Secondary Lead spot + Cobalt/Lithium index** | ₹160.00 | ₹110 – ₹220 |
| **`LCD`** | LED Monitors, LCD TVs, Laptop panels | **Indium Tin Oxide (ITO) + Polymer recovery** | ₹55.00 | ₹40 – ₹75 |
| **`CRT`** | Color & Monochrome CRT Glass & monitors | **Lead-glass cullet + Ferrous chassis scrap** | ₹18.00 | ₹12 – ₹26 |

---

### Source 2: Nationwide Regional Multipliers
Scrap prices vary significantly across Indian industrial clusters due to smelter proximity, transportation economics, port access, and aggregation density. The engine applies regional adjustments relative to the baseline:

```
                  Delhi NCR (+4%) [North Aggregation & Smelting Hub]
                         ▲
                         │
Ahmedabad (+2%) ◄───────┼───────► Kolkata (+1%) [Eastern Corridor]
[Metallurgy & Chemical]  │
                         │
  Mumbai (+3%) ◄─────────┼─────────► Hyderabad (-1%) [IT Supply Hub]
  [Port & Export Access] │
                         │
   Pune (+2%) ◄──────────┼─────────► Chennai (-2%) [Auto/Manufacturing]
   [Auto Corridor]       │
                         ▼
             Bengaluru (1.00 Base) [Tech Corridor]
```

- **Delhi NCR (+4%)**: Massive secondary smelting capacity in Mayapuri, Okhla, and Western UP; strong high-volume pickup demand.
- **Mumbai (+3%)**: High export accessibility and coastal scrap processing infrastructure.
- **Ahmedabad (+2%) & Pune (+2%)**: Heavy industrial machinery and automobile manufacturing clusters consuming secondary copper and lead.
- **Bengaluru (1.00)**: Baseline hub with steady electronics supply and certified R2/SPCB authorized facilities.
- **Kolkata (+1%)**: Primary eastern aggregation and sorting hub.
- **Hyderabad (-1%) & Chennai (-2%)**: Abundant local electronics generation with local processing spreads.

---

### Source 3: Direct Recycler Quotes & Ingestion API
Authorized recyclers update their specific purchase rates via the Portal or the bulk ingestion API (`POST /v1/prices/ingest/bulk`):
- Each recycler can quote a specific rate per material and location.
- The recycler's quote is stored with their `recycler_id`.
- Recycler quotes introduce competition: higher-bidding recyclers receive higher **Suitability Match Scores (32% Price Weight)** in the collector recommendation engine.

---

### Source 4: Real Settled Handover Transactions
When a lot is handed over and confirmed:
- `transactions.final_price` captures the verified, executed transaction price.
- This closed-loop transaction data feeds back into the pricing model to prevent synthetic price drift.

---

## 3. Database Architecture & Time-Series Modeling

The `prices` table in PostgreSQL is designed for fast time-series queries, dual-tier market/recycler separation, and conflict-free ingestion:

```sql
CREATE TABLE prices (
    id SERIAL PRIMARY KEY,
    material_category VARCHAR(50) NOT NULL,
    location VARCHAR(50) NOT NULL,
    price_date DATE NOT NULL,
    buying_price NUMERIC(10,2) NOT NULL,
    quoted_price NUMERIC(10,2),
    unit VARCHAR(20) DEFAULT 'per_kg',
    recycler_id INTEGER REFERENCES recyclers(id),
    market_range_low NUMERIC(10,2),
    market_range_high NUMERIC(10,2),
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT prices_category_location_date_recycler_unique 
        UNIQUE (material_category, location, price_date, recycler_id)
);
```

### Key Schema Characteristics
1. **Dual Storage Strategy**:
   - `recycler_id IS NULL`: General market benchmark price for that day and city.
   - `recycler_id = 123`: Specific offered rate by Recycler 123.
2. **Deterministic Upsert**: The unique constraint allows daily rate synchronization using `ON CONFLICT DO UPDATE` without creating duplicate records.
3. **Market Envelope Bounds**: `market_range_low` and `market_range_high` store the upper and lower bounds for volatility tracking and anomaly detection.

---

## 4. Mathematical Algorithms & Trend Calculations

### A. Instant Valuation Algorithm (Recency-Weighted Moving Average)
When a collector enters a material category and weight, the valuation engine in `backend/src/services/valuation.service.js` queries the 10 most recent price points:

$$\text{Weight}_i = n + 1 - \text{Rank}_i \quad (\text{where Rank 1 is the most recent record})$$

$$\text{Unit Price} = \frac{\sum_{i=1}^{n} (\text{Price}_i \times \text{Weight}_i)}{\sum_{i=1}^{n} \text{Weight}_i}$$

$$\text{Estimated Lot Value} = \text{Unit Price} \times \text{Weight (kg)}$$

This algorithm ensures that single-day commodity spikes or outdated rates do not distort the collector's payout estimate.

---

### B. Trend Statistics & Volatility Percentage
In `frontend/src/collector/PriceDiscovery.jsx`, historical trends over 30, 60, or 90 days compute:

$$\Delta\% = \left( \frac{P_{\text{latest}} - P_{\text{initial}}}{P_{\text{initial}}} \right) \times 100$$

- **Min / Max / Average**: Computed dynamically across the selected time horizon.
- **Confidence Envelope**: Shaded bands on the chart represent the historical `[market_range_low, market_range_high]` range.

---

## 5. API Reference & Ingestion Endpoints

### 1. `GET /v1/prices/trends`
Retrieves daily price history for charts and trend tracking.
- **Parameters**: `category` (e.g., `PCB`), `location` (e.g., `Delhi`), `days` (e.g., `90`).
- **Response**:
```json
{
  "success": true,
  "data": [
    {
      "price_date": "2026-06-10",
      "buying_price": "395.20",
      "market_range_low": "367.50",
      "market_range_high": "426.80",
      "unit": "per_kg"
    }
  ]
}
```

---

### 2. `GET /v1/prices/market-pulse`
Returns live scrap commodity indicators, active drivers, and regional demand levels.
- **Parameters**: `location` (e.g., `Mumbai`).
- **Response**:
```json
{
  "success": true,
  "location": "Mumbai",
  "market_status": "Active (Live Benchmarked)",
  "data": [
    {
      "category": "PCB",
      "name": "Printed Circuit Boards (PCBs)",
      "current_price": 391.40,
      "commodity_driver": "Copper (LME) + Gold extraction index",
      "regional_demand": "High",
      "hub": "Western Port Hub"
    }
  ]
}
```

---

### 3. `POST /v1/prices/refresh-market`
Triggers synchronization of dynamic multi-city prices with the latest commodity benchmarks.
- **Body**: `{ "days": 90 }`
- **Response**:
```json
{
  "success": true,
  "message": "Market prices refreshed successfully across all Indian metro hubs"
}
```

---

### 4. `GET /v1/valuation/instant`
Calculates instant estimated lot value for collectors.
- **Parameters**: `category=PCB&location=Bengaluru&weight=25.5`
- **Response**:
```json
{
  "success": true,
  "data": {
    "estimated_value": 9690.00,
    "unit_price": 380.00,
    "unit": "per_kg",
    "market_range_low": 353.40,
    "market_range_high": 410.40,
    "weight_kg": 25.5,
    "category": "PCB",
    "location": "Bengaluru",
    "price_samples": 10
  }
}
```

---

## 6. Frontend Visualization & Accessibility Features

1. **Interactive Line Chart**:
   - Built with **Chart.js** & **react-chartjs-2**.
   - Displays actual buying prices alongside dashed boundaries for `Market High` and `Market Low`.
2. **Text-to-Speech (TTS) Voice Broadcast**:
   - Integrated Web Speech API (`SpeechSynthesisUtterance`) with Indian English / Hindi locale (`en-IN`, `hi-IN`).
   - Reads current scrap price, weight rate, and percentage change aloud for informal collectors.
3. **One-Click Live Sync**:
   - **"⚡ Sync Live Market Rates"** button triggers live refresh across all metro cards and graphs simultaneously.

---

## 7. Data Governance & Anomaly Detection (SIH Evaluation Metric)

To comply with the SIH requirement of treating data as an active, governed asset:
- **Price Provenance Registry**: Tracked in `price_sources` table with timestamps, publisher entity, and verification source.
- **Outlier Filtering**: Any recycler quote exceeding $\pm 35\%$ of the rolling commodity index triggers an anomaly warning (`/v1/anomaly/check`), preventing predatory undercutting or fake pricing in the marketplace.
