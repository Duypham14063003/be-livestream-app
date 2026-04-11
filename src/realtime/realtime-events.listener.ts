import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { REALTIME_TOPICS } from '../common/constants/realtime-topics';
import { RealtimeGateway } from './realtime.gateway';

@Injectable()
export class RealtimeEventsListener {
  constructor(private readonly realtimeGateway: RealtimeGateway) {}

  @OnEvent(REALTIME_TOPICS.SEAT_UPDATED)
  onSeatUpdated(payload: unknown) {
    this.realtimeGateway.publish(REALTIME_TOPICS.SEAT_UPDATED, payload);
  }

  @OnEvent(REALTIME_TOPICS.RESERVATION_EXPIRED)
  onReservationExpired(payload: unknown) {
    this.realtimeGateway.publish(REALTIME_TOPICS.RESERVATION_EXPIRED, payload);
  }

  @OnEvent(REALTIME_TOPICS.ORDER_PAID)
  onOrderPaid(payload: unknown) {
    this.realtimeGateway.publish(REALTIME_TOPICS.ORDER_PAID, payload);
  }

  @OnEvent(REALTIME_TOPICS.TICKET_ISSUED)
  onTicketIssued(payload: unknown) {
    this.realtimeGateway.publish(REALTIME_TOPICS.TICKET_ISSUED, payload);
  }

  @OnEvent(REALTIME_TOPICS.LIVE_PARTICIPANT_JOINED)
  onLiveParticipantJoined(payload: unknown) {
    this.realtimeGateway.publish(REALTIME_TOPICS.LIVE_PARTICIPANT_JOINED, payload);
  }

  @OnEvent(REALTIME_TOPICS.LIVE_PARTICIPANT_LEFT)
  onLiveParticipantLeft(payload: unknown) {
    this.realtimeGateway.publish(REALTIME_TOPICS.LIVE_PARTICIPANT_LEFT, payload);
  }

  @OnEvent(REALTIME_TOPICS.LIVE_OVERLAY_UPDATED)
  onLiveOverlayUpdated(payload: unknown) {
    this.realtimeGateway.publish(REALTIME_TOPICS.LIVE_OVERLAY_UPDATED, payload);
  }

  @OnEvent(REALTIME_TOPICS.LIVE_MODERATION_ACTION)
  onLiveModerationAction(payload: unknown) {
    this.realtimeGateway.publish(REALTIME_TOPICS.LIVE_MODERATION_ACTION, payload);
  }

  @OnEvent(REALTIME_TOPICS.LIVE_ROOM_CREATED)
  onLiveRoomCreated(payload: unknown) {
    this.realtimeGateway.publish(REALTIME_TOPICS.LIVE_ROOM_CREATED, payload);
  }
}
