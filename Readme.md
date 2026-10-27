# ♻️ E-Setu
### Connecting Scrap Collectors to Authorized Recyclers Through Transparency and Technology

E-Setu is a digital platform designed to connect informal scrap collectors (kabadiwalas), authorized recyclers, and administrators through a transparent, traceable, and efficient recycling ecosystem.

The platform helps scrap collectors discover competitive prices for recyclable materials, connect with suitable recyclers, compare offers, and maintain digital transaction records. It also provides recyclers with a structured way to discover available scrap materials and enables administrators to monitor transactions, verify recyclers, and investigate suspicious activities.

Our goal is to transform the informal scrap collection process into a more transparent, accessible, and accountable digital ecosystem.

---

## 📌 Table of Contents

- [Problem Statement](#-problem-statement)
- [Our Solution](#-our-solution)
- [Objectives](#-objectives)
- [How E-Setu Works](#-how-e-setu-works)
- [User Roles](#-user-roles)
- [Core Features](#-core-features)
- [Pricing and Valuation](#-pricing-and-valuation)
- [QR-Based Transaction Verification](#-qr-based-transaction-verification)
- [Anomaly Detection](#-anomaly-detection)
- [System Architecture](#-system-architecture)
- [Data Flow](#-data-flow)
- [Technology Stack](#-technology-stack)
- [Expected Impact](#-expected-impact)
- [Future Enhancements](#-future-enhancements)

---

## 🚨 Problem Statement

Informal scrap collectors play an important role in recovering recyclable materials from households, commercial establishments, and local markets.

However, the traditional scrap collection ecosystem faces several challenges.

### 1. Uncertain Scrap Prices

Collectors may not have access to reliable market price information. As a result, they may struggle to determine whether the price offered by a buyer is competitive.

### 2. Limited Access to Recyclers

Individual collectors often depend on nearby scrap dealers or personal contacts. Finding suitable authorized recyclers and comparing offers can be difficult.

### 3. Lack of Transaction Transparency

Material weights, agreed prices, final settlement amounts, and transaction details may not be consistently documented.

### 4. Limited Bargaining Power

Collectors handling small quantities may have difficulty accessing multiple buyers or negotiating competitive prices.

### 5. Weak Traceability

Without structured digital records, investigating disputes involving material quality, weight differences, or pricing can be difficult.

### 6. Recycler Verification Challenges

Collectors need a more reliable way to identify recyclers whose authorization and registration status have been checked.

### 7. Limited Digital Accessibility

Some collectors may experience unreliable internet connectivity or have limited experience using complex digital platforms.

### The Core Problem

There is a need for a connected platform that improves price discovery, buyer access, transaction verification, and traceability while remaining accessible to informal scrap collectors.

---

## 💡 Our Solution

E-Setu acts as a digital bridge between scrap collectors and authorized recyclers.

It combines material listing, AI-assisted classification, price discovery, competitive offers, QR-based handover verification, digital transaction records, and administrative monitoring into one platform.

Instead of relying entirely on informal negotiations, collectors can use E-Setu to:

1. Register and create a collector profile.
2. Record the recyclable materials they want to sell.
3. Receive classification assistance and an estimated valuation.
4. Discover suitable recyclers.
5. Request offers or receive competitive quotes.
6. Compare offers and select a preferred buyer.
7. Verify the physical handover using a QR-based workflow.
8. Record the final weight and calculate the settlement amount.
9. Maintain a traceable record of the transaction.

Recyclers can discover available material lots, submit offers, and coordinate pickups.

Administrators can review recycler registrations, monitor platform activity, and investigate unusual pricing or weight discrepancies.

---

## 🎯 Objectives

- Improve scrap price transparency.
- Help collectors discover competitive buyer offers.
- Connect collectors with suitable authorized recyclers.
- Simplify scrap listing and pickup coordination.
- Maintain digital records of material handovers.
- Improve traceability of agreed prices, measured weights, and final settlements.
- Identify potentially suspicious transaction patterns.
- Support a more efficient and accountable recycling ecosystem.
- Design the platform to accommodate unreliable internet connectivity.

---

## 🔄 How E-Setu Works

The complete workflow consists of the following stages.

### Step 1: Collector Registration

A scrap collector registers on the platform and creates a profile.

The profile may contain:

- Name and contact details.
- Collection location.
- GPS coordinates, when available and permitted.
- Account and verification status.
- Transaction history.

The collector can then access the material listing and transaction management features.

### Step 2: Create a Material Lot

The collector creates a lot representing the recyclable materials available for sale.

A lot can contain:

- Material category.
- Material subtype.
- Photographs of the materials.
- Estimated weight.
- Material condition and other relevant details.
- Collection location.
- Estimated value.
- Lot creation timestamp.

For example:

    Material: Scrap Plastic
    Subcategory: PET Bottles
    Estimated Weight: 25 kg
    Location: Bengaluru
    Status: Available

The lot becomes the primary record used to connect the collector with potential buyers.

### Step 3: AI-Assisted Material Classification

E-Setu can use image-based classification to assist with identifying recyclable materials.

The collector captures or uploads an image of the scrap.

The classification component analyzes the image and returns a predicted material category.

Example:

    Input: Image of recyclable plastic bottles

    Predicted Category: Plastic
    Suggested Subcategory: PET Bottles
    Confidence: Model-dependent

The classification result assists the listing process but should not be treated as a guaranteed identification of material composition or quality.

The collector should be able to review and correct the suggested category.

**Important:** Image classification alone cannot reliably determine the actual weight, purity, or complete composition of a material lot.

If offline classification is supported by the deployed implementation, the model can run locally and synchronize relevant records when connectivity returns.

### Step 4: Price Discovery and Estimated Valuation

E-Setu estimates the potential value of a material lot using available reference prices and relevant lot details.

The valuation process can consider:

- Material category.
- Material subtype.
- Estimated weight.
- Available reference prices.
- Applicable location-specific pricing data.
- Material quality, where sufficient information is available.

A basic valuation formula is:

    Estimated Value = Estimated Weight × Reference Price per kg

For example, if the estimated weight is 25 kg and the reference price is ₹20/kg:

    Estimated Value = 25 × ₹20
                    = ₹500

This is an illustrative calculation, not a guaranteed selling price.

The estimated value provides a reference for the collector. The final price depends on the actual material, buyer offer, agreed terms, and measured weight.

Reference prices should include their source and update time wherever possible.

### Step 5: Find Suitable Recyclers

The platform identifies potentially suitable recyclers for each material lot.

Matching can consider:

- Material compatibility.
- Recycler authorization status.
- Offered price.
- Distance from the collection location.
- Recycler reliability.
- Pickup availability.

An example matching score is:

    Matching Score =
        60% × Price Score
      + 20% × Distance Score
      + 12% × Reliability Score
      +  8% × Pickup Availability Score

These weights represent the proposed matching configuration and can be adjusted as the platform evolves.

Each component must be normalized to a common scoring range before calculating the combined score.

Only recyclers who satisfy the platform's applicable eligibility requirements should be presented as eligible buyers.

### Step 6: Competitive Offers and Bidding

E-Setu supports a workflow in which recyclers can express interest in available material lots and submit offers.

Depending on the listing configuration, a collector may:

- Request quotes from selected recyclers.
- Receive offers from interested recyclers.
- Compare prices and other offer details.
- Review pickup arrangements.
- Accept a preferred offer.

Example:

| Recycler | Offered Price | Pickup |
|---|---:|---|
| Recycler A | ₹19/kg | Available |
| Recycler B | ₹21/kg | Available |
| Recycler C | ₹20/kg | Requires confirmation |

For an estimated 25 kg lot, the offer of ₹21/kg corresponds to an indicative amount of ₹525 before any applicable adjustments.

The collector remains responsible for selecting an offer that meets their requirements.

After an offer is accepted, the system should mark the selected offer as accepted and update the status of competing offers according to the bidding rules.

Other offers should not be deleted in a way that destroys the transaction history.

### Step 7: Confirm the Accepted Offer

Once the collector accepts an offer, E-Setu records the agreed transaction terms.

The record should include:

- Lot identifier.
- Collector identifier.
- Recycler identifier.
- Accepted rate per kilogram.
- Accepted offer timestamp.
- Pickup terms.
- Current transaction status.

The accepted offer becomes the reference against which the final settlement can be calculated.

Changes to the agreed rate should be explicitly recorded rather than silently overwriting the original terms.

### Step 8: QR-Based Pickup and Handover

E-Setu uses a QR-based workflow to associate a physical material handover with the corresponding digital transaction.

A possible workflow is:

1. The accepted transaction receives a unique QR code.
2. The collector and recycler coordinate the pickup.
3. The QR code is scanned at the appropriate stage of the handover.
4. The system verifies that the transaction is eligible for the requested action.
5. Pickup details are recorded.
6. Photographs or other supporting evidence are attached when required.
7. The actual measured weight is recorded.
8. The transaction progresses to the settlement stage.

The QR code serves as a reference to the transaction. It does not, by itself, prove that a pickup occurred or that the recorded weight is correct.

The backend should validate transaction status, participant permissions, and duplicate requests.

Where supported, the system can also record pickup location and timestamp.

### Step 9: Record the Actual Weight

The estimated weight entered during listing may differ from the actual weight measured during pickup.

E-Setu records the final measured weight so that the settlement reflects the material actually accepted.

For example:

    Estimated Weight: 25 kg
    Actual Weight: 23.5 kg
    Accepted Rate: ₹21/kg

The final amount is calculated using the actual weight.

### Step 10: Calculate the Final Settlement

The basic settlement calculation is:

    Final Settlement = Actual Weight × Accepted Rate per kg

Using the example above:

    Final Settlement = 23.5 × ₹21
                     = ₹493.50

The system can retain the estimated value, accepted offer, actual weight, and final settlement as separate fields.

This distinction makes it easier to understand how the transaction progressed from an initial estimate to the final amount.

If deductions, bonuses, transport charges, or other adjustments apply, they should be recorded separately and included according to the agreed transaction terms.

### Step 11: Transaction History and Traceability

After the handover and settlement are completed, E-Setu maintains the relevant transaction record.

A transaction can include:

- Initial material listing.
- Estimated valuation.
- Recycler offers.
- Accepted offer.
- Pickup confirmation.
- Actual measured weight.
- Supporting evidence.
- Final settlement.
- Transaction status changes.
- Relevant timestamps.

These records help collectors, recyclers, and administrators review completed transactions and investigate disputes.

### Step 12: Administrative Monitoring

The administrator dashboard provides an overview of platform operations.

Administrators can manage or review:

- Collector accounts.
- Recycler registrations.
- Recycler authorization status.
- Material lots.
- Transactions.
- Reported discrepancies.
- Suspicious transaction patterns.
- Platform activity.

When a transaction is flagged, an administrator can review its supporting information and decide whether further investigation is necessary.

An automated alert is an indication that a transaction deserves attention; it is not proof of fraud.

---

## 👥 User Roles

### 1. Scrap Collector

The collector is the person or business supplying recyclable materials.

**Responsibilities and capabilities:**

- Register and manage a profile.
- Create material lots.
- Upload material photographs.
- Review suggested material classifications.
- View estimated valuations.
- Discover eligible recyclers.
- Receive and compare offers.
- Accept an offer.
- Coordinate pickup.
- Review transaction records and settlement details.

### 2. Recycler

The recycler is a buyer or recycling organization that acquires recyclable materials.

**Responsibilities and capabilities:**

- Register an organization profile.
- Submit required verification information.
- Complete the applicable authorization process.
- Discover compatible material lots.
- Submit offers.
- Coordinate pickup.
- Confirm handover details.
- Review accepted transactions and relevant records.

Registration does not automatically mean that a recycler is authorized. Authorization must be checked according to the applicable verification process.

### 3. Administrator

The administrator oversees platform governance and operational monitoring.

**Responsibilities and capabilities:**

- Review recycler registration and authorization.
- Manage platform records.
- Monitor material listings and transactions.
- Review anomaly alerts.
- Investigate reported discrepancies.
- Maintain oversight of transaction workflows.
- Review platform-level activity.

Administrative actions should be protected by role-based access control and recorded where appropriate.

---

## 🚀 Core Features

| Feature | Purpose |
|---|---|
| Collector Profiles | Maintain collector information and collection location |
| Material Lot Management | Create and manage recyclable material listings |
| AI-Assisted Classification | Suggest material categories from images |
| Price Discovery | Estimate material value using reference price data |
| Recycler Matching | Identify suitable and eligible buyers |
| Competitive Offers | Allow collectors to compare recycler quotes |
| Recycler Verification | Support authorization checks |
| QR-Based Handover | Associate physical handovers with digital transactions |
| Weight Recording | Capture actual weight for final settlement |
| Digital Evidence | Retain supporting photographs and transaction details |
| Settlement Calculation | Calculate the amount using actual weight and accepted rate |
| Anomaly Detection | Flag suspicious pricing, weight, or transaction patterns |
| Administrator Dashboard | Support oversight and investigation |
| Offline Support | Accommodate limited connectivity where implemented |

---

## 💰 Pricing and Valuation

E-Setu distinguishes between three important concepts.

### 1. Estimated Valuation

The initial estimate is based on the estimated weight and available reference price.

    Estimated Value = Estimated Weight × Reference Price

It is an informational estimate rather than a binding offer.

### 2. Accepted Offer

The accepted offer records the rate agreed upon between the collector and recycler.

    Accepted Offer Amount =
        Estimated Weight × Accepted Rate

This amount is indicative when the actual weight has not yet been established.

### 3. Final Settlement

The final settlement is calculated using the actual measured weight and accepted rate.

    Final Settlement =
        Actual Weight × Accepted Rate

The system should retain these values separately rather than replacing the initial estimate with the final settlement.

### Example

| Transaction Stage | Value |
|---|---:|
| Estimated Weight | 25 kg |
| Reference Price | ₹20/kg |
| Initial Estimated Value | ₹500 |
| Accepted Rate | ₹21/kg |
| Actual Weight | 23.5 kg |
| Final Settlement | ₹493.50 |

This structure makes price and weight changes easier to understand and audit.

Reference prices should be clearly distinguished from actual recycler offers. An estimate should never be presented as a guaranteed market price.

---

## 📱 QR-Based Transaction Verification

QR codes connect physical handovers to digital transaction records.

### Proposed Verification Flow

    Collector Creates Lot
            |
            v
    Recycler Offer Accepted
            |
            v
    Transaction Created
            |
            v
    QR Code Generated
            |
            v
    Pickup and Handover
            |
            v
    QR Code Scanned
            |
            v
    Transaction Validated
            |
            v
    Actual Weight Recorded
            |
            v
    Settlement Calculated
            |
            v
    Transaction Completed

### Important Validation Rules

The backend should verify that:

- The transaction exists.
- The transaction is in the correct state.
- The requesting user has permission to perform the action.
- The QR code refers to the intended transaction.
- The same handover action cannot be completed twice unintentionally.
- Required weight and evidence fields are present.
- Settlement is calculated using the recorded actual weight and accepted rate.

QR codes should contain a non-sensitive transaction reference or securely generated token rather than exposing private participant information.

---

## 🛡️ Anomaly Detection

E-Setu can help identify transactions that may require additional review.

The anomaly detection component can evaluate transaction records and flag unusual patterns.

### Potential Anomaly Categories

#### 1. Weight Discrepancy

Compare estimated and actual weights.

    Weight Difference =
        Estimated Weight - Actual Weight

    Weight Difference Percentage =
        (Weight Difference / Estimated Weight) × 100

For example:

    Estimated Weight: 25 kg
    Actual Weight: 20 kg
    Difference: 5 kg
    Difference Percentage: 20%

The transaction may be flagged if the discrepancy exceeds a configured threshold.

A weight difference does not automatically indicate misconduct. Measurement error, sorting, moisture, and other factors may explain the difference.

#### 2. Unusually Low Offers

Compare an offer with the available reference price for the same material and relevant market.

An offer significantly below the reference range may trigger a review.

Reference data must be sufficiently recent and comparable for this check to be meaningful.

#### 3. Repeated Suspicious Patterns

The system may identify repeated discrepancies associated with:

- Particular transaction patterns.
- Repeatedly unusual weight differences.
- Unusual pricing behavior.
- Repeatedly reported transactions.

These signals should be evaluated in context and should not automatically be treated as proof of wrongdoing.

### Anomaly Review Workflow

    Transaction Recorded
            |
            v
    Rules Evaluate Transaction
            |
            v
    Potential Anomaly Detected?
          /       \
        No         Yes
        |           |
        v           v
    Continue    Create Alert
                    |
                    v
              Admin Reviews
                    |
                    v
            Investigation Outcome

The administrator should be able to review the evidence supporting an alert and record the investigation outcome.

---

## 🏗️ System Architecture

E-Setu can be organized into the following logical components.

### 1. Frontend Application

Provides interfaces for collectors, recyclers, and administrators.

Responsibilities include:

- Authentication interfaces.
- Material listing forms.
- Image upload.
- Price and offer comparison.
- Transaction management.
- QR scanning.
- Dashboards and reports.
- Offline data handling, where supported.

### 2. Backend API

Implements the core business logic.

Responsibilities include:

- Authentication and authorization.
- User and role management.
- Material lot management.
- Recycler matching.
- Offer creation and acceptance.
- Transaction state management.
- QR validation.
- Weight and settlement calculations.
- Anomaly detection.
- Administrative operations.

### 3. Database

Stores structured application data.

Potential data entities include:

- Users
- CollectorProfiles
- RecyclerProfiles
- MaterialLots
- ReferencePrices
- Offers
- Transactions
- PickupRecords
- WeightRecords
- EvidenceRecords
- AnomalyAlerts
- AuditLogs

The exact schema depends on the selected database and implementation.

### 4. AI Classification Component

Processes material images and suggests relevant categories.

Responsibilities may include:

- Image preprocessing.
- Material classification.
- Prediction confidence.
- Category mapping.
- Local inference, if supported.
- Handling uncertain predictions.

### 5. Pricing and Matching Services

The pricing service estimates material value using available reference data.

The matching service ranks eligible recyclers according to the configured matching criteria.

Keeping these services separate from the main API makes the business rules easier to maintain and test.

### 6. QR and Transaction Service

Manages transaction references, handover verification, transaction states, and settlement records.

The service should validate every state-changing operation on the backend rather than trusting the frontend alone.

### 7. Administrator Dashboard

Provides authorized administrators with tools to review recycler status, transactions, anomaly alerts, and operational activity.

### 8. Offline Synchronization

If offline support is implemented, the client can temporarily retain permitted operations and synchronize them when connectivity returns.

The synchronization process must handle duplicate requests, conflicting updates, expired actions, and transaction state changes safely.

---

## 🔁 Data Flow

A typical transaction follows this sequence:

    Collector
       |
       v
    Material Lot
       |
       v
    Image Classification
       |
       v
    Estimated Valuation
       |
       v
    Recycler Matching
       |
       v
    Competitive Offers
       |
       v
    Offer Acceptance
       |
       v
    QR-Based Handover
       |
       v
    Actual Weight Recording
       |
       v
    Final Settlement
       |
       v
    Transaction History
       |
       v
    Administrative Monitoring

The material listing, offer, and transaction records should share stable identifiers so that a transaction can be traced back to its original lot.

---

## 🧰 Technology Stack

The following is a suggested technology stack. Replace it with the actual technologies used in the project.

| Component | Suggested Technology |
|---|---|
| Frontend | React |
| UI Styling | Tailwind CSS |
| Backend | Node.js and Express.js |
| Database | MongoDB or PostgreSQL |
| Image Storage | Cloudinary or compatible object storage |
| AI Classification | Python with a suitable computer vision model |
| QR Generation | QR-code generation library |
| QR Scanning | Browser camera API and a QR-scanning library |
| Authentication | Secure session-based or token-based authentication |
| Geolocation | Browser Geolocation API, with user permission |
| Offline Storage | IndexedDB or another suitable local storage mechanism |
| Deployment | Suitable frontend and backend hosting platforms |

The final stack should be selected according to the team's implementation requirements, available infrastructure, and deployment constraints.

---

## 🌱 Expected Impact

E-Setu aims to create measurable improvements across the scrap recycling ecosystem.

### For Collectors

- Better access to price information.
- More opportunities to compare offers.
- Easier discovery of eligible recyclers.
- Clearer transaction and settlement records.
- Improved visibility into recorded weight differences.

### For Recyclers

- Access to structured material listings.
- More efficient material discovery.
- Improved pickup coordination.
- Better-organized transaction records.

### For Administrators

- Better visibility into platform activity.
- More structured recycler verification.
- Faster identification of unusual transaction patterns.
- Improved access to evidence when investigating disputes.

### For the Recycling Ecosystem

- Greater transparency in material transactions.
- Better documentation of recyclable material flows.
- Improved digital coordination between collectors and recyclers.
- Potential support for more efficient material recovery.

These are intended outcomes. Their actual impact must be evaluated through pilot deployments and measurable results.

---

## 🔮 Future Enhancements

Potential future improvements include:

- More accurate material classification.
- Expanded reference price coverage.
- Location-aware market price discovery.
- Better recycler recommendation algorithms.
- Digital receipts and downloadable transaction reports.
- Improved offline synchronization.
- Stronger dispute resolution workflows.
- Integration with compatible weighing systems.
- Multilingual interfaces for collectors.
- SMS or messaging notifications.
- Transaction analytics and operational reports.
- Integration with external recycling or compliance systems where appropriate.

Future enhancements should be prioritized according to user needs, technical feasibility, and validation from real-world deployments.

---

## 🔐 Security and Data Integrity

E-Setu handles user profiles, location information, offers, and transaction records. These records must be protected appropriately.

Important design principles include:

- Enforce role-based access control.
- Validate all state-changing requests on the backend.
- Protect authentication credentials and session tokens.
- Restrict access to private participant information.
- Validate image uploads and file types.
- Record important transaction state changes.
- Prevent duplicate offer acceptance and handover operations.
- Preserve relevant historical offer and settlement records.
- Restrict administrative operations to authorized users.
- Obtain permission before accessing location or camera features.
- Define appropriate retention and deletion policies for transaction evidence.

A QR code alone does not provide transaction integrity. Its associated backend validation, access controls, and recordkeeping are essential.

---

## 📊 Project Scope

E-Setu brings together four major capabilities:

1. **Discover:** Identify materials, estimate their value, and find potential buyers.
2. **Connect:** Enable collectors and recyclers to exchange competitive offers.
3. **Verify:** Associate physical handovers with digital transaction records.
4. **Track:** Preserve price, weight, settlement, and anomaly information for review.

Together, these capabilities provide a foundation for a more transparent and traceable scrap trading ecosystem.

---

## 🤝 Contributing

Contributions may include:

- Improving the user experience.
- Enhancing material classification.
- Developing pricing and matching services.
- Improving transaction security.
- Testing QR-based handover workflows.
- Improving offline synchronization.
- Developing anomaly detection rules.
- Adding documentation and automated tests.

Contributions should be tested and documented before being incorporated into the main project.

---

## 📜 Disclaimer

E-Setu is designed to support transparent scrap trading and recycling coordination.

Price estimates, material classifications, recycler matching, and anomaly alerts are decision-support features. Their reliability depends on the quality of the available data and the implementation.

Recycler authorization must be established through appropriate verification rather than assumed from registration alone.

The platform does not guarantee a particular selling price or automatically establish that a transaction is fraudulent when an anomaly is detected.

---

## ♻️ E-Setu

**Discover. Connect. Verify. Recycle.**

Building a more transparent, accessible, and accountable scrap recycling ecosystem through technology.
