import { Controller, Get, HttpStatus, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { LivenessResponse, ReadinessResponse } from '@planit/types';
import type { Response } from 'express';

import { HealthService } from './health.service.js';

@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness: the process is up. Never depends on the database or Redis. */
  @Get()
  @SkipThrottle()
  liveness(): LivenessResponse {
    return this.health.liveness();
  }

  /** Readiness: can this instance serve traffic? 503 when the database is unreachable. */
  @Get('ready')
  async readiness(@Res({ passthrough: true }) response: Response): Promise<ReadinessResponse> {
    const result = await this.health.readiness();
    if (result.status === 'not_ready') {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}
