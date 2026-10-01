import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';

import type { Env } from '../../config/env.js';
import { PrismaClient } from '../../generated/prisma/client.js';

/**
 * The single Prisma client for the process. Only repositories/data-access classes inside
 * domain modules may inject this; controllers, the AI layer, and tools never do.
 * Connections are opened lazily by the pg pool, so the API can boot (and report
 * not-ready) while the database is unavailable.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg({ connectionString: config.get('DATABASE_URL', { infer: true }) }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
