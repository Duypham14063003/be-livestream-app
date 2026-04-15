import { IsEnum } from 'class-validator';

export enum LiveGiftTypeEnum {
  HEART = 'heart',
  ROSE = 'rose',
  STAR = 'star',
  ROCKET = 'rocket',
  CROWN = 'crown',
  DIAMOND = 'diamond',
}

export class SendGiftDto {
  @IsEnum(LiveGiftTypeEnum)
  giftType!: LiveGiftTypeEnum;
}