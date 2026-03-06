import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { SharedSpaceRole } from 'src/enum';
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
}

export class SharedSpaceAssetAddDto {
  @ValidateUUID({ each: true, description: 'Asset IDs' })
  assetIds!: string[];
}

export class SharedSpaceAssetRemoveDto {
  @ValidateUUID({ each: true, description: 'Asset IDs' })
  assetIds!: string[];
}
