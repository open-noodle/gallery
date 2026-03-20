import { Injectable } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  UserGroupCreateDto,
  UserGroupMemberResponseDto,
  UserGroupResponseDto,
} from 'src/dtos/user-group.dto';
import { UserAvatarColor } from 'src/enum';
import { BaseService } from 'src/services/base.service';

@Injectable()
export class UserGroupService extends BaseService {
  async create(auth: AuthDto, dto: UserGroupCreateDto): Promise<UserGroupResponseDto> {
    const group = await this.userGroupRepository.create({
      name: dto.name,
      color: dto.color ?? null,
      createdById: auth.user.id,
    });

    return this.mapGroup(group, []);
  }

  private mapGroup(
    group: { id: string; name: string; color: string | null; origin: string; createdAt: unknown },
    members: Array<{ userId: string; name: string; email: string; profileImagePath: string; avatarColor: string | null }>,
  ): UserGroupResponseDto {
    return {
      id: group.id,
      name: group.name,
      color: (group.color as UserAvatarColor) ?? null,
      origin: group.origin,
      createdAt: group.createdAt as unknown as string,
      members: members.map((m) => this.mapMember(m)),
    };
  }

  private mapMember(member: {
    userId: string;
    name: string;
    email: string;
    profileImagePath: string;
    avatarColor: string | null;
  }): UserGroupMemberResponseDto {
    return {
      userId: member.userId,
      name: member.name,
      email: member.email,
      profileImagePath: member.profileImagePath,
      avatarColor: member.avatarColor ?? undefined,
    };
  }
}
