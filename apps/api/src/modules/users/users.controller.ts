import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  updateCurrentUserRequestSchema,
  updateTaskSortRequestSchema,
  updateThemeRequestSchema,
  type UpdateCurrentUserRequest,
  type UpdateTaskSortRequest,
  type UpdateThemeRequest,
} from '@planit/shared';
import type { CurrentUser } from '@planit/types';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import {
  CurrentUser as CurrentUserParam,
  type AuthenticatedUser,
} from '../auth/current-user.decorator.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  getMe(@CurrentUserParam() user: AuthenticatedUser): Promise<CurrentUser> {
    return this.users.getMe(user.id);
  }

  @Patch('me')
  updateMe(
    @CurrentUserParam() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateCurrentUserRequestSchema)) body: UpdateCurrentUserRequest,
  ): Promise<CurrentUser> {
    return this.users.updateMe(user.id, body);
  }

  @Patch('me/theme')
  updateTheme(
    @CurrentUserParam() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateThemeRequestSchema)) body: UpdateThemeRequest,
  ): Promise<CurrentUser> {
    return this.users.updateTheme(user.id, body);
  }

  @Patch('me/task-sort')
  updateTaskSort(
    @CurrentUserParam() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateTaskSortRequestSchema)) body: UpdateTaskSortRequest,
  ): Promise<CurrentUser> {
    return this.users.updateTaskSort(user.id, body);
  }
}
