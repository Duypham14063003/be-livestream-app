# Event Streaming & Ticketing App — Project Specification (Flutter)

> **Version:** 1.0.0
> **Last updated:** 2026-04-09
> **Stack:** Flutter 3.x · Dart · Riverpod · GoRouter · Dio · WebSocket · Agora SDK · Stripe/PayPal SDK

---

## 1. Concept & Vision

Ứng dụng mobile cho nền tảng sự kiện trực tuyến/trực tiếp, nơi người dùng có thể mua vé, nhận e-ticket, tham gia livestream chất lượng cao, và thanh toán an toàn qua nhiều cổng. Trọng tâm sản phẩm là:

- Trải nghiệm đặt vé nhanh và minh bạch tồn kho ghế theo thời gian thực.
- Livestream độ trễ thấp, ổn định, có kiểm soát audience và moderator tools.
- Thanh toán tin cậy với đầy đủ luồng recurring, refund và tuân thủ PCI-DSS.

---

## 2. Design Language

### 2.1 Aesthetic Direction

**Modern Broadcast Commerce** — phong cách hiện đại, đậm tính sự kiện trực tiếp, nhấn mạnh trạng thái realtime và hành động nhanh (mua vé, vào live, check-in).

### 2.2 Color Palette

```txt
Primary:        #0B1220  (Navy Deep — nền chính)
Secondary:      #334155  (Slate — text phụ)
Accent:         #F59E0B  (Amber — CTA chính)
Accent 2:       #06B6D4  (Cyan — trạng thái livestream)
Background:     #F8FAFC  (Light gray)
Surface:        #FFFFFF  (Card/background)
Border:         #E2E8F0  (Border nhẹ)
Error:          #DC2626  (Red)
Success:        #16A34A  (Green)
Warning:        #D97706  (Orange)
```

### 2.3 Typography

```txt
Font Family:    "Be Vietnam Pro" (headings + body)
Fallback:       system-ui, sans-serif

Scale:
  xs: 12
  sm: 14
  base: 16
  lg: 18
  xl: 20
  2xl: 24
  3xl: 30

Weights:        400 · 500 · 600 · 700
Line heights:   1.4 (heading) · 1.6 (body)
```

### 2.4 Spatial System

```txt
Base unit:      4dp
Spacing scale:  4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48
Radius:         8 (input) · 12 (card) · 16 (sheet) · 9999 (pill)
```

### 2.5 Motion Philosophy

- **Screen transition:** 180ms ease-out
- **List stagger:** 40ms/item
- **CTA feedback:** scale 0.98 khi tap
- **Realtime cue:** pulse nhẹ cho trạng thái `LIVE`, `HELD`, `PAYMENT_PENDING`

### 2.6 Visual Assets

- **Icons:** Phosphor Icons hoặc Lucide (nhất quán 24dp)
- **Illustrations:** Empty states tối giản
- **Live overlays:** Badge, lower-third, poll card, pinned banner

---

## 3. Layout & Structure

### 3.1 Navigation Shell

```txt
Auth Flow:
  Splash -> Onboarding -> Login/Register -> Verify OTP

Main App (Bottom Tabs):
  Home | Explore | Tickets | Live | Profile

Detail Routes:
  Event Detail
  Seat Map
  Checkout
  Payment Result
  Live Room
  Ticket Detail (QR/PDF)
  Billing History
```

### 3.2 Home

- Hero banner (sự kiện nổi bật)
- Upcoming events carousel
- Quick action: `Join Live`, `My Tickets`, `Scan QR`
- Realtime card: số ghế còn lại / trạng thái live hiện tại

### 3.3 Explore

- Filter theo thể loại, địa điểm, ngày, giá
- Search với gợi ý
- Event card gồm: poster, thời gian, giá từ, số ghế còn

### 3.4 Tickets Tab

- Danh sách vé: `Active`, `Used`, `Refunded`, `Expired`
- Mỗi vé có QR code + trạng thái check-in
- Nút tải PDF e-ticket

### 3.5 Live Tab

- Danh sách rooms đang live
- Truy cập nhanh room đã mua quyền
- Hiển thị phân quyền: `Host`, `Co-host`, `Audience`

### 3.6 Responsive Strategy

```txt
Phone (<600dp):        1-column, bottom sheet cho chọn ghế
Tablet (600-1024dp):   2-pane cho event + seat map
Desktop/Web:           Optional phase 2 (Flutter Web)
```

---

## 4. Features & Interactions

### 4.1 Authentication & User Identity

| Feature | Behavior |
|---|---|
| Login/Register | Email/phone + OTP hoặc social login |
| Session | Access token + refresh token, tự refresh nền |
| Device binding | Lưu thiết bị tin cậy để giảm fraud |
| Logout | Revoke refresh token, clear secure storage |

### 4.2 Live Streaming (Agora)

| Feature | Behavior |
|---|---|
| Join room | Client gọi API lấy Agora RTC/RTM token, join theo role |
| Host publish | Host bật camera/mic, publish stream ngay khi vào room |
| Audience mode | Mặc định subscribe-only, không publish |
| Raise hand | Audience gửi yêu cầu lên moderator để mời co-host |
| Audience management | Host/mod có thể mute, remove, block, promote co-host |
| Low latency | Chế độ live-broadcast profile, adaptive quality |
| Overlays | Banner, lower-third, CTA, poll/survey cập nhật realtime |
| QoS handling | Theo dõi packet loss/jitter; auto degrade quality khi mạng yếu |
| Replay metadata | Lưu timeline sự kiện (join/leave/mod actions) để audit |

### 4.3 Ticket Reservation

| Feature | Behavior |
|---|---|
| Seat map | Render theo zone/row/seat, màu theo trạng thái realtime |
| Hold seat | Chọn ghế tạo `HELD` trong TTL (5-15 phút) |
| Conflict handling | Nếu ghế bị giữ/mua trước, app báo ngay và đề xuất ghế khác |
| Booking confirmation | Thanh toán thành công mới chuyển `HELD -> BOOKED` |
| QR generation | Mỗi ticket có QR duy nhất, chống trùng scan |
| PDF e-ticket | Tạo PDF và gửi email + cho phép tải trong app |
| Availability realtime | Đồng bộ theo WebSocket cho mọi client đang xem cùng event |

**Ticket state machine:**

```txt
AVAILABLE -> HELD -> BOOKED -> CHECKED_IN
HELD -> EXPIRED
BOOKED -> REFUND_PENDING -> REFUNDED
BOOKED -> CANCELLED (policy-dependent)
```

### 4.4 Payment Integration

| Feature | Behavior |
|---|---|
| Payment methods | Stripe, PayPal, Apple Pay, Google Pay |
| Checkout | Tạo Payment Intent/Order ở backend, client chỉ nhận tokenized flow |
| Webhook confirm | Chỉ đánh dấu `PAID` sau khi webhook hợp lệ từ PSP |
| Retry & fallback | Thất bại cho phép đổi cổng thanh toán hoặc retry |
| Refund | Hỗ trợ full/partial refund từ dashboard vận hành |
| Recurring billing | Dùng cho membership/subscription event pass |
| Billing history | Lịch sử invoice/receipt/refund trong app |

### 4.5 Compliance & Security

- Không lưu PAN/CVV trên hệ thống ứng dụng.
- Mọi payment result dựa trên webhook có chữ ký số.
- Idempotency key bắt buộc cho create payment/refund.
- Mã hóa dữ liệu nhạy cảm ở transit (TLS) và at rest.
- Log/audit đầy đủ cho payment, ticket, moderation actions.
- Chính sách tối thiểu quyền truy cập nội bộ (least privilege).

### 4.6 Notifications

| Feature | Behavior |
|---|---|
| Push | Nhắc hết thời gian giữ ghế, trạng thái thanh toán, giờ live bắt đầu |
| In-app | Timeline sự kiện: booked, paid, refunded, check-in |
| Email/SMS | Gửi e-ticket PDF, hóa đơn thanh toán, kết quả refund |

---

## 5. Component Inventory

### 5.1 Base UI Components (Flutter Widgets)

| Component | States | Notes |
|---|---|---|
| `AppButton` | default, loading, disabled | primary/secondary/ghost/danger |
| `AppTextField` | default, focus, error | hỗ trợ formatter cho card/phone |
| `AppBadge` | live, success, warning, error | dùng cho trạng thái vé/live |
| `AppCard` | default, highlighted | card event/ticket |
| `AppBottomSheet` | collapsed, expanded | seat picker/filter |
| `AppSnackbar` | success, warning, error | feedback thao tác |
| `AppSkeleton` | list/card/detail | loading placeholder |
| `AppEmptyState` | — | icon + mô tả + CTA |
| `SeatMapCanvas` | selectable, held, booked | custom painter để hiệu năng tốt |
| `QrTicketView` | active/used/expired | QR + metadata vé |
| `LiveOverlayLayer` | banner/poll/cta | render trên video player |

### 5.2 Feature Components

| Component | Description |
|---|---|
| `EventCard` | poster + giá + thời gian + số ghế còn |
| `SeatLegend` | chú thích trạng thái ghế |
| `CheckoutSummary` | subtotal, fee, discount, total |
| `PaymentMethodSheet` | chọn cổng thanh toán + trạng thái khả dụng |
| `LiveParticipantPanel` | danh sách audience/co-host và moderator actions |
| `BillingTimeline` | history payment/refund/subscription |

---

## 6. Technical Approach

### 6.1 Project Structure (Flutter)

```txt
lib/
├── app/
│   ├── app.dart
│   ├── router.dart
│   └── theme/
├── core/
│   ├── constants/
│   ├── network/            // dio client, interceptors
│   ├── realtime/           // websocket manager
│   ├── security/           // secure storage, token manager
│   ├── errors/
│   └── utils/
├── features/
│   ├── auth/
│   │   ├── data/
│   │   ├── domain/
│   │   └── presentation/
│   ├── events/
│   ├── livestream/
│   ├── reservation/
│   ├── payment/
│   ├── tickets/
│   └── profile/
├── shared/
│   ├── widgets/
│   ├── models/
│   └── providers/
└── main.dart
```

### 6.2 Architecture Pattern

- **Client architecture:** Clean Architecture + Feature-first modules.
- **State management:** Riverpod (AsyncNotifier cho network/realtime states).
- **Navigation:** GoRouter với auth guard.
- **Networking:** Dio + retry + token refresh interceptor.
- **Realtime:** WebSocket cho seat availability, room presence, overlay updates.
- **Media:** Agora RTC/RTM SDK.

### 6.3 Backend Service Boundaries (đề xuất)

```txt
API Gateway
├── Identity Service
├── Event Service
├── Reservation Service
├── Ticket Service
├── Payment Service
├── Livestream Service
└── Notification Service
```

### 6.4 Data Model (Core Entities)

```txt
User(id, email, phone, role, kycStatus)
Event(id, title, startAt, endAt, venueType, liveRoomId)
Seat(id, eventId, zone, row, number, status)
Reservation(id, userId, eventId, expiresAt, status)
ReservationSeat(id, reservationId, seatId, price)
Order(id, userId, amount, currency, status)
Payment(id, orderId, provider, providerRef, status, paidAt)
Ticket(id, orderId, qrCode, pdfUrl, status, checkedInAt)
LiveRoom(id, eventId, agoraChannel, status)
LiveParticipant(id, roomId, userId, role, joinedAt, leftAt)
Refund(id, paymentId, amount, status, reason)
```

### 6.5 API Design (High-level)

```txt
POST   /auth/login
POST   /auth/refresh

GET    /events
GET    /events/{id}

GET    /events/{id}/seats
POST   /reservations               // create hold
POST   /reservations/{id}/confirm  // after payment success
POST   /reservations/{id}/expire

POST   /payments/intents
POST   /payments/confirm
POST   /payments/refunds
POST   /webhooks/stripe
POST   /webhooks/paypal

GET    /tickets
GET    /tickets/{id}
GET    /tickets/{id}/pdf

POST   /livestream/token           // Agora token by role
POST   /livestream/{roomId}/actions/mute
POST   /livestream/{roomId}/actions/promote
GET    /livestream/{roomId}/overlays
```

### 6.6 Realtime Event Topics

```txt
livestream.comment.created
livestream.gift.sent
livestream.viewer_count.updated
livestream.participant.joined
livestream.participant.left
livestream.commenting.toggled
```

### 6.6.1 Livestream Socket.IO Contract

```txt
Transport: Socket.IO
Host: http://<host>:3000
Path: /ws
Auth: auth.token=<jwt> or ?token=<jwt>
```

Subscribe message:

```json
{
  "type": "subscribe",
  "payload": {
    "topic": "livestream.room.<roomId>.comments"
  }
}
```

Event envelope:

```json
{
  "type": "livestream.comment.created",
  "payload": {
    "roomId": "room_123",
    "data": {}
  },
  "timestamp": "2026-04-15T09:00:00.000Z"
}
```

### 6.7 Key Libraries (Flutter)

```txt
flutter_riverpod
go_router
dio
freezed + json_serializable
socket_io_client
agora_rtc_engine
flutter_stripe
pay (Google Pay / Apple Pay)
mobile_scanner
pdf + printing
flutter_secure_storage
firebase_messaging (or OneSignal SDK)
```

### 6.8 Environment Variables

```env
API_BASE_URL=
WS_BASE_URL=
AGORA_APP_ID=
STRIPE_PUBLISHABLE_KEY=
PAYPAL_CLIENT_ID=
APPLE_PAY_MERCHANT_ID=
GOOGLE_PAY_MERCHANT_ID=
SENTRY_DSN=
```

---

## 7. Milestones

| # | Milestone | Deliverables |
|---|---|---|
| 1 | **Foundation** | Flutter scaffold, routing, theming, auth skeleton, CI/CD basic |
| 2 | **Event Discovery** | Home/Explore screens, event detail, search/filter |
| 3 | **Reservation Core** | Seat map, realtime availability, hold seat TTL |
| 4 | **Payment v1** | Stripe + webhook verification + paid flow |
| 5 | **Ticketing v1** | QR ticket generation, ticket wallet, PDF e-ticket |
| 6 | **Livestream v1** | Agora room join/publish/subscribe, role-based access |
| 7 | **Moderator Tools** | Audience management, raise hand, co-host flow, overlays |
| 8 | **Payment v2** | PayPal, Apple Pay, Google Pay, retry/fallback |
| 9 | **Billing & Refund** | Recurring billing, invoice history, refund flows |
| 10 | **Hardening** | Security, PCI checklist, load test, crash/latency monitoring |

---

## 8. Non-Goals (Out of Scope for v1)

- Social features nâng cao (chat public quy mô lớn, gifting economy).
- Multi-tenant white-label cho nhiều brand khác nhau.
- AI moderation tự động cho livestream.
- Marketplace cho bên thứ ba bán vé.
- Flutter Web/Desktop production rollout (chỉ mobile cho v1).
