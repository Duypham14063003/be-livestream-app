import 'dotenv/config';
import {
  LiveParticipantRole,
  LiveRoomStatus,
  PaymentProvider,
  PrismaClient,
  UserRole,
  VenueType,
} from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.refund.deleteMany(),
    prisma.liveTimelineEvent.deleteMany(),
    prisma.liveOverlay.deleteMany(),
    prisma.liveParticipant.deleteMany(),
    prisma.ticket.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.order.deleteMany(),
    prisma.reservationSeat.deleteMany(),
    prisma.reservation.deleteMany(),
    prisma.seat.deleteMany(),
    prisma.liveRoom.deleteMany(),
    prisma.event.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  const [customer, host] = await prisma.$transaction([
    prisma.user.create({
      data: {
        email: 'customer@demo.local',
        phone: '+8499990001',
        role: UserRole.USER,
      },
    }),
    prisma.user.create({
      data: {
        email: 'host@demo.local',
        phone: '+8499990002',
        role: UserRole.HOST,
      },
    }),
  ]);

  const now = new Date();
  const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);

  const event = await prisma.event.create({
    data: {
      title: 'Tech Broadcast Summit 2026',
      description:
        'Sự kiện livestream với keynote, panel và networking realtime.',
      startAt: start,
      endAt: end,
      venueType: VenueType.HYBRID,
    },
  });

  const liveRoom = await prisma.liveRoom.create({
    data: {
      title: 'Tech Broadcast Summit 2026 - Live',
      agoraChannel: 'tech-broadcast-summit-2026',
      status: LiveRoomStatus.LIVE,
      startedAt: new Date(),
      participants: {
        create: {
          userId: host.id,
          role: LiveParticipantRole.HOST,
        },
      },
      overlays: {
        createMany: {
          data: [
            {
              type: 'banner',
              payload: {
                text: 'Early bird ticket ends in 2 hours',
                cta: 'Book now',
              },
            },
            {
              type: 'poll',
              payload: {
                question: 'Bạn mong chờ track nào nhất?',
                options: ['AI', 'Cloud', 'Mobile'],
              },
            },
          ],
        },
      },
    },
  });

  const seats: Array<{
    eventId: string;
    zone: string;
    row: string;
    number: string;
    price: number;
  }> = [];

  ['A', 'B'].forEach((zone, zoneIndex) => {
    for (let row = 1; row <= 3; row += 1) {
      for (let seat = 1; seat <= 8; seat += 1) {
        seats.push({
          eventId: event.id,
          zone,
          row: row.toString(),
          number: seat.toString().padStart(2, '0'),
          price: zoneIndex === 0 ? 15000 : 10000,
        });
      }
    }
  });

  await prisma.seat.createMany({ data: seats });

  await prisma.auditLog.create({
    data: {
      action: 'SEED_COMPLETED',
      entityType: 'SYSTEM',
      entityId: event.id,
      payload: {
        seededUsers: [customer.id, host.id],
        seededSeats: seats.length,
        defaultProvider: PaymentProvider.STRIPE,
      },
    },
  });

  console.log(
    `Seed done: event=${event.id}, room=${liveRoom.id}, seats=${seats.length}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
