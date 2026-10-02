import type { Prisma } from '../../generated/prisma/client.js';

/** Interactive-transaction client. Repositories accept it so a service can span several writes. */
export type DbClient = Prisma.TransactionClient;
