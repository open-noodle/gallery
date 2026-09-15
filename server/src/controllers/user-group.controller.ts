import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import {
  UserGroupCreateDto,
  UserGroupMemberResponseDto,
  UserGroupMemberSetDto,
  UserGroupResponseDto,
  UserGroupUpdateDto,
} from 'src/dtos/user-group.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { UserGroupService } from 'src/services/user-group.service.js';
import { UUIDParamDto } from 'src/validation.js';

@ApiTags(ApiTag.UserGroups)
@Controller('user-groups')
export class UserGroupController {
  constructor(private service: UserGroupService) {}

  @Post()
  @Authenticated({ permission: Permission.UserGroupCreate })
  @Endpoint({
    summary: 'Create a user group',
    description: 'Create a named group of users for quick selection when sharing.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  createGroup(@Auth() auth: AuthDto, @Body() dto: UserGroupCreateDto): Promise<UserGroupResponseDto> {
    return this.service.create(auth, dto);
  }

  @Get()
  @Authenticated({ permission: Permission.UserGroupRead })
  @Endpoint({
    summary: 'Get all user groups',
    description: 'Retrieve all user groups created by the current user.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getAllGroups(@Auth() auth: AuthDto): Promise<UserGroupResponseDto[]> {
    return this.service.getAll(auth);
  }

  @Get(':id')
  @Authenticated({ permission: Permission.UserGroupRead })
  @Endpoint({
    summary: 'Get a user group',
    description: 'Retrieve details of a specific user group.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getGroup(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<UserGroupResponseDto> {
    return this.service.get(auth, id);
  }

  @Patch(':id')
  @Authenticated({ permission: Permission.UserGroupUpdate })
  @Endpoint({
    summary: 'Update a user group',
    description: 'Update the name or color of a user group.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  updateGroup(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: UserGroupUpdateDto,
  ): Promise<UserGroupResponseDto> {
    return this.service.update(auth, id, dto);
  }

  @Delete(':id')
  @Authenticated({ permission: Permission.UserGroupDelete })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete a user group',
    description: 'Permanently delete a user group. Does not affect albums or spaces shared with group members.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  removeGroup(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.remove(auth, id);
  }

  @Put(':id/members')
  @Authenticated({ permission: Permission.UserGroupUpdate })
  @Endpoint({
    summary: 'Set group members',
    description: 'Replace all members of a user group with the provided list.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  setMembers(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: UserGroupMemberSetDto,
  ): Promise<UserGroupMemberResponseDto[]> {
    return this.service.setMembers(auth, id, dto);
  }
}
