import { Module } from "@nestjs/common";
import { SystemSettingsService } from "./system-settings.service";

@Module({
  providers: [SystemSettingsService],
  exports: [SystemSettingsService],
})
export class SystemSettingsModule {}
