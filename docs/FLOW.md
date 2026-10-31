# USTAAD — Flow Diagrams (Phase 0)

## 1. Customer journey (business flow)

![Customer journey](flow-1-journey.png)

```mermaid
flowchart TD
    A([Customer arrives at shop]) --> B{Shop crowded?}
    B -- No --> Z([Sits in chair])
    B -- Yes --> C[Scans QR on poster / TV]
    C --> D[Opens ustaad.pk/q/shop<br/>No app · No signup]
    D --> E{Shop open?}
    E -- No --> E1[Sees: دکان ابھی بند ہے]
    E -- Yes --> F[Sees: Now serving 9 · 5 waiting · ~25 min]
    F --> G[Taps لائن میں لگیں]
    G --> H[Gets Token #12<br/>saved on phone]
    H --> I[Leaves: chai, market, work<br/>page stays open]
    I --> J[Page updates live:<br/>3 log aage · ~15 min]
    J --> K{Ahead = 0?}
    K -- No --> J
    K -- Yes --> L[آپ اگلے ہیں — walk back]
    L --> M[Barber taps NEXT]
    M --> N[Screen turns green:<br/>آپ کی باری!]
    N --> O{Customer present?}
    O -- Yes --> P([Haircut ✓<br/>time used to learn average])
    O -- No --> Q([Barber taps No-show<br/>next customer called])

    W([Walk-in without phone]) --> W1[Barber taps + Walk-in]
    W1 --> W2[Barber tells number: 13]
    W2 --> W3[Watches TV: ABHI NUMBER]
    W3 --> M
```

## 2. How the system talks (one barber tap → every screen)

![System sequence](flow-2-system.png)

```mermaid
sequenceDiagram
    autonumber
    participant C as Customer phone<br/>/q/shop
    participant S as USTAAD server<br/>(Node + SQLite)
    participant B as Barber tablet<br/>/b/shop
    participant T as Shop TV<br/>/tv/shop

    C->>S: Open page (1.6 KB)
    S-->>C: HTML: now serving 9, 5 waiting
    C->>S: POST join
    S->>S: number = today's max + 1 → No. 12
    S-->>C: Cookie (token) + "Aapka Number 12"
    C->>S: Open live connection (SSE)
    T->>S: Open live connection (SSE)
    B->>S: Open live connection (SSE)
    S-->>C: {n:9, w:[10,11,12], a:300}
    S-->>T: same
    S-->>B: same

    B->>S: Tap NEXT
    S->>S: No. 9 → done (save haircut time)<br/>re-learn average<br/>No. 10 → serving
    S-->>C: {n:10, w:[11,12], a:300} (≈30 bytes)
    S-->>T: same → "ABHI NUMBER 10" + ding
    S-->>B: same
    Note over C: Phone works out:<br/>2 ahead × 5 min = ~10 min

    Note over C,S: If live connection drops on 2G →<br/>phone asks every 20 seconds instead
```

## 3. Life of a token

![Token lifecycle](flow-3-token.png)

```mermaid
stateDiagram-v2
    [*] --> waiting: Customer joins / barber adds walk-in
    waiting --> serving: Barber taps NEXT (first in line)
    waiting --> left: Customer taps "Leave queue"
    serving --> done: Barber taps NEXT (haircut finished)
    serving --> skipped: Barber taps No-show
    done --> [*]
    skipped --> [*]
    left --> [*]
    note right of done: Time in chair is used to learn<br/>the average (ignores <1 min and >60 min)
    note left of waiting: Numbers restart every day<br/>(Pakistan time)
```

## Business rules at a glance

| Rule | Why |
|---|---|
| Wait time = people ahead × median of last 10 haircuts | Honest ETA that learns each shop's speed |
| Haircuts under 1 min or over 60 min ignored for average | Mis-taps / forgotten taps don't break the ETA |
| NEXT tapped twice within 3 s is ignored | Double tap must never skip a paying customer |
| One active number per phone | Stops one person booking 5 slots |
| Closed shop: phones can't join, barber can still add walk-ins | Barber stays in control |
| Numbers reset daily | Short, easy numbers ("Number 12", not "Number 1,482") |
| Barber login: PIN, 5 wrong tries → 5 min lock | Customers can't press NEXT |
