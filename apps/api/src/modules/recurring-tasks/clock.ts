import { Injectable } from '@nestjs/common';

/** Wall clock for materialization and stop. Tests pass a fixed implementation. */
@Injectable()
export class SystemClock {
  now(): Date {
    return new Date();
  }
}
