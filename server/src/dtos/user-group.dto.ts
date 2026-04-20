import { createZodDto } from 'nestjs-zod';
import { UserAvatarColor, UserAvatarColorSchema } from 'src/enum';
import z from 'zod';

const UserGroupCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).describe('Group name'),
    color: UserAvatarColorSchema.optional().describe('Group color'),
  })
  .meta({ id: 'UserGroupCreateDto' });

const UserGroupUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional().describe('Group name'),
    color: UserAvatarColorSchema.nullable().optional().describe('Group color'),
  })
  .meta({ id: 'UserGroupUpdateDto' });

const UserGroupMemberSetSchema = z
  .object({
    userIds: z.array(z.uuidv4()).describe('User IDs'),
  })
  .meta({ id: 'UserGroupMemberSetDto' });

const UserGroupMemberResponseSchema = z
  .object({
    userId: z.string().describe('User ID'),
    name: z.string().describe('User name'),
    email: z.string().describe('User email'),
    profileImagePath: z.string().optional().describe('Profile image path'),
    avatarColor: z.string().optional().describe('Avatar color'),
  })
  .meta({ id: 'UserGroupMemberResponseDto' });

const UserGroupResponseSchema = z
  .object({
    id: z.string().describe('Group ID'),
    name: z.string().describe('Group name'),
    color: z.enum(UserAvatarColor).nullable().optional().describe('Group color'),
    origin: z.string().describe('Group origin (manual or oidc)'),
    createdAt: z.string().describe('Creation date'),
    members: z.array(UserGroupMemberResponseSchema).describe('Members'),
  })
  .meta({ id: 'UserGroupResponseDto' });

export class UserGroupCreateDto extends createZodDto(UserGroupCreateSchema) {}
export class UserGroupUpdateDto extends createZodDto(UserGroupUpdateSchema) {}
export class UserGroupMemberSetDto extends createZodDto(UserGroupMemberSetSchema) {}
export class UserGroupMemberResponseDto extends createZodDto(UserGroupMemberResponseSchema) {}
export class UserGroupResponseDto extends createZodDto(UserGroupResponseSchema) {}
