import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LivestreamController } from './livestream.controller';
import { LivestreamService } from './livestream.service';

@Module({
  imports: [AuthModule],
  controllers: [LivestreamController],
  providers: [LivestreamService],
  exports: [LivestreamService],
})
export class LivestreamModule {}
