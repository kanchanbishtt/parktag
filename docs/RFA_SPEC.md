# RFA: WaveTag - Anonymous Vehicle Contact System

## Project Details

### Overview

| **Field**          | **Value**                         |
| ------------------ | --------------------------------- |
| **Developer**      | Krishna Singh                     |
| **Project Name**   | **WaveTag**                       |
| **Core Team**      | EditTree Freelance Team (Krishna) |
| **Target Release** | Phase 1 MVP (10-Jun-2026)         |
| **Spec Status**    | Approved (Implementation Phase)   |

### Contents

1. Project Kickoff
2. Requirements Analysis
3. Functional Design
4. Architectural Design
5. Submission Strategy
6. Test Strategy & Testability
7. Documentation Notes

### Version History

| **Date**   | **Comments**                                     | **Version** |
| ---------- | ------------------------------------------------ | ----------- |
| 2026-04-24 | Initial Research and Requirement Mapping         | v0.1        |
| 2026-04-24 | Expanded Functional Design and Visual Philosophy | v0.2        |
| 2026-04-24 | Full Document Consolidation and Arch Specs       | v1.0        |
| 2026-04-25 | Rebranding to **WaveTag** & Enhanced Benchmarks  | v1.1        |
| 2026-04-25 | Added Emergency/Authority Features & API Sources | v1.2        |
| 2026-05-21 | Finalized Alignment with CLAUDE.md & Templates    | v1.3        |
| 2026-05-21 | Synced with Exotel 'Connect Two Numbers' API      | v1.4        |

---

## Project Kickoff

### Motivation and Key Customers

**WaveTag** is a digital shield for your vehicle. It is a **Unified Web-Native Gateway** for anonymous vehicle contact, designed to resolve blocking incidents while protecting the privacy of everyone involved.

#### The Strategic Shift: Why Pure Web?
We have intentionally moved away from traditional native apps for both owners and scanners. 
*   **The Problem Space:** Currently when a "Transient Scanner" (someone just trying to help or get a car moved) is forced into an app-download or OTP wall.
*   **Zero-Friction Solution:** By using a **Pure Web Architecture**, we eliminate the "App Store Barrier" for both parties.
*   **Speed & Latency:** We achieve "Scan-to-Ring" times that are 5x faster than competitors (targeting <3 seconds), as there is no installation or account creation required for the scanner.

#### Core Vision
> "By scanning a Quick Response (QR) code, the public can contact the owner instantly via a browser-native interface, and owners manage their identity and receive alerts through a high-performance Progressive Web App (PWA)."

### The WaveTag Philosophy: Simplified Overview

| **The Concept** | **The Simple Version** | **Why It Wins** |
| :--- | :--- | :--- |
| **The "No-App" Rule** | Works like a digital restaurant menu. Scan the QR, and the site opens in 1 second. | Zero friction; people actually use it because they don't have to download anything. |
| **The "Digital Mask"** | Acts as a secure middleman. Scanners see a "Contact" button, never your real phone number. | Privacy first. Your private number stays off your windshield and out of stranger's hands. |
| **The "Old-School Operator"** | Real phone calls, not internet calls. The system calls both parties and connects them. | 99% reliability. It works in basements and areas with poor 4G/5G data coverage. |
| **The "App-Less App"** | You (the owner) just tap "Add to Home Screen." It looks and acts like an app, but it's much faster. | No App Store headaches for owners; instant setup and updates. |
| **The "Local Shop" Speed** | The system's "brain" is located right here in India, not halfway across the world. | Lightning fast. Everything happens in the blink of an eye (<3s latency). |
| **"Sunlight-Proof" Tags** | Bold buttons on the screen and high-contrast printing on the physical QR stickers. | Works in the harsh Indian sun. High-glare readability is built-in from day one. |
| **Staying at Home** | Your private information never leaves India; it's kept in a high-security vault in Mumbai. | Safer, follows local laws, and runs faster for people in Delhi-NCR. |

#### Key Customers
*   **Vehicle Owner:** Needs a reliable, high-performance PWA dashboard to receive alerts and manage their digital identity without App Store friction.
*   **Transient Scanner:** Needs an instant, browser-native interface to contact the owner safely in high-stress situations.

### Design Evaluation

| **Review Type** | **Status** | **Target Date** | **Reviewers** |
| :--- | :--- | :--- | :--- |
| **Team Level Design Review** | Done | 2026-05-21 | Krishna|
| **Security & Privacy Audit** | Planned | 2026-05-22 | Tech Lead |
| **Usability Testing (Scanner)** | Planned | 2026-05-23 | Beta Group |

### Standards

**Requirements / Functional Design:**
- [x] **Privacy:** Mandatory server-side identity mapping; no PII in URLs or QR payloads.
- [ ] **Accessibility:** WCAG 2.1 UI + High-Contrast Hardware Printing (Phase 1 Active).
- [x] **Data Security:** AES-256 encryption for all PII at rest and in transit.

**Architectural Design:**
- [x] **Quality Attributes:** Performance-first design targeting <3s total latency.
- [x] **Edge Execution:** Token resolution handled at the CDN edge for zero cold-starts.
- [ ] **Data Sovereignty:** Primary clusters (Mumbai) pinned to `ap-south-1`.
- [ ] **Regulatory:** TRAI DLT registration for `WAVTAG` header.

---

## Scope of Delivery (Phase 1 MVP)

To ensure a high-signal launch by June 10, 2026, we have defined a strict boundary for Phase 1 deliverables.

### 1. Primary Deliverables (What we ARE delivering)

| **Category** | **Deliverable** | **Description** |
| :--- | :--- | :--- |
| **Gateway** | **Anonymity Bridge** | 12-char Opaque Token resolution at Vercel Edge. Each physical tag carries one unique backend-mapped token. |
| **Hardware** | **High-Viz QR Tags** | High-contrast, glare-resistant physical QR prints for windshields. Each sticker is a unique physical tag, not a shared generic QR across multiple owners. |
| **UI/UX** | **High-Glare Interface** | WCAG 2.1 compliant UI; high-contrast "Sunlight Mode" for outdoors. |
| **Voice** | **Dual-Leg PSTN** | Masked bridging via **Exotel Connect Two Numbers API**. |
| **Messaging** | **Masked SMS + WhatsApp** | Pre-templated masked SMS and WhatsApp recovery via approved provider channels. |
| **Alerts** | **PWA Foundation** | Basic PWA manifest for "Add to Home Screen" support. |
| **Dashboard** | **Owner Dashboard** | Basic status toggle (Active/Inactive) and vehicle info. |

### 2. Deferred / Out-of-Scope (What we are NOT delivering)

| **Feature** | **Reasoning** | **Status** |
| :--- | :--- | :--- |
| **Web Push Alerts** | Focus on PSTN/SMS reliability for first launch. | DEFERRED (Phase 2) |
| **Anti-Spam Logic** | Not required for Phase 1 trial. | DEFERRED |
| **Rate Limiting** | Focus on connectivity over protection for MVP. | DEFERRED |
| **Persistent Logs** | Interaction history cleared after 30 days for privacy. | DEFERRED |
| **Video Calls** | Reliability risk; network volatility concerns. | REJECTED |
| **Multi-Language** | Target market is English-proficient urban NCR. | DEFERRED |
| **User Profiles** | Identity tied to QR token, not social accounts. | REJECTED |

---

### QR Identity Model Clarification

To avoid ambiguity in implementation and hardware issuance, Phase 1 uses the following QR model:

- every physical WaveTag sticker carries one unique QR code
- every unique QR resolves to one opaque backend token
- the same QR is reused across the tag lifecycle; it is not replaced after registration
- the first owner scan uses that same QR to claim or activate the tag
- later public scans of that same QR open the scanner contact interface
- a shared generic QR code for multiple owners is explicitly not part of the Phase 1 design

In practical terms:

- one vehicle tag -> one unique QR -> one backend token -> one backend tag record
- one owner with multiple vehicles may have multiple unique tags
- if a tag is damaged, lost, or revoked, a new unique QR/token pair must be issued

The backend decides what interface to show after scan based on the tag state:

- unclaimed tag -> owner claim / registration flow
- active tag -> public contact flow
- paused tag -> unavailable state
- revoked tag -> invalid or unavailable state

### Design Evaluation (Competitor Benchmarks)

To build a superior product, we must understand why current market leaders fail to achieve 100% user retention. Below is a breakdown of our primary competitors.

#### 1. Sampark Tag

- **Definition:** A hardware-first solution centered around physical, adhesive QR stickers for vehicle windshields.
- **Primary Function:** Provides a "Virtual Phone Number" linked to a vehicle to facilitate anonymous communication.
- **Workflow:**
  1. Owner buys and sticks a physical QR tag on the car.
  2. Scanner (the person blocked) scans the tag with a smartphone camera.
  3. A mobile web page opens, allowing the scanner to call or message the owner without seeing their real number.
- **Strategic Flaws (The "Weirdness"):**
  - **Hardware Lock-in:** The identity is tied to the physical sticker. If it is damaged or the car window is replaced, the owner must **buy a new tag**.
  - **Hidden Fees:** Onboarding often involves non-transparent "maintenance" or "activation" charges.
  - **Data Harvesting:** Requires excessive personal data (PII) during registration before the core service can be used.

#### 2. Park+

- **Definition:** A multi-layered automotive "Super-App" that combines hardware (RFID/FASTag) for gate automation with a software-based data aggregator for vehicle records.
- **Primary Function:** Acts as an **RTO Data Lookup Tool** that exposes official registration details, insurance validity, and the legal identity of vehicle owners.
- **Workflow:**
  1. **Input:** The user enters a vehicle’s registration number (license plate) on the web portal.
  2. **Authentication Wall:** Access is gated behind a mandatory mobile number sign-in (OTP), forcing the user into the Park+ ecosystem.
  3. **Information Disclosure:** The system reveals the registered owner's full name and comprehensive vehicle history (Insurance, PUCC, and Hypothecation status).
- **Strategic Flaws (The "Weirdness"):**
  - **Privacy Exposure:** It is a data-exposure tool. It reveals the owner’s full name to any stranger with a license plate, posing a significant PII (Personally Identifiable Information) risk compared to **WaveTag’s** anonymity.
  - **High Friction:** The mandatory OTP sign-in for a simple lookup is a major deterrent for "Transient Scanners" who need to communicate in high-stress situations.
  - **Communication Gap:** It provides the "Who" (Owner Name) but not the "How" (Contact Method). It lacks the WebRTC/telephony bridge required to actually resolve a vehicle-blocking incident.

---

**Strategic Advantage:** **WaveTag** wins through **Zero-Barrier Accessibility**. By treating the public as a "Transient Helper," we solve the "Drop-Off Problem," ensuring a **Scan-to-Ring time of <3 seconds**. We avoid "Hardware-Lock" by allowing digital-first identities.

---

## Requirements Analysis

### User Roles and Goals

| **ID** | **Role** | **What they want (The Relatable Goal)** | **How we know it worked (The Clear Outcome)** | **Priority** |
| :--- | :--- | :--- | :--- | :--- |
| **RG_1** | **Vehicle Owner** | "I want to be reachable if someone needs me to move my car, but I don't want strangers having my private phone number." | **Peace of Mind:** I get the call instantly, but my number stays hidden. | **CRITICAL** |
| **RG_2** | **Transient Scanner** | "I just want this car to move so I can leave. I don't want to download an app or sign up for anything just to send a message." | **Instant Action:** I scan the code and I'm talking to the owner in seconds. No 'homework' required. | **CRITICAL** |
| **RG_3** | **First Responders** | "There’s an emergency. I need to know who this person is and who to call *right now*." | **Zero Wasted Time:** I get the emergency contacts immediately without hitting any 'login' walls. | **HIGH** |
| **RG_4** | **Family / Emergency** | "If my family member is in trouble or their car is blocking traffic and they don't answer, I want to be the backup." | **Reliable Safety Net:** I get the call if the primary owner is unavailable. | **HIGH** |
| **RG_5** | **Platform Admin** | "I want to make sure the system is always running and the phone calls are actually going through." | **Perfect Reliability:** The system is up 24/7 and every 'Scan' results in a successful connection. | **MEDIUM** |

### Use Cases

#### Use Case — UC_1 (The Blocked Exit)

| **Step** | **Current Workflow** | **Notes** |
| :--- | :--- | :--- |
| 1 | **Frustrated Driver** finds their way blocked and scans the WaveTag QR. | Instant page load (<1s). |
| 2 | Driver enters their phone number and taps **"Call Owner"**. | Minimal typing; **A-Leg** initiation. |
| 3 | **WaveTag Operator** calls the Driver first, then calls the Owner. | Dual-Leg bridge via **Connect API**. |
| 4 | **Resolution:** Both parties talk, the car is moved, and the driver leaves. | Problem solved in <1 minute. |

#### Use Case — UC_2 (Medical Emergency)

| **Step** | **Current Workflow** | **Notes** |
| :--- | :--- | :--- |
| 1 | **Bystander/Medic** finds an unresponsive person in a car and scans the QR. | Speed is critical here. |
| 2 | Medic taps the bright red **"Emergency SOS"** button. | No number entry required for SOS data. |
| 3 | System displays the Owner's **Medical Profile** & **Family Contacts**. | Blood group, allergies, and designated emergency contact number(s). |
| 4 | Medic taps the visible **"Call Family"** link or number to alert the backup contact directly. | SOS-only privacy exception; no masking required for designated emergency contacts. |

#### Use Case — UC_3 (Messaging Recovery)

| **Step** | **Current Workflow** | **Notes** |
| :--- | :--- | :--- |
| 1 | A Scanner tries to call the Owner (UC_1), but the Owner's phone is off or busy. | System detects the **Leg B** failure. |
| 2 | System terminates the call and notifies the Scanner via the Web UI. | Professional "Owner Unavailable" alert. |
| 3 | Scanner is presented with options to send a **Masked SMS** or **WhatsApp**. | Custom message input enabled. |
| 4 | **Resolution:** Scanner sends a message; Owner receives it anonymously. | Bridge remains closed; privacy maintained. |

#### Use Case — UC_4 (Passive Control)

| **Step** | **Current Workflow** | **Notes** |
| :--- | :--- | :--- |
| 1 | **Vehicle Owner** is going into a meeting and doesn't want to be disturbed. | Needs quick control. |
| 2 | Owner opens the **PWA Dashboard** and toggles the car to **"Inactive"**. | Single tap on the UI. |
| 3 | A Scanner scans the QR; the system shows a **"Currently Unavailable"** message. | Telephony bridge is disabled to save costs. |
| 4 | Meeting ends; Owner toggles car back to **"Active"**. | Full control restored instantly. |

### Pain Points

| **ID** | **Title** | **Relatable Description** | **Human Impact** |
| :--- | :--- | :--- | :--- |
| **PP1** | **The "Waiting" Stress** | If it takes more than a few seconds to connect, a stressed driver will just give up. | The car never gets moved; frustration boils over. |
| **PP2** | **Privacy Anxiety** | Leaving a real phone number on a windshield feels like an invitation for harassment or data misuse. | Owners feel unsafe; they prefer to stay hidden even if it means being unreachable. |
| **PP3** | **"Not Another App"** | Scanners refuse to download an app or sign up just to resolve a 30-second parking issue. | 60% of people simply won't use the system if it's not "one-tap." |
| **PP4** | **The "Did I Miss It?" Gap** | Owners worry that if they aren't looking at their phone, they won't know someone is trying to reach them. | Critical delays in moving the car or responding to an emergency. |
| **PP5** | **Meeting Interruptions** | Owners have no way to "mute" their car when they are in a movie, hospital, or an important meeting. | Stressful interruptions at the worst possible times. |
| **PP6** | **Outdoor Blindness** | Standing in the bright sun makes it nearly impossible to read small text or scan a low-quality QR code. | System failure because the user "can't see" what to do next. |

### Requirements

| **ID** | **Requirement (The Solution)** | **Addresses Pain Point** | **Priority** |
| :--- | :--- | :--- | :--- |
| **R_NO_APP** | **The "No-App" Rule:** The system must be 100% usable for scanners without downloading any app or creating an account. | PP3 ("Not Another App") | **CRITICAL** |
| **R_PSTN** | **Real-Call Reliability:** All calls must be real phone-to-phone (PSTN) calls to ensure they work in basements and without data. | PP4 ("Did I Miss It?") | **CRITICAL** |
| **R_PRIVACY** | **Total Identity Shield:** Real phone numbers must never be shared; only the WaveTag Virtual Number is visible on Caller ID. | PP2 (Privacy Anxiety) | **CRITICAL** |
| **R_SPEED** | **The 3-Second Rule:** The system must initiate the call bridge within 3 seconds of the user tapping "Call". | PP1 (Waiting Stress) | **CRITICAL** |
| **R_TOGGLE** | **Meeting Mode:** Owners must have a simple "Active/Inactive" toggle in their dashboard to silence alerts. | PP5 (Meeting Interruptions) | **CRITICAL** |
| **R_SUNLIGHT** | **Sunlight-Proof UI:** The website must use extra-bold buttons and high-contrast colors for outdoor readability. | PP6 (Outdoor Blindness) | **HIGH** |
| **R_RECOVERY** | **Messaging Recovery:** If a call isn't answered, scanners must be offered an option to send a masked SMS or WhatsApp. | PP1, PP4 | **HIGH** |
| **R_SOS_DISCLOSURE** | **Emergency SOS Disclosure:** When SOS is activated, the system may display the configured medical profile and designated family/emergency contact phone numbers without masking. This disclosure is allowed only inside the SOS flow. | PP4 | **HIGH** |
| **R_PWA_HOME** | **One-Tap Access:** The owner dashboard must support "Add to Home Screen" (PWA) for native-like convenience. | PP3, PP4 | **MEDIUM** |

### Out of Scope (What We Are NOT Delivering)

To maintain focus on the **June 10th deadline** and ensure maximum reliability, the following categories are explicitly excluded from the Phase 1 MVP:

| **Category** | **Exclusion** | **Strategic Reasoning** |
| :--- | :--- | :--- |
| **Platform** | **Native iOS/Android Apps** | Avoiding App Store friction is our primary competitive advantage. Pure Web (PWA) ensures instant access. |
| **Communication** | **WebRTC / VoIP Calls** | Internet-based calls are too unreliable in basements and dead zones. We prioritize PSTN for 99.9% reachability. |
| **Automation** | **Automated Timed DND** | While valuable, automated timers add complexity to the database logic. This is deferred to Phase 2. |
| **Infrastructure** | **Client-Side Resolution** | Decoding tokens in the browser is a security risk. All identity mapping must remain server-side at the Edge. |
| **User Experience**| **Multi-Language Support** | Phase 1 targets the English-proficient urban market in Delhi-NCR to speed up development. |
| **Security** | **Anti-Spam / Rate Limiting** | For the initial 1,000-user trial, focus is on seamless connectivity. Protection layers will be added in Phase 2. |
| **Data** | **Social Media Integration** | We prioritize anonymity. Linking Facebook or Google accounts contradicts our "Privacy-First" mandate. |

---

## User Journey: The Scan-to-Resolution Path

This journey maps the end-to-end experience of a "Transient Scanner" from the moment they encounter a blocked exit to the final resolution of the incident.

### Visual Workflow Map

```text
[ START: CAR BLOCKED ]
          |
          v
+-----------------------+      (LIGHTWEIGHT NEXT.JS PAGE)
|   SCAN WAVE-TAG QR    | <--- (NO APP REQUIRED)
+-----------------------+
          |
          v
+-----------------------+      (CHOICE MENU)
|   SELECT ACTION       |
| --------------------- |
| [ 📞 ANONYMOUS CALL ] | ----> [ ENTER MOBILE NUMBER ] -> [ TRIGGER CONNECT API ]
| [ 💬 MASKED SMS/WA  ] | ----> [ ENTER MOBILE NUMBER ] -> [ TRIGGER MASKED MSG  ]
| [ 🚨 EMERGENCY SOS  ] | ----> [ OPEN SOS PANEL ] -----> [ SHOW MEDICAL + FAMILY INFO ]
+-----------------------+
          |
          v
[ END: ISSUE RESOLVED ]
```

### Stage 1: The Scan (Discovery & Trust)

- **The Trigger:** A scanner finds their vehicle blocked by another car. They spot the **WaveTag** QR code on the windshield/window.
- **The Action:** The scanner uses their smartphone camera (no app required) to scan the QR.
- **The Experience:**
  - The browser opens a lightweight, high-performance landing page in **<1 second**.
  - The scanned QR is unique to that physical WaveTag sticker and resolves to one backend token only.
  - The UI immediately displays a "Privacy Shield" icon and a message: _"Your number is hidden. Contact the owner safely."_ to build instant trust.

### Stage 2: The Choice (Action Selection)

- **The Action:** The scanner chooses one of three actions immediately after the page loads.
- **Available Paths:**
  - **Anonymous Call:** privacy-protected PSTN bridge to the vehicle owner
  - **Masked SMS / WhatsApp:** privacy-protected recovery messaging
  - **SOS / Emergency Button:** immediate access to the SOS panel

### Stage 3: The Handshake (Identity & Session Setup for Contact Flows)

- **The Action:** For **Anonymous Call** and **Masked SMS / WhatsApp** only, the scanner enters their mobile number into a single, high-contrast input field.
- **The Tech Assist:** The system utilizes `autocomplete="tel"` to trigger the browser's native **One-Tap Autofill**, minimizing typing.
- **The Outcome:**
  - Upon clicking "Proceed," the **Anonymity Gateway** creates a temporary session.
  - The scanner's number is stored server-side as temporary routing context for the selected contact flow.

### Stage 4: The Resolution (Closing the Loop)

- **Call Path:** Both parties communicate through a **Virtual Number (CallerId)**. Neither party ever sees the other’s real contact details.
- **Message Path:** The scanner can send a masked SMS or WhatsApp recovery message without exposing private routing data.
- **SOS Path:** The system may display configured medical details and designated family/emergency contact phone numbers as an explicit SOS-only exception to the normal masking rule.
- **The Expiry:** After 30 minutes, temporary contact-flow session data is automatically purged for maximum privacy.

---

## Owner Journey: The Command & Response Path

### Stage 1: Onboarding (Zero-Install Activation)

- **The Action:** The owner scans the sticker using their phone's native camera.
- **The Experience:** On the first scan of an unclaimed sticker, the browser opens the owner claim / registration flow for that unique QR tag. After successful registration, the same QR remains on the vehicle and the owner is prompted to "Add to Home Screen" (PWA) for a native-like experience without the App Store.
- **The Identity Rule:** The QR itself does not change after registration. What changes is the backend state linked to that unique token: first it is unclaimed, then it becomes an active owner-linked WaveTag.

### Stage 2: The Alert (Web-Native Response)

- **The Trigger:** A scanner initiates a contact via the web interface.
- **The Experience:** The owner receives an incoming call (Leg B) from the **WaveTag Virtual Number**.
- **The Action:** The owner answers the call to resolve the incident.

---

### Design Trade-off: Why we chose "Connect Two Numbers API" over "ExoBridge"

As the **Developer**, I evaluated two Exotel-native workflows for the communication bridge. We have chosen the **Connect Two Numbers API** for Phase 1 due to the following strategic reasons:

1.  **Lower Operational Cost:** ExoBridge is an enterprise "Lead Management" solution with higher platform fees. The **Connect API** allows us to pay only for the virtual number rental and usage minutes.
2.  **Implementation Speed:** The Connect API requires a single RESTful call from our backend, whereas ExoBridge requires complex rule-engine configuration. This is critical for the **June 10, 2026 deadline**.
3.  **Enhanced UX (WaitUrl):** The Connect API supports the `WaitUrl` parameter, allowing us to play a custom greeting to the scanner (Leg A) while the owner (Leg B) is being dialed. This prevents "Dead Air" and reduces abandonment.
4.  **Simplicity for MVP:** For the initial 1,000 users, a single virtual number (ExoPhone) managed via the Connect API provides the same level of privacy as the more complex ExoBridge.

**Decision:** We chose the **Exotel Connect Two Numbers API** as the "Gold Standard" for reliability and speed-to-market.

---

## Functional Design

### Proposed Design: Details (Scanner Side - Web)

| **Design Case** | **Focus** | **Workflow / Logic** | **Privacy & Security** |
| :--- | :--- | :--- | :--- |
| **DC_1: Identity Capture** | Scanner Onboarding | Scan unique QR -> Backend resolves token -> Land on Page -> Enter Mobile Number for contact flows. | Number stored in encrypted session; NEVER shared with owner. |
| **DC_2: Action Menu** | Intent Selection | Number entry -> Menu (Call, SMS/WA, SOS). | State-aware menu based on incident urgency. |
| **DC_3: Execution** | **Connect API Bridge** | Trigger **Exotel Connect API** -> Dual-leg bridge (Leg A & Leg B). | **CallerId Masking** ensures 100% PII protection. |

### Proposed Design: Details (Owner Side - Web PWA)

| **Design Case** | **Focus** | **Workflow / Logic** | **PWA Advantages** |
| :--- | :--- | :--- | :--- |
| **DC_4: QR Binding** | Activation | First owner scan of unique tag -> Claim / Register -> Activate backend mapping -> Dashboard -> Add to Home Screen. Later scans of the same QR by the public open the contact interface instead of the owner claim flow. | Zero App Store friction; instant setup. |
| **DC_5: Alert Plane** | Call Response | System dials owner (Leg B) via Virtual Number. | High-reliability PSTN call; works without data. |
| **DC_6: Safety Profile** | Emergency Config | Dashboard -> Register Family & Medical contacts. | Shared only during SOS events. |

---

## Architectural Design

### 1. System Architecture Map (Stateless Edge-Orchestration)

```text
[ SCANNER BROWSER ] <--- (1) Scan QR --- [ PHYSICAL TAG ]
          |
          | (2) GET /api/resolve/{token-from-unique-qr}
          v
[ NEXT.JS EDGE RUNTIME ] <--- (3) Fetch Masked Info --- [ MONGODB ATLAS ]
          |
          | (4) POST /api/session/create
          v
[ ANONYMITY GATEWAY ] <--- (5) Store Session (TTL:30m) --- [ UPSTASH REDIS ]
          |
          | (6) TRIGGER EXOTEL CONNECT API
          v
+-------------------------+      (7) DUAL-LEG BRIDGE     +-------------------------+
|  EXOTEL CLOUD GATEWAY   | ----------------------------> | SCANNER & OWNER PHONES  |
+-------------------------+                               +-------------------------+
```

### 2. Core Architectural Components

| **Component** | **Technology** | **Role & Strategic Value** |
| :--- | :--- | :--- |
| **Client Tier** | **Next.js + React** | Scanner Landing (<500ms SSR); Owner PWA Dashboard; first-scan owner claim flow for unclaimed tags. |
| **Logic Tier** | **Edge Runtime** | Token resolution at CDN Edge; sub-50ms resolution; determines whether a scanned unique tag should open owner claim flow or scanner contact flow. |
| **Data Tier** | **MongoDB Atlas** | Mumbai-based global cluster; stores unique token -> tag -> owner mapping and tag claim state. |
| **Cache Tier** | **Upstash Redis** | Serverless session management (30-60m TTL). |
| **Comm Plane** | **Exotel Connect API** | **Dual-Leg Bridge:** Uses `Connect Two Numbers` to link Leg A & Leg B. |
| **Privacy Layer** | **Replacement Masking** | **PII Protection:** Scrambles numbers in logs (`+91 XXXXX-XXXXX`). |

---

## Future Implementation Roadmap (Phase 2 & Beyond)

### 1. High-Priority: Web Push Notification Plane
Implementation of the **Web Push API** to wake up the PWA Service Worker for visual alerts.

### 2. Strategic: ExoBridge Integration
Transitioning to **ExoBridge** for automated virtual number pool management once the user base exceeds 50,000.

### 3. Advanced: Timed Do-Not-Disturb (DND)
*   **The Goal:** Prevent owners from forgetting to re-activate their tags after a meeting or event.
*   **Tech:** Scheduled status resets in MongoDB/Redis (TTL-based logic).
*   **Value:** User sets a duration (e.g., 2 hours for a movie); the system automatically restores "Active" status once the timer expires. Prevents missed alerts due to human error.

---

## Test Strategy & Testability

| **#** | **Test Case Description**                                      | **Test Type** | **Goal**    |
| ----- | -------------------------------------------------------------- | ------------- | ----------- |
| 1     | Verify **Exotel Connect API** triggers Leg A within <1s.       | Performance   | R_SPEED     |
| 2     | Confirm **CallerId** masking shows Virtual Number to both.     | Security      | R_PRIV      |
| 3     | Verify **WaitUrl** plays greeting to Leg A while dialing Leg B.| Functional    | R_SPEED     |
| 4     | Confirm no PII is visible in Network Logs or Cloud Logs.       | Security      | R_PRIV      |
| 5     | Verify the SOS flow reveals configured medical details and designated emergency contact number(s). | Functional    | R_SOS_DISCLOSURE |

---

## Documentation Notes

#### 1. Developer & Operations

- **API Reference:** Detailed documentation of the **Connect Two Numbers** payload (`From`, `To`, `CallerId`, `WaitUrl`).
- **Data Compliance:** Clear guidelines on **Replacement Masking** for TRAI and Indian IT Act compliance.

#### 2. Naming Convention Standard

- **Requirement IDs:** Use descriptive upper-snake identifiers with the `R_` prefix, such as `R_SPEED`, `R_RECOVERY`, and `R_SOS_DISCLOSURE`.
- **Domain Fields / JSON Keys / API Properties:** Use `camelCase`, such as `ownerLabel`, `plateLastFour`, and `availableActions`.
- **Entity / Type / Interface Names:** Use `PascalCase`, such as `Owner`, `Tag`, and `ScannerSession`.
- **Constants / Environment Variables / Enum Identifiers:** Use `UPPER_SNAKE_CASE`.
- **Abbreviations:** Use only widely recognized terms such as `SOS`, `PSTN`, `PII`, `QR`, and `TTL`, and avoid unclear short forms in contracts.
