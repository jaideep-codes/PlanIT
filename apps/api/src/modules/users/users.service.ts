import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type UpdateCurrentUserRequest,
  type UpdateTaskSortRequest,
  type UpdateThemeRequest,
} from '@planit/shared';
import type { CurrentUser } from '@planit/types';

import { AppException } from '../../common/errors/app.exception.js';
import { UsersRepository } from './users.repository.js';

@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  async getMe(userId: string): Promise<CurrentUser> {
    return this.require(await this.users.findById(userId));
  }

  async updateMe(userId: string, input: UpdateCurrentUserRequest): Promise<CurrentUser> {
    return this.require(await this.users.updateProfile(userId, input));
  }

  async updateTheme(userId: string, input: UpdateThemeRequest): Promise<CurrentUser> {
    return this.require(await this.users.updateTheme(userId, input.theme));
  }

  async updateTaskSort(userId: string, input: UpdateTaskSortRequest): Promise<CurrentUser> {
    return this.require(await this.users.updateTaskSort(userId, input.defaultTaskSort));
  }

  private require(user: CurrentUser | null): CurrentUser {
    if (!user) {
      throw new AppException(ERROR_CODES.NOT_FOUND, 'Account not found.', HttpStatus.NOT_FOUND);
    }
    return user;
  }
}
