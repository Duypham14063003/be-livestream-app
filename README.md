# BE Livestream (NestJS + PostgreSQL Docker)

Backend được scaffold theo `SPEC_flutter.md` cho hệ thống Event Streaming & Ticketing.

## Stack

- NestJS 11
- Prisma ORM
- PostgreSQL (Docker Compose)
- Socket.IO WebSocket (realtime topics)
- JWT auth (access token: 15 phút, refresh token: 7 ngày)

## Modules

- `auth`: register / login OTP / refresh / logout
- `events`: danh sách sự kiện, chi tiết, seat map
- `reservations`: giữ ghế TTL, confirm, expire
- `payments`: payment intent, confirm, refund
- `tickets`: ticket wallet, ticket detail, PDF URL
- `livestream`: lấy token join room, mute/promote, overlays
- `webhooks`: stripe/paypal webhook endpoints
- `realtime`: publish các realtime events qua Socket.IO path `/ws`

## Realtime topics (Socket.IO `/ws`)

| Topic                     | Trigger                                  | Description                   |
| ------------------------- | ---------------------------------------- | ----------------------------- |
| `seat.updated`            | Ghế được giữ / mua / trả                 | Cập nhật trạng thái ghế       |
| `reservation.expired`     | Reservation hết TTL hoặc expire thủ công | Reservation hết hạn giữ ghế   |
| `order.paid`              | Thanh toán thành công                    | Đơn hàng được thanh toán      |
| `ticket.issued`           | Reservation confirmed                    | Vé được phát hành             |
| `live.room.created`       | User tạo phòng                           | Phòng livestream mới được tạo |
| `livestream.participant.joined` | User tham gia phòng                | Người xem tham gia livestream |
| `livestream.participant.left`   | User rời / bị remove               | Người xem rời khỏi phòng      |
| `live.overlay.updated`    | Overlay thay đổi                         | Overlay livestream thay đổi   |
| `live.moderation.action`  | Mute / remove / promote                  | Hành động kiểm duyệt          |
| `livestream.comment.created`    | Tạo bình luận                      | Bình luận mới trong room      |
| `livestream.gift.sent`          | Gửi quà                            | Quà mới trong room            |
| `livestream.viewer_count.updated` | Join/leave websocket            | Số viewer gần realtime        |
| `livestream.commenting.toggled` | Host/cohost bật tắt bình luận     | Trạng thái bình luận thay đổi |

### Flutter Livestream Realtime

Livestream mobile client MUST use `socket_io_client`, không dùng `web_socket_channel`, vì backend sử dụng Socket.IO protocol chứ không phải raw WebSocket.

**Connection settings**

- Host: `http://<host>:3000`
- Socket.IO path: `/ws`
- Auth: `auth: {'token': '<jwt>'}` hoặc query `?token=<jwt>`
- Transport: websocket only

**Subscribe frame**

```json
{
  "type": "subscribe",
  "payload": {
    "topic": "livestream.room.<roomId>.comments"
  }
}
```

**Server event envelope**

```json
{
  "type": "livestream.comment.created",
  "payload": {
    "roomId": "room_123",
    "room_id": "room_123",
    "data": {
      "id": "cmt_123",
      "roomId": "room_123",
      "room_id": "room_123",
      "userId": "user_1",
      "user_id": "user_1",
      "displayName": "Alice",
      "display_name": "Alice",
      "message": "hello",
      "createdAt": "2026-04-15T09:00:00.000Z",
      "created_at": "2026-04-15T09:00:00.000Z",
      "isHost": false,
      "is_host": false
    }
  },
  "timestamp": "2026-04-15T09:00:00.000Z"
}
```

**Flutter example**

```dart
import 'dart:async';
import 'package:socket_io_client/socket_io_client.dart' as io;

class LivestreamSocketManager {
  LivestreamSocketManager(this.baseUrl);

  final String baseUrl;
  io.Socket? _socket;
  final _events = StreamController<Map<String, dynamic>>.broadcast();
  final _pendingTopics = <String>{};

  Stream<Map<String, dynamic>> get events => _events.stream;
  bool get isConnected => _socket?.connected == true;

  Future<void> connect({required String token}) async {
    _socket?.dispose();

    _socket = io.io(
      baseUrl,
      io.OptionBuilder()
          .setPath('/ws')
          .setTransports(['websocket'])
          .disableAutoConnect()
          .enableReconnection()
          .setAuth({'token': token})
          .setQuery({'token': token})
          .build(),
    );

    _socket!
      ..onConnect((_) {
        for (final topic in _pendingTopics) {
          _socket!.emit('message', {
            'type': 'subscribe',
            'payload': {'topic': topic},
          });
        }
      })
      ..on('livestream.comment.created', _handleEvent)
      ..on('livestream.gift.sent', _handleEvent)
      ..on('livestream.viewer_count.updated', _handleEvent)
      ..on('livestream.participant.joined', _handleEvent)
      ..on('livestream.commenting.toggled', _handleEvent)
      ..onDisconnect((_) {})
      ..connect();
  }

  void subscribe(String topic) {
    _pendingTopics.add(topic);
    if (isConnected) {
      _socket!.emit('message', {
        'type': 'subscribe',
        'payload': {'topic': topic},
      });
    }
  }

  void unsubscribe(String topic) {
    _pendingTopics.remove(topic);
    if (isConnected) {
      _socket!.emit('message', {
        'type': 'unsubscribe',
        'payload': {'topic': topic},
      });
    }
  }

  void _handleEvent(dynamic raw) {
    if (raw is Map) {
      _events.add(Map<String, dynamic>.from(raw));
    }
  }

  Future<void> dispose() async {
    _socket?.dispose();
    await _events.close();
  }
}
```

## Quick Start

```bash
npm install
cp .env.example .env
docker compose up -d
npx prisma migrate dev --name init
npm run prisma:seed
npm run start:dev
```

Backend mặc định chạy tại: `http://localhost:3000/api/v1`
Swagger UI: `http://localhost:3000/docs`

### Docker DB

- PostgreSQL host port mặc định: `55432`
- pgAdmin host port mặc định: `55050`

Có thể đổi qua biến env: `POSTGRES_PORT`, `PGADMIN_PORT`

### Prisma

- Schema: `prisma/schema.prisma`
- Seed: `prisma/seed.ts`
- Migrations: `prisma/migrations`

---

---

# API Documentation

**Base URL:** `http://localhost:3000/api/v1`
**Authentication:** Bearer token (`Authorization: Bearer <accessToken>`) cho các endpoint cần đăng nhập.

---

## 1. Auth Module — `/auth`

### `POST /auth/register` — Đăng ký tài khoản

**Auth:** Không cần (public)

Đăng ký tài khoản mới với email/số điện thoại và mật khẩu. Trả về user info cùng tokens ngay sau khi đăng ký thành công.

**Request Body:**

```json
{
  "email": "nguyen.van.a@example.com", // string | null (ít nhất 1 trong 2: email hoặc phone)
  "phone": null, // string | null (ít nhất 1 trong 2: email hoặc phone)
  "password": "securePassword123", // string, bắt buộc, tối thiểu 8 ký tự
  "displayName": "Nguyễn Văn A", // string | null (optional)
  "deviceId": "device-uuid-xxx" // string | null (optional, thiết bị đáng tin cậy)
}
```

**Validation Rules:**

- Phải cung cấp ít nhất `email` HOẶC `phone`
- `password`: tối thiểu 8 ký tự
- `email`: format hợp lệ (nếu có)
- `phone`: format E.164 quốc tế (VD: `+84912345678`) (nếu có)
- `email` và `phone` phải là duy nhất trong hệ thống

**Success Response `201 Created`:**

```json
{
  "user": {
    "id": "clx123abc456",
    "email": "nguyen.van.a@example.com",
    "phone": null,
    "displayName": "Nguyễn Văn A",
    "role": "USER",
    "createdAt": "2026-04-09T12:00:00.000Z"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Error Responses:**

| Status | Condition               | Response                                                                |
| ------ | ----------------------- | ----------------------------------------------------------------------- |
| `400`  | Thiếu cả email và phone | `{ "message": "email hoặc phone là bắt buộc", "error": "Bad Request" }` |
| `400`  | Validation error        | NestJS validation response với danh sách lỗi fields                     |
| `409`  | Email đã tồn tại        | `{ "message": "Email đã được sử dụng", "error": "Conflict" }`           |
| `409`  | Phone đã tồn tại        | `{ "message": "Số điện thoại đã được sử dụng", "error": "Conflict" }`   |

**Mobile Integration Notes:**

```dart
// Flutter/Dart example
final res = await dio.post('/auth/register', data: {
  'email': emailController.text,
  'password': passwordController.text,
  'displayName': displayNameController.text,
  'deviceId': deviceId,
});

// Sau khi đăng ký thành công, lưu tokens
await storage.write('accessToken', res.data['accessToken']);
await storage.write('refreshToken', res.data['refreshToken']);
// user info có trong res.data['user']
```

---

### `POST /auth/login` — Đăng nhập (OTP)

**Auth:** Không cần (public)

Đăng nhập bằng email hoặc số điện thoại + OTP. Nếu user chưa tồn tại, hệ thống sẽ tự động tạo mới (auto-create pattern). **Lưu ý:** Hiện tại OTP chưa được verify thực sự — bất kỳ chuỗi ≥4 ký tự nào cũng được chấp nhận (mock OTP).

**Request Body:**

```json
{
  "email": "nguyen.van.a@example.com", // string | null
  "phone": null, // string | null
  "otp": "123456", // string, bắt buộc, tối thiểu 4 ký tự
  "deviceId": "device-uuid-xxx" // string | null (optional)
}
```

**Validation Rules:**

- Phải cung cấp ít nhất `email` HOẶC `phone`
- `otp`: tối thiểu 4 ký tự

**Success Response `200 OK`:**

```json
{
  "user": {
    "id": "clx123abc456",
    "email": "nguyen.van.a@example.com",
    "phone": null,
    "displayName": "Nguyễn Văn A",
    "role": "USER",
    "trustedDevice": "device-uuid-xxx",
    "createdAt": "2026-04-09T12:00:00.000Z",
    "updatedAt": "2026-04-09T14:30:00.000Z"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**JWT Payload:**

```json
{
  "sub": "<userId>",
  "role": "USER | ADMIN | HOST | MODERATOR",
  "iat": 1744185600,
  "exp": 1744186500
}
```

**Error Responses:**

| Status | Condition               | Response                                                                |
| ------ | ----------------------- | ----------------------------------------------------------------------- |
| `400`  | Thiếu cả email và phone | `{ "message": "email hoặc phone là bắt buộc", "error": "Bad Request" }` |
| `400`  | OTP < 4 ký tự           | NestJS validation error                                                 |

**Mobile Integration Notes:**

```dart
// Gửi OTP đến email/phone -> nhận OTP từ user
final res = await dio.post('/auth/login', data: {
  'email': email,
  'otp': userEnteredOtp,
  'deviceId': deviceId,
});
// Lưu tokens tương tự register
```

---

### `POST /auth/refresh` — Làm mới access token

**Auth:** Không cần (public)

Đổi refresh token lấy cặp tokens mới.

**Request Body:**

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": "clx123abc456"
}
```

**Success Response `200 OK`:**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Error Responses:**

| Status | Condition                               |
| ------ | --------------------------------------- |
| `401`  | Refresh token không hợp lệ hoặc hết hạn |
| `401`  | userId không khớp với token payload     |
| `401`  | User không tồn tại                      |

---

### `POST /auth/logout` — Đăng xuất

**Auth:** Cần (Bearer token)

**Request Body:** Không có

**Success Response `200 OK`:**

```json
{
  "success": true,
  "message": "Đăng xuất thành công"
}
```

**Mobile Integration Notes:**

```dart
// Xóa tokens khỏi storage
await storage.delete('accessToken');
await storage.delete('refreshToken');
// Gọi logout API (server logout là no-op, chỉ cần client xóa token)
```

---

## 2. Events Module — `/events`

### `GET /events` — Danh sách sự kiện

**Auth:** Không cần (public)

**Query Parameters:**

| Parameter | Type     | Description                                             |
| --------- | -------- | ------------------------------------------------------- |
| `search`  | `string` | Tìm kiếm theo title hoặc description (case-insensitive) |

**Success Response `200 OK`:**

```json
[
  {
    "id": "evt_abc123",
    "title": "Hội thảo Công nghệ 2026",
    "description": "Sự kiện công nghệ lớn nhất năm...",
    "startAt": "2026-05-01T09:00:00.000Z",
    "endAt": "2026-05-01T18:00:00.000Z",
    "venueType": "HYBRID",
    "createdAt": "2026-01-15T10:00:00.000Z",
    "updatedAt": "2026-01-15T10:00:00.000Z",
    "_count": {
      "seats": 500
    }
  }
]
```

**Notes:** Kết quả được sắp xếp theo `startAt` tăng dần.

---

### `GET /events/:id` — Chi tiết sự kiện

**Auth:** Không cần (public)

**Path Parameters:**

| Parameter | Type     | Description |
| --------- | -------- | ----------- |
| `id`      | `string` | Event ID    |

**Success Response `200 OK`:**

```json
{
  "id": "evt_abc123",
  "title": "Hội thảo Công nghệ 2026",
  "description": "Sự kiện công nghệ lớn nhất năm...",
  "startAt": "2026-05-01T09:00:00.000Z",
  "endAt": "2026-05-01T18:00:00.000Z",
  "venueType": "HYBRID",
  "createdAt": "2026-01-15T10:00:00.000Z",
  "updatedAt": "2026-01-15T10:00:00.000Z",
  "liveRoom": {
    "id": "room_xyz",
    "agoraChannel": "channel_evt_abc123",
    "status": "SCHEDULED"
  },
  "_count": {
    "seats": 500,
    "reservations": 45
  },
  "seatStats": [
    { "status": "AVAILABLE", "_count": { "_all": 400 } },
    { "status": "HELD", "_count": { "_all": 30 } },
    { "status": "BOOKED", "_count": { "_all": 70 } }
  ]
}
```

**Error Responses:**

| Status | Condition           |
| ------ | ------------------- |
| `404`  | Event không tồn tại |

---

### `GET /events/:id/seats` — Bản đồ ghế

**Auth:** Không cần (public)

Lấy toàn bộ ghế của một sự kiện, sắp xếp theo `zone → row → number`.

**Path Parameters:**

| Parameter | Type     | Description |
| --------- | -------- | ----------- |
| `id`      | `string` | Event ID    |

**Success Response `200 OK`:**

```json
[
  {
    "id": "seat_001",
    "eventId": "evt_abc123",
    "zone": "A",
    "row": "1",
    "number": "1",
    "status": "AVAILABLE",
    "price": 500000
  },
  {
    "id": "seat_002",
    "eventId": "evt_abc123",
    "zone": "A",
    "row": "1",
    "number": "2",
    "status": "HELD",
    "price": 500000
  }
]
```

**Seat Status Values:**

| Value        | Description                                      |
| ------------ | ------------------------------------------------ |
| `AVAILABLE`  | Ghế trống, có thể đặt                            |
| `HELD`       | Đang được giữ bởi 1 reservation (chờ thanh toán) |
| `BOOKED`     | Đã được mua                                      |
| `CHECKED_IN` | Người dùng đã check-in                           |

**Mobile Integration Notes:**

```dart
// Lấy seat map để hiển thị sơ đồ ghế
final seats = await dio.get('/events/$eventId/seats');
// Group by zone -> row để render seat map UI
```

---

## 3. Reservations Module — `/reservations`

### `POST /reservations` — Giữ ghế (Tạo Reservation)

**Auth:** Không cần (public)

Tạo một reservation mới để giữ ghế trong thời gian TTL (`SEAT_HOLD_TTL_MINUTES`, mặc định 10 phút). Trong thời gian này, ghế sẽ không ai khác đặt được. Quá hạn → ghế tự động trả về AVAILABLE.

**Request Body:**

```json
{
  "userId": "clx123abc456",
  "eventId": "evt_abc123",
  "seatIds": ["seat_001", "seat_002"]
}
```

**Validation Rules:**

- `userId`, `eventId`, `seatIds` là bắt buộc
- `seatIds` phải là array, tối thiểu 1 phần tử, không trùng nhau
- Tất cả ghế phải thuộc về `eventId` đã cung cấp
- Tất cả ghế phải ở trạng thái `AVAILABLE`

**Success Response `201 Created`:**

```json
{
  "id": "res_abc789",
  "userId": "clx123abc456",
  "eventId": "evt_abc123",
  "status": "HELD",
  "expiresAt": "2026-04-09T12:15:00.000Z",
  "createdAt": "2026-04-09T12:05:00.000Z",
  "updatedAt": "2026-04-09T12:05:00.000Z",
  "reservationSeats": [
    {
      "id": "rs_001",
      "reservationId": "res_abc789",
      "seatId": "seat_001",
      "price": 500000,
      "seat": {
        "id": "seat_001",
        "zone": "A",
        "row": "1",
        "number": "1",
        "status": "HELD",
        "price": 500000
      }
    },
    {
      "id": "rs_002",
      "reservationId": "res_abc789",
      "seatId": "seat_002",
      "price": 500000,
      "seat": {
        "id": "seat_002",
        "zone": "A",
        "row": "1",
        "number": "2",
        "status": "HELD",
        "price": 500000
      }
    }
  ]
}
```

**Realtime Event:** Phát `seat.updated` → các client khác cập nhật seat map.

**Error Responses:**

| Status | Condition                                         | Response                                           |
| ------ | ------------------------------------------------- | -------------------------------------------------- |
| `404`  | User không tồn tại                                | `{ "message": "User không tồn tại" }`              |
| `404`  | Event không tồn tại                               | `{ "message": "Event không tồn tại" }`             |
| `400`  | seatIds trùng nhau                                | `{ "message": "seatIds không được trùng nhau" }`   |
| `409`  | Một hoặc nhiều ghế đã được giữ/mua bởi người khác | Ghế không còn AVAILABLE → app nên refresh seat map |

**Mobile Integration Flow:**

```dart
// 1. User chọn ghế -> Gọi reserve
final reservation = await dio.post('/reservations', data: {
  'userId': currentUserId,
  'eventId': eventId,
  'seatIds': selectedSeatIds,
});

// 2. Bắt đầu đếm ngược TTL (expiresAt)
// 3. Chuyển sang màn thanh toán
// 4. Nếu hết giờ -> hiện thông báo, refresh seat map
```

---

### `POST /reservations/:id/confirm` — Xác nhận Reservation (Thanh toán)

**Auth:** Không cần (public)

Xác nhận reservation và tạo Order + Payment + Tickets trong một transaction. Sau khi confirm thành công, các ghế chuyển sang trạng thái `BOOKED`.

**Path Parameters:**

| Parameter | Type     | Description    |
| --------- | -------- | -------------- |
| `id`      | `string` | Reservation ID |

**Request Body:**

```json
{
  "provider": "STRIPE",
  "idempotencyKey": "order_evt123_userabc_001",
  "providerRef": "pi_xxx_xxx"
}
```

**Fields:**

| Field            | Type     | Required | Description                                   |
| ---------------- | -------- | -------- | --------------------------------------------- |
| `provider`       | `enum`   | ✅       | `STRIPE`, `PAYPAL`, `APPLE_PAY`, `GOOGLE_PAY` |
| `idempotencyKey` | `string` | ✅       | Key chống trùng lặp, tối thiểu 8 ký tự        |
| `providerRef`    | `string` | ❌       | Payment intent reference từ provider          |

**Success Response `200 OK`:**

```json
{
  "id": "order_xyz",
  "userId": "clx123abc456",
  "reservationId": "res_abc789",
  "amount": 1000000,
  "currency": "USD",
  "status": "PAID",
  "createdAt": "2026-04-09T12:08:00.000Z",
  "updatedAt": "2026-04-09T12:08:00.000Z",
  "payment": {
    "id": "pay_abc",
    "orderId": "order_xyz",
    "provider": "STRIPE",
    "providerRef": "pi_xxx_xxx",
    "status": "PAID",
    "paidAt": "2026-04-09T12:08:00.000Z",
    "idempotencyKey": "order_evt123_userabc_001"
  },
  "tickets": [
    {
      "id": "ticket_001",
      "orderId": "order_xyz",
      "seatId": "seat_001",
      "qrCode": "uuid-qr-code-1",
      "pdfUrl": "https://cdn.example.com/tickets/order_xyz/seat_001.pdf",
      "status": "ACTIVE"
    },
    {
      "id": "ticket_002",
      "orderId": "order_xyz",
      "seatId": "seat_002",
      "qrCode": "uuid-qr-code-2",
      "pdfUrl": "https://cdn.example.com/tickets/order_xyz/seat_002.pdf",
      "status": "ACTIVE"
    }
  ]
}
```

**Realtime Events:**

- `order.paid` → thông báo cho app
- `seat.updated` → ghế chuyển sang `BOOKED`
- `ticket.issued` → vé được phát hành

**Error Responses:**

| Status | Condition                                                 |
| ------ | --------------------------------------------------------- |
| `404`  | Reservation không tồn tại                                 |
| `400`  | Reservation không ở trạng thái HELD (đã confirm trước đó) |
| `409`  | Reservation đã hết hạn (expired)                          |
| `409`  | IdempotencyKey đã được sử dụng cho giao dịch khác         |

**Mobile Integration Flow:**

```dart
// 1. Gọi POST /payments/intents để tạo payment intent (optional)
final intent = await dio.post('/payments/intents', data: {
  'reservationId': reservationId,
  'provider': 'STRIPE',
  'idempotencyKey': idempotencyKey,
});

// 2. Xử lý thanh toán với Stripe SDK trên app
await stripeSdk.confirmPayment(intent.data['clientSecret']);

// 3. Gọi confirm reservation
final order = await dio.post('/reservations/$reservationId/confirm', data: {
  'provider': 'STRIPE',
  'idempotencyKey': idempotencyKey,
  'providerRef': stripePaymentIntentId,
});

// 4. Lưu tickets vào local storage
for (final ticket in order.data['tickets']) {
  await saveTicket(ticket);
}
```

---

### `POST /reservations/:id/expire` — Hủy giữ ghế

**Auth:** Không cần (public)

Hủy reservation đang ở trạng thái `HELD`, giải phóng ghế về `AVAILABLE`.

**Path Parameters:**

| Parameter | Type     | Description    |
| --------- | -------- | -------------- |
| `id`      | `string` | Reservation ID |

**Request Body:**

```json
{
  "reason": "user_cancelled"
}
```

**Success Response `200 OK`:**

```json
{
  "id": "res_abc789",
  "eventId": "evt_abc123",
  "status": "EXPIRED",
  "seatIds": ["seat_001", "seat_002"]
}
```

**Error Responses:**

| Status | Condition                                   |
| ------ | ------------------------------------------- |
| `404`  | Reservation không tồn tại                   |
| `400`  | Reservation đã CONFIRMED (không thể expire) |

**Realtime Event:** `seat.updated` → ghế chuyển về `AVAILABLE`

---

### `GET /reservations/:id` — Chi tiết Reservation

**Auth:** Không cần (public)

**Path Parameters:**

| Parameter | Type     | Description    |
| --------- | -------- | -------------- |
| `id`      | `string` | Reservation ID |

**Success Response `200 OK`:**

```json
{
  "id": "res_abc789",
  "userId": "clx123abc456",
  "eventId": "evt_abc123",
  "status": "CONFIRMED",
  "expiresAt": "2026-04-09T12:15:00.000Z",
  "createdAt": "2026-04-09T12:05:00.000Z",
  "reservationSeats": [
    {
      "id": "rs_001",
      "seatId": "seat_001",
      "price": 500000,
      "seat": { "id": "seat_001", "zone": "A", "row": "1", "number": "1" }
    }
  ],
  "order": {
    "id": "order_xyz",
    "amount": 1000000,
    "status": "PAID",
    "payment": {
      "id": "pay_abc",
      "provider": "STRIPE",
      "status": "PAID"
    },
    "tickets": [
      {
        "id": "ticket_001",
        "qrCode": "uuid-qr-code",
        "status": "ACTIVE"
      }
    ]
  }
}
```

---

## 4. Payments Module — `/payments`

### `POST /payments/intents` — Tạo Payment Intent

**Auth:** Không cần (public)

Tạo một payment intent cho reservation. Tạo Order ở trạng thái `PENDING` và Payment ở trạng thái `PENDING`.

**Request Body:**

```json
{
  "reservationId": "res_abc789",
  "provider": "STRIPE",
  "idempotencyKey": "pi_evt123_userabc_001"
}
```

**Success Response `201 Created`:**

```json
{
  "paymentId": "pay_new123",
  "orderId": "order_new456",
  "status": "PENDING",
  "clientSecret": "pi_pay_new123_secret_demo"
}
```

**Notes:**

- `clientSecret` là mock — trong production sẽ là secret thật từ Stripe
- Idempotent: nếu `idempotencyKey` đã tồn tại, trả về payment hiện có

**Error Responses:**

| Status | Condition                    |
| ------ | ---------------------------- |
| `404`  | Reservation không tồn tại    |
| `400`  | Reservation không có ghế nào |

---

### `POST /payments/confirm` — Xác nhận thanh toán

**Auth:** Không cần (public)

Xác nhận hoặc từ chối một payment.

**Request Body:**

```json
{
  "paymentId": "pay_abc123",
  "paid": true,
  "providerRef": "pi_stripe_real_id"
}
```

| Field         | Type      | Required | Description                                        |
| ------------- | --------- | -------- | -------------------------------------------------- |
| `paymentId`   | `string`  | ✅       | Payment ID                                         |
| `paid`        | `boolean` | ✅       | `true` = thanh toán thành công, `false` = thất bại |
| `providerRef` | `string`  | ❌       | Reference từ payment provider                      |

**Success Response `200 OK`:**

```json
{
  "payment": {
    "id": "pay_abc123",
    "status": "PAID",
    "paidAt": "2026-04-09T12:08:00.000Z",
    "providerRef": "pi_stripe_real_id"
  },
  "idempotent": false
}
```

**Error Responses:**

| Status | Condition             |
| ------ | --------------------- |
| `404`  | Payment không tồn tại |

---

### `POST /payments/refunds` — Hoàn tiền

**Auth:** Không cần (public)

Tạo refund cho một payment. Hỗ trợ refund một phần hoặc toàn bộ.

**Request Body:**

```json
{
  "paymentId": "pay_abc123",
  "amount": 500000,
  "reason": "customer_request",
  "idempotencyKey": "refund_pay123_userabc_001"
}
```

| Field            | Type     | Required | Description                                                                            |
| ---------------- | -------- | -------- | -------------------------------------------------------------------------------------- |
| `paymentId`      | `string` | ✅       | Payment ID cần refund                                                                  |
| `amount`         | `number` | ❌       | Số tiền refund (số nguyên, đơn vị minor currency). Nếu không cung cấp → refund toàn bộ |
| `reason`         | `string` | ❌       | Lý do refund                                                                           |
| `idempotencyKey` | `string` | ✅       | Key chống trùng lặp, tối thiểu 8 ký tự                                                 |

**Success Response `200 OK`:**

```json
{
  "id": "refund_abc",
  "paymentId": "pay_abc123",
  "amount": 500000,
  "reason": "customer_request",
  "status": "SUCCEEDED",
  "idempotencyKey": "refund_pay123_userabc_001",
  "createdAt": "2026-04-09T15:00:00.000Z"
}
```

**Error Responses:**

| Status | Condition                                                  |
| ------ | ---------------------------------------------------------- |
| `404`  | Payment không tồn tại                                      |
| `400`  | Payment chưa được thanh toán                               |
| `409`  | Số tiền refund không hợp lệ (vượt quá số dư có thể refund) |

**Notes:**

- Idempotent: nếu `idempotencyKey` đã tồn tại → trả về refund cũ
- Nếu refund đủ 100% → Payment chuyển sang `REFUNDED`, Tickets chuyển sang `REFUNDED`
- Nếu refund một phần → Order chuyển sang `REFUND_PENDING`

---

## 5. Tickets Module — `/tickets`

### `GET /tickets` — Danh sách vé

**Auth:** Không cần (public)

**Query Parameters:**

| Parameter | Type     | Description                                                             |
| --------- | -------- | ----------------------------------------------------------------------- |
| `userId`  | `string` | Lọc theo user (optional)                                                |
| `status`  | `enum`   | Lọc theo trạng thái: `ACTIVE`, `USED`, `REFUNDED`, `EXPIRED` (optional) |

**Success Response `200 OK`:**

```json
[
  {
    "id": "ticket_001",
    "orderId": "order_xyz",
    "seatId": "seat_001",
    "qrCode": "uuid-qr-code",
    "pdfUrl": "https://cdn.example.com/tickets/order_xyz/seat_001.pdf",
    "status": "ACTIVE",
    "checkedInAt": null,
    "createdAt": "2026-04-09T12:08:00.000Z",
    "seat": {
      "id": "seat_001",
      "zone": "A",
      "row": "1",
      "number": "1",
      "price": 500000
    },
    "order": {
      "id": "order_xyz",
      "amount": 1000000,
      "status": "PAID",
      "reservation": {
        "id": "res_abc789",
        "event": {
          "id": "evt_abc123",
          "title": "Hội thảo Công nghệ 2026",
          "startAt": "2026-05-01T09:00:00.000Z"
        }
      }
    }
  }
]
```

**Notes:** Kết quả sắp xếp theo `createdAt` giảm dần (mới nhất trước).

---

### `GET /tickets/:id` — Chi tiết vé

**Auth:** Không cần (public)

**Path Parameters:**

| Parameter | Type     | Description |
| --------- | -------- | ----------- |
| `id`      | `string` | Ticket ID   |

**Success Response `200 OK`:**

```json
{
  "id": "ticket_001",
  "orderId": "order_xyz",
  "seatId": "seat_001",
  "qrCode": "uuid-qr-code",
  "pdfUrl": "https://cdn.example.com/tickets/order_xyz/seat_001.pdf",
  "status": "ACTIVE",
  "checkedInAt": null,
  "createdAt": "2026-04-09T12:08:00.000Z",
  "seat": {
    "id": "seat_001",
    "zone": "A",
    "row": "1",
    "number": "1",
    "price": 500000
  },
  "order": {
    "id": "order_xyz",
    "amount": 1000000,
    "currency": "USD",
    "status": "PAID",
    "reservation": {
      "id": "res_abc789",
      "event": {
        "id": "evt_abc123",
        "title": "Hội thảo Công nghệ 2026",
        "startAt": "2026-05-01T09:00:00.000Z",
        "endAt": "2026-05-01T18:00:00.000Z",
        "venueType": "HYBRID",
        "liveRoom": {
          "id": "room_xyz",
          "status": "SCHEDULED"
        }
      }
    },
    "payment": {
      "id": "pay_abc",
      "provider": "STRIPE",
      "status": "PAID",
      "paidAt": "2026-04-09T12:08:00.000Z"
    }
  }
}
```

---

### `GET /tickets/:id/pdf` — URL PDF vé

**Auth:** Không cần (public)

**Path Parameters:**

| Parameter | Type     | Description |
| --------- | -------- | ----------- |
| `id`      | `string` | Ticket ID   |

**Success Response `200 OK`:**

```json
{
  "ticketId": "ticket_001",
  "pdfUrl": "https://cdn.example.com/tickets/order_xyz/seat_001.pdf"
}
```

---

## 6. Livestream Module — `/livestream`

**⚠️ Tất cả endpoint trong module này YÊU CẦU XÁC THỰC (Bearer token)**

Rate limit: `POST /livestream/token` — tối đa 20 requests/phút.

---

### `POST /livestream/rooms` — Tạo phòng Livestream

**Auth:** Cần (Bearer token)

Tạo một phòng livestream mới do user sở hữu. Ai cũng có thể tạo — không cần vé sự kiện. User tạo phòng sẽ tự động là HOST.

**Request Body:**

```json
{
  "title": "Live stream chia sẻ kinh nghiệm lập trình"
}
```

| Field   | Type     | Required | Description                                    |
| ------- | -------- | -------- | ---------------------------------------------- |
| `title` | `string` | ❌       | Tiêu đề phòng. Mặc định: `"Live của {userId}"` |

**Success Response `201 Created`:**

```json
{
  "id": "room_abc123",
  "title": "Live stream chia sẻ kinh nghiệm lập trình",
  "agora_channel": "live_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "status": "offline",
  "host_id": "clx123abc456",
  "created_at": "2026-04-09T12:00:00.000Z"
}
```

**Realtime Event:** `live.room.created` → phát cho tất cả client đang kết nối WebSocket.

**Mobile Integration:**

```dart
// Tạo phòng live
final room = await dio.post('/livestream/rooms',
  data: {'title': 'Live của tôi'},
  options: Options(headers: {'Authorization': 'Bearer $accessToken'})
);

// Lấy token để bắt đầu stream
final token = await dio.post('/livestream/token',
  data: {'room_id': room.data['id'], 'user_id': currentUserId, 'role': 'host'},
  options: Options(headers: {'Authorization': 'Bearer $accessToken'})
);
```

---

### `GET /livestream/rooms` — Danh sách phòng

**Auth:** Cần (Bearer token)

Lấy danh sách phòng livestream mà user có quyền truy cập.

**Success Response `200 OK`:**

```json
{
  "data": [
    {
      "id": "room_xyz",
      "title": "Hội thảo Công nghệ 2026",
      "agora_channel": "channel_evt_abc123",
      "status": "live",
      "viewer_count": 1523,
      "viewerCount": 1523,
      "host_id": "clx123abc456",
      "started_at": "2026-05-01T09:00:00.000Z"
    }
  ]
}
```

**Room Status Values:**

| Value     | Description              |
| --------- | ------------------------ |
| `offline` | Chưa bắt đầu (SCHEDULED) |
| `live`    | Đang live                |
| `ended`   | Đã kết thúc              |

**Access Control:**

- `ADMIN`: thấy tất cả phòng
- User là participant của phòng: thấy phòng đó

---

### `POST /livestream/rooms/:roomId/comments` — Tạo comment

**Auth:** Cần (Bearer token)

**Request Body:**

```json
{
  "message": "Hello livestream"
}
```

**Success Response `201 Created`:**

```json
{
  "data": {
    "id": "cmt_123",
    "roomId": "room_xyz",
    "room_id": "room_xyz",
    "userId": "clx_user_1",
    "user_id": "clx_user_1",
    "displayName": "Alice",
    "display_name": "Alice",
    "message": "Hello livestream",
    "createdAt": "2026-04-15T09:00:00.000Z",
    "created_at": "2026-04-15T09:00:00.000Z",
    "isHost": false,
    "is_host": false
  }
}
```

**Realtime Event:** `livestream.comment.created`

---

### `POST /livestream/rooms/:roomId/gifts` — Gửi gift

**Auth:** Cần (Bearer token)

**Request Body:**

```json
{
  "giftType": "heart"
}
```

**Success Response `201 Created`:**

```json
{
  "data": {
    "id": "gift_123",
    "roomId": "room_xyz",
    "room_id": "room_xyz",
    "userId": "clx_user_1",
    "user_id": "clx_user_1",
    "displayName": "Alice",
    "display_name": "Alice",
    "giftType": "heart",
    "gift_type": "heart",
    "giftName": "Heart",
    "gift_name": "Heart",
    "giftEmoji": "❤️",
    "gift_emoji": "❤️",
    "createdAt": "2026-04-15T09:00:00.000Z",
    "created_at": "2026-04-15T09:00:00.000Z"
  }
}
```

**Realtime Event:** `livestream.gift.sent`

---

### `POST /livestream/token` — Lấy Agora RTC Token

**Auth:** Cần (Bearer token)

**⚠️ Rate Limit: 20 requests/phút**

Lấy Agora RTC token để tham gia phòng livestream.

**Request Body:**

```json
{
  "channelName": "event-live-001",
  "uid": 1001,
  "role": "host"
}
```

| Field         | Type     | Required | Description                 |
| ------------- | -------- | -------- | --------------------------- |
| `channelName` | `string` | ✅       | Agora channel name          |
| `uid`         | `number` | ✅       | Agora UID (số nguyên dương) |
| `role`        | `string` | ✅       | `host` \| `audience`        |

Legacy compatibility: backend vẫn chấp nhận `channel_name`.

**Token Expiry:**

- Mặc định: 20 phút (configurable qua `AGORA_RTC_TOKEN_TTL_SECONDS`)
- Giới hạn: 10–30 phút

**Success Response `200 OK`:**

```json
{
  "data": {
    "token": "007eJxTY...",
    "app_id": "agora_app_id_xxx",
    "appId": "agora_app_id_xxx",
    "channel_name": "channel_evt_abc123",
    "channelName": "channel_evt_abc123",
    "uid": 1001,
    "expire_at": "2026-04-09T12:30:00.000Z"
  }
}
```

**Agora Role Mapping:**

| Requested Role | Participant Role | Token Privilege     |
| -------------- | ---------------- | ------------------- |
| `audience`     | AUDIENCE         | Subscribe only      |
| `host`         | HOST             | Publish + Subscribe |

**Error Responses:**

| Status | Code                 | Condition                 |
| ------ | -------------------- | ------------------------- |
| `422`  | `invalid_role`       | `role` không hợp lệ       |
| `422`  | `invalid_uid`        | `uid` không hợp lệ        |
| `500`  | `agora_token_failed` | Không thể tạo Agora token |

**Mobile Integration:**

```dart
// 1. Join livestream room
final tokenRes = await dio.post('/livestream/token',
  data: {'channelName': 'event-live-001', 'uid': 1001, 'role': 'host'},
  options: Options(headers: {'Authorization': 'Bearer $accessToken'})
);

// 2. Dùng Agora SDK để join channel
agoraEngine.joinChannel(
  token: tokenRes.data['data']['token'],
  channelId: tokenRes.data['data']['channel_name'],
  uid: tokenRes.data['data']['uid'],
);

// 3. Khi token sắp hết hạn (expire_at - 30s), gọi lại token
```

---

### `POST /livestream/moderation/mute` — Tắt tiếng người tham gia

**Auth:** Cần (Bearer token, chỉ HOST hoặc CO_HOST)

**Request Body:**

```json
{
  "room_id": "room_xyz",
  "target_user_id": "clx_target_user_id",
  "reason": "spam",
  "duration_seconds": 300
}
```

| Field              | Type     | Required | Description      |
| ------------------ | -------- | -------- | ---------------- |
| `room_id`          | `string` | ✅       | LiveRoom ID      |
| `target_user_id`   | `string` | ✅       | User ID cần mute |
| `reason`           | `string` | ❌       | Lý do mute       |
| `duration_seconds` | `number` | ❌       |

|

**Success Response `200 OK`:**

```json
{
  "data": {
    "success": true,
    "room_id": "room_xyz",
    "target_user_id": "clx_target_user_id",
    "action": "mute"
  }
}
```

**Realtime Event:** `live.moderation.action` → client mute audio của target user.

---

### `POST /livestream/moderation/remove` — Xóa người tham gia

**Auth:** Cần (Bearer token, chỉ HOST hoặc CO_HOST)

**Request Body:**

```json
{
  "room_id": "room_xyz",
  "target_user_id": "clx_target_user_id",
  "reason": "vi phạm quy định"
}
```

**Success Response `200 OK`:**

```json
{
  "data": {
    "success": true,
    "room_id": "room_xyz",
    "target_user_id": "clx_target_user_id",
    "action": "remove"
  }
}
```

**Realtime Events:** `livestream.participant.left` + `live.moderation.action`

---

### `POST /livestream/moderation/promote` — Thăng cấp người tham gia

**Auth:** Cần (Bearer token)

- Thăng lên `cohost`: cần HOST hoặc CO_HOST hiện tại
- Thăng lên `host`: chỉ HOST mới được làm

**Request Body:**

```json
{
  "room_id": "room_xyz",
  "target_user_id": "clx_target_user_id",
  "role": "cohost"
}
```

| Field            | Type     | Required | Description                                  |
| ---------------- | -------- | -------- | -------------------------------------------- |
| `room_id`        | `string` | ✅       | LiveRoom ID                                  |
| `target_user_id` | `string` | ✅       | User ID cần thăng cấp                        |
| `role`           | `string` | ✅       | `host` hoặc `cohost` (không phải `audience`) |

**Success Response `200 OK`:**

```json
{
  "data": {
    "room_id": "room_xyz",
    "target_user_id": "clx_target_user_id",
    "role": "cohost",
    "participant_id": "participant_abc123"
  }
}
```

**Realtime Event:** `live.moderation.action`

---

## 7. Webhooks Module — `/webhooks`

**⚠️ Không cần Bearer token. Xác thực qua webhook signatures từ provider.**

---

### `POST /webhooks/stripe` — Stripe Webhook

**Headers:**

| Header             | Description              |
| ------------------ | ------------------------ |
| `stripe-signature` | Stripe webhook signature |

**Payloads handled:**

| Event Type                      | Action                                   |
| ------------------------------- | ---------------------------------------- |
| `payment_intent.succeeded`      | Gọi `payments/confirm` với `paid: true`  |
| `payment_intent.payment_failed` | Gọi `payments/confirm` với `paid: false` |

**Body Format (from Stripe):**

```json
{
  "id": "evt_xxx",
  "type": "payment_intent.succeeded",
  "data": {
    "object": {
      "id": "pi_stripe_real_id",
      "metadata": {
        "paymentId": "pay_abc123"
      }
    }
  }
}
```

**Success Response `200 OK`:**

```json
{
  "received": true,
  "provider": "stripe",
  "eventType": "payment_intent.succeeded"
}
```

---

### `POST /webhooks/paypal` — PayPal Webhook

**Headers:**

| Header                   | Description       |
| ------------------------ | ----------------- |
| `paypal-transmission-id` | PayPal webhook ID |

**Payloads handled:**

| Event Type                  | Action                                   |
| --------------------------- | ---------------------------------------- |
| `PAYMENT.CAPTURE.COMPLETED` | Gọi `payments/confirm` với `paid: true`  |
| `PAYMENT.CAPTURE.DENIED`    | Gọi `payments/confirm` với `paid: false` |

**Body Format (from PayPal):**

```json
{
  "id": "WH-xxx",
  "event_type": "PAYMENT.CAPTURE.COMPLETED",
  "resource": {
    "id": "capture_xxx",
    "custom_id": "pay_abc123"
  }
}
```

**Success Response `200 OK`:**

```json
{
  "received": true,
  "provider": "paypal",
  "eventType": "PAYMENT.CAPTURE.COMPLETED"
}
```

---

## 8. Enums Reference

### UserRole

```json
["USER", "ADMIN", "HOST", "MODERATOR"]
```

### VenueType

```json
["ONLINE", "OFFLINE", "HYBRID"]
```

### SeatStatus

```json
["AVAILABLE", "HELD", "BOOKED", "CHECKED_IN"]
```

### ReservationStatus

```json
["HELD", "CONFIRMED", "EXPIRED", "CANCELLED"]
```

### OrderStatus

```json
["PENDING", "PAID", "REFUND_PENDING", "REFUNDED", "CANCELLED"]
```

### PaymentProvider

```json
["STRIPE", "PAYPAL", "APPLE_PAY", "GOOGLE_PAY"]
```

### PaymentStatus

```json
["PENDING", "PAID", "FAILED", "REFUNDED"]
```

### TicketStatus

```json
["ACTIVE", "USED", "REFUNDED", "EXPIRED"]
```

### LiveRoomStatus

```json
["SCHEDULED", "LIVE", "ENDED"]
```

### LiveParticipantRole

```json
["HOST", "CO_HOST", "AUDIENCE", "BLOCKED"]
```

### RefundStatus

```json
["PENDING", "SUCCEEDED", "FAILED"]
```

---

## 9. Common Error Codes

| HTTP Status | Code                  | Description                                |
| ----------- | --------------------- | ------------------------------------------ |
| `400`       | Validation errors     | Request body/query không hợp lệ            |
| `401`       | Unauthorized          | Token không hợp lệ hoặc hết hạn            |
| `403`       | Forbidden             | Không có quyền thực hiện action            |
| `404`       | Not Found             | Entity không tồn tại                       |
| `409`       | Conflict              | Ghế đã bị giữ, idempotency key trùng, etc. |
| `422`       | Unprocessable Entity  | Role không hợp lệ cho livestream           |
| `500`       | Internal Server Error | Lỗi server (token generation, DB, etc.)    |

---

## 10. Flow tổng hợp cho Mobile App

### Flow 1: Đăng ký & Đăng nhập

```
[Register] POST /auth/register
         → { user, accessToken, refreshToken }
         → Lưu tokens vào secure storage

[Login OTP] POST /auth/login
         → { user, accessToken, refreshToken }
         → Cập nhật tokens
```

### Flow 2: Mua vé

```
1. [Browse Events] GET /events
2. [Event Detail] GET /events/:id  → seatStats, liveRoom
3. [Seat Map] GET /events/:id/seats  → all seats
4. [Select Seats] → UI: user chọn ghế
5. [Hold Seats] POST /reservations
                → { reservation, expiresAt }
                → Bắt đầu countdown TTL
6. [Create Payment Intent] POST /payments/intents
                           → { clientSecret }
7. [Process Payment] Stripe SDK on app
8. [Confirm] POST /reservations/:id/confirm
           → { order, payment, tickets }
9. [Get PDF] GET /tickets/:id/pdf  → pdfUrl
```

### Flow 3: Tham gia Livestream

```
1. [Get Rooms] GET /livestream/rooms  (Auth)
2. [Get Token] POST /livestream/token  (Auth, 20 req/min limit)
             → { app_id, channel_name, token, uid }
3. [Join Channel] agoraEngine.joinChannel(token, channel, uid)
4. [Token Refresh] Trước khi expire_at - 30s → gọi lại step 2
5. [Moderation] mute/remove/promote khi cần
```

---

## Notes

- Payment integration hiện là mock flow để bám contract API, chưa gọi SDK thực của Stripe/PayPal.
- Agora RTC token được generate server-side bằng `agora-token` (AccessToken2), không tạo token ở client.
- Token endpoint có rate limit bằng `@nestjs/throttler`.
- Reservation TTL job chạy mỗi phút để auto-expire các reservation quá hạn.
- Không có refresh token storage/invalidation — logout là no-op phía server (client tự xóa tokens).
- CORS hiện mở toàn bộ (`origin: '*'`) — production nên restrict.

# be-livestream-app
