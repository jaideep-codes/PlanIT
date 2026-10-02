import { SetMetadata } from '@nestjs/common';

/** Opts a route out of the global session guard. Public is explicit; everything else requires a session. */
export const IS_PUBLIC = 'planit:public';
export const Public = () => SetMetadata(IS_PUBLIC, true);
