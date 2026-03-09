import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { SharedSpaceRole, UserAvatarColor } from 'src/enum';
import { ValidateEnum, ValidateUUID } from 'src/validation';

export class SharedSpaceCreateDto {
  @ApiProperty({ description: 'Space name' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ description: 'Space description' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ValidateEnum({
    enum: UserAvatarColor,
    name: 'UserAvatarColor',
    description: 'Space color',
    optional: true,
    default: UserAvatarColor.Primary,
  })
  color?: UserAvatarColor;
}

export class SharedSpaceUpdateDto {
  @ApiPropertyOptional({ description: 'Space name' })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Space description' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ValidateUUID({ optional: true, nullable: true, description: 'Thumbnail asset ID' })
  thumbnailAssetId?: string | null;

  @ValidateEnum({
    enum: UserAvatarColor,
    name: 'UserAvatarColor',
    description: 'Space color',
    optional: true,
  })
  color?: UserAvatarColor;
}

export class SharedSpaceMemberCreateDto {
  @ValidateUUID({ description: 'User ID' })
  userId!: string;

  @ValidateEnum({
    enum: SharedSpaceRole,
    name: 'SharedSpaceRole',
    description: 'Member role',
    optional: true,
    default: SharedSpaceRole.Viewer,
  })
  role?: SharedSpaceRole;
}

export class SharedSpaceMemberUpdateDto {
  @ValidateEnum({ enum: SharedSpaceRole, name: 'SharedSpaceRole', description: 'Member role' })
  role!: SharedSpaceRole;
}

export class SharedSpaceMemberResponseDto {
  @ApiProperty({ description: 'User ID' })
  userId!: string;

  @ApiProperty({ description: 'User name' })
  name!: string;

  @ApiProperty({ description: 'User email' })
  email!: string;

  @ApiProperty({ description: 'Member role', enum: SharedSpaceRole })
  role!: string;

  @ApiProperty({ description: 'Join date' })
  joinedAt!: string;

  @ApiPropertyOptional({ description: 'Profile image path' })
  profileImagePath?: string;

  @ApiPropertyOptional({ description: 'Profile change date' })
  profileChangedAt?: string;

  @ApiPropertyOptional({ description: 'Avatar color' })
  avatarColor?: string;

  @ApiProperty({ description: 'Show space assets in timeline' })
  showInTimeline!: boolean;
}

export class SharedSpaceResponseDto {
  @ApiProperty({ description: 'Space ID' })
  id!: string;

  @ApiProperty({ description: 'Space name' })
  name!: string;

  @ApiPropertyOptional({ description: 'Space description' })
  description?: string | null;

  @ApiProperty({ description: 'Creator user ID' })
  createdById!: string;

  @ApiProperty({ description: 'Creation date' })
  createdAt!: string;

  @ApiProperty({ description: 'Last update date' })
  updatedAt!: string;

  @ApiPropertyOptional({ description: 'Number of members' })
  memberCount?: number;

  @ApiPropertyOptional({ description: 'Number of assets' })
  assetCount?: number;

  @ApiPropertyOptional({ description: 'Thumbnail asset ID' })
  thumbnailAssetId?: string | null;

  @ApiPropertyOptional({ description: 'Space color', enum: UserAvatarColor })
  color?: UserAvatarColor | null;

  @ApiPropertyOptional({ description: 'Last activity timestamp (most recent asset add)' })
  lastActivityAt?: string | null;

  @ApiPropertyOptional({ description: 'Recent asset IDs for collage display (up to 4)', type: [String] })
  recentAssetIds?: string[];

  @ApiPropertyOptional({ description: 'Thumbhashes for recent assets (parallel array)', type: [String] })
  recentAssetThumbhashes?: (string | null)[];

  @ApiPropertyOptional({ description: 'Space members (summary)', type: [SharedSpaceMemberResponseDto] })
  members?: SharedSpaceMemberResponseDto[];
}

export class SharedSpaceMemberTimelineDto {
  @ApiProperty({ description: 'Show space assets in personal timeline' })
  @IsNotEmpty()
  showInTimeline!: boolean;
}

export class SharedSpaceAssetAddDto {
  @ValidateUUID({ each: true, description: 'Asset IDs' })
  assetIds!: string[];
}

export class SharedSpaceAssetRemoveDto {
  @ValidateUUID({ each: true, description: 'Asset IDs' })
  assetIds!: string[];
}
