import { FilterAction, FilterType } from "./moderation-filter.dto";
import { ChatMode } from "./chat-config.dto";

export interface ModerationFilter {
  id: string;
  roomId: string;
  pattern: string;
  type: FilterType;
  action: FilterAction;
  timeoutDurationSeconds?: number;
  enabled: boolean;
  createdAt: Date;
}

export interface ChatConfig {
  mode: ChatMode;
  slowModeSeconds: number;
  raidDefenseThreshold: number;
}
