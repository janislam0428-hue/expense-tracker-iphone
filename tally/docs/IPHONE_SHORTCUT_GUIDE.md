# iPhone 14 Pro Expense Tracking Guide (Zero Credits, Maximum Efficiency)

This guide explains how to automatically capture expenses into Tally directly from your **iPhone 14 Pro** notification pop-outs and Apple Wallet records with **zero external API credits**, zero LLM token costs, and sub-second latency.

---

## 🚀 How It Works (Zero-Credit Architecture)

Traditional AI expense trackers send screenshots or notifications to cloud LLMs (OpenAI, Claude, Perplexity), costing credits on every coffee or bus ride.

**Tally's Zero-Credit Pipeline**:
1. **On-Device Vision OCR**: Apple iOS Shortcuts has built-in on-device optical character recognition (`Extract Text from Image`), running locally via Apple's Vision framework. Cost: **0 API credits, 100% private, ~100ms speed**.
2. **Deterministic Server Parser**: Tally's `/api/ingest` endpoint processes notification text using local regex patterns tuned for Hong Kong payment systems (Octopus, PayMe, HSBC, Hang Seng, Standard Chartered, Mox, ZA Bank, Apple Pay). Cost: **0 API credits, 0ms queue time**.
3. **Smart Rule Engine**: Recurring merchants (e.g. Starbucks, 7-Eleven, Bus) are auto-categorized via `MerchantRule` without human intervention or AI re-inference.

---

## 📱 Method 1: Apple Wallet Automation (100% Automatic, Zero Taps)

Best for: **Octopus Card in Apple Wallet**, Apple Pay credit cards.

Whenever you tap your Octopus at an MTR barrier, bus reader, or store, iOS automatically executes the shortcut in the background without needing you to touch anything.

### Step-by-Step Setup:
1. Open the **Shortcuts** app on your iPhone 14 Pro.
2. Tap the **Automation** tab at the bottom, then tap the `+` button in the top right.
3. Scroll down and tap **Transaction**.
4. Configure the trigger:
   - **Card**: Choose *Any Card* (or specifically your *Octopus* card).
   - **Category**: *Any*.
   - **Merchant**: *Any*.
   - **When**: Select **Run Immediately** (turn off *Ask Before Running*).
   - Turn off *Notify When Run* for silent background execution.
5. In the action editor:
   - Tap **New Blank Automation** -> **Add Action**.
   - Search for **Get Contents of URL** and add it.
   - Configure the action:
     - **URL**: `https://<your-tally-domain>/api/ingest` (or your local tunnel URL)
     - **Method**: `POST`
     - **Headers**:
       - `Authorization`: `Bearer <your-api-token>` (obtain from Tally Settings)
       - `Content-Type`: `application/json`
     - **Request Body**: JSON
       - Add field: `text` -> tap the variable bar and choose **Shortcut Input** (select *Details* -> *All Details* or format as text).
6. Tap **Done**. Every tap is now automatically recorded!

---

## ⚡ Method 2: Back Tap on Notification Pop-out (1 Second, Zero Typing)

Best for: **PayMe, Bank App Notifications, Dynamic Island Pop-outs**.

When an app push notification banner or Dynamic Island pop-out appears (e.g. *"You've paid HK$150.00 to Karen Chan"*), you simply **double-tap the back of your iPhone 14 Pro**.

### Step 1: Create the "Log to Tally" Shortcut
1. Open the **Shortcuts** app -> **Shortcuts** tab -> tap `+` to create a new shortcut.
2. Name it **Log to Tally**.
3. Add the following actions in order:
   - **Action 1**: `Take Screenshot`
   - **Action 2**: `Extract Text from Image` (Input: *Screenshot*)
   - **Action 3**: `Delete Photos` (Input: *Screenshot*, toggle off *Show when Run* to delete automatically)
   - **Action 4**: `Get Contents of URL`
     - URL: `https://<your-tally-domain>/api/ingest`
     - Method: `POST`
     - Headers:
       - `Authorization`: `Bearer <your-api-token>`
       - `Content-Type`: `application/json`
     - Request Body: JSON
       - Key: `text` | Type: `Text` | Value: select **Text** (output of Action 2)
   - **Action 5**: `Get Dictionary from Input` (Input: *Contents of URL*)
   - **Action 6**: `Get Value for Key` (Key: `message`, Input: *Dictionary*)
   - **Action 7**: `Show Notification` (Text: *Dictionary Value*)

### Step 2: Assign to Back Tap on iPhone 14 Pro
1. Open iPhone **Settings**.
2. Go to **Accessibility** -> **Touch**.
3. Scroll to the very bottom and tap **Back Tap**.
4. Tap **Double Tap** and select **Log to Tally**.

### How to Use:
Whenever a notification pops out on your screen, double tap the back of your phone. The screenshot is read on-device, sent to Tally, deleted from your camera roll, and a confirmation banner *"Logged $150.00 at Karen Chan"* appears.

---

## 📩 Method 3: Bank SMS Automation (Automatic)

Best for: Credit card transaction SMS alerts (e.g. HSBC, Hang Seng, Standard Chartered, Mox).

1. In **Shortcuts** -> **Automation** -> `+`.
2. Select **Message**.
3. Set **Message Contains**: `HKD` or `spent` or `簽賬`.
4. Select **Run Immediately**.
5. Add action **Get Contents of URL** with:
   - URL: `https://<your-tally-domain>/api/ingest`
   - Method: `POST`
   - Header: `Authorization: Bearer <your-api-token>`
   - Body: JSON with `text`: *Shortcut Input (Message Body)*.

---

## 🛠️ Testing Your Ingestion Immediately

You can test the parser right from your browser before setting up your iPhone:
1. Open Tally and navigate to the **Import** page.
2. Select **Paste Notification Text**.
3. Paste any sample notification, such as:
   ```text
   Octopus: Paid HK$8.70 at KMB Bus. Remaining balance HK$350.20
   You've paid HK$150.00 to Karen Chan.
   Hang Seng Credit Card: Spent HKD 420.00 at Wellcome.
   ```
4. Click **Parse & Preview** -> Verify the detected amounts and merchants -> Click **Confirm & Import to Tally**.
