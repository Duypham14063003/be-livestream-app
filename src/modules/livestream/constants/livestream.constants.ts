export const LIVESTREAM_ALLOWED_ROLES = ['host', 'cohost', 'audience'] as const;

export type LivestreamRequestedRole = (typeof LIVESTREAM_ALLOWED_ROLES)[number];

export const LIVESTREAM_ROOM_STATUSES = {
  OFFLINE: 'offline',
  LIVE: 'live',
  ENDED: 'ended',
} as const;

export type LivestreamRoomStatus =
  (typeof LIVESTREAM_ROOM_STATUSES)[keyof typeof LIVESTREAM_ROOM_STATUSES];
