import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import {
  AgentFindTripCandidatesToolRequestDto,
  AgentFindTripCandidatesToolResponseDto,
  AgentListAlbumsToolRequestDto,
  AgentListAlbumsToolResponseDto,
  AgentListDuplicateGroupsToolRequestDto,
  AgentListDuplicateGroupsToolResponseDto,
  AgentListSpacesToolRequestDto,
  AgentListSpacesToolResponseDto,
  AgentReadAlbumToolRequestDto,
  AgentReadAlbumToolResponseDto,
  AgentReadAssetMetadataToolRequestDto,
  AgentReadAssetMetadataToolResponseDto,
  AgentReadAssetOriginalsToolRequestDto,
  AgentReadAssetOriginalsToolResponseDto,
  AgentReadAssetPreviewsToolRequestDto,
  AgentReadAssetPreviewsToolResponseDto,
  AgentReadSpaceToolRequestDto,
  AgentReadSpaceToolResponseDto,
  AgentSearchAssetsToolRequestDto,
  AgentSearchAssetsToolResponseDto,
  AgentSearchPeopleToolRequestDto,
  AgentSearchPeopleToolResponseDto,
  AgentSearchUsersToolRequestDto,
  AgentSearchUsersToolResponseDto,
  AgentToolApprovalDto,
  AgentToolCallParamsDto,
  AgentToolCallResponseDto,
} from 'src/dtos/agent-tool.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { AgentToolService } from 'src/services/agent-tool.service';
import { UUIDParamDto } from 'src/validation';

@ApiTags(ApiTag.AgentSessions)
@Controller('agent/sessions/:id')
export class AgentToolController {
  constructor(private readonly service: AgentToolService) {}

  @Post('tools/search-assets')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @ApiCreatedResponse({ type: AgentSearchAssetsToolResponseDto })
  @Endpoint({
    summary: 'Execute the internal searchAssets agent tool',
    description:
      'Internal route for requesting or resuming a strict-approved asset search tool call for an AI agent session.',
    history: new HistoryBuilder().added('v2.7.5').internal('v2.7.5'),
  })
  executeAgentSearchAssets(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AgentSearchAssetsToolRequestDto,
  ): Promise<AgentSearchAssetsToolResponseDto> {
    return this.service.searchAssets(auth, id, dto);
  }

  @Post('tools/find-trip-candidates')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @ApiCreatedResponse({ type: AgentFindTripCandidatesToolResponseDto })
  @Endpoint({
    summary: 'Execute the internal findTripCandidates agent tool',
    description:
      'Internal route for requesting or resuming a strict-approved trip candidate lookup tool call for an AI agent session.',
    history: new HistoryBuilder().added('v2.7.5').internal('v2.7.5'),
  })
  findTripCandidates(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AgentFindTripCandidatesToolRequestDto,
  ): Promise<AgentFindTripCandidatesToolResponseDto> {
    return this.service.findTripCandidates(auth, id, dto);
  }

  @Post('tools/read-asset-metadata')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @ApiCreatedResponse({ type: AgentReadAssetMetadataToolResponseDto })
  @Endpoint({
    summary: 'Execute the internal readAssetMetadata agent tool',
    description:
      'Internal route for requesting or resuming a strict-approved metadata read tool call for an AI agent session.',
    history: new HistoryBuilder().added('v2.7.5').internal('v2.7.5'),
  })
  readAssetMetadata(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AgentReadAssetMetadataToolRequestDto,
  ): Promise<AgentReadAssetMetadataToolResponseDto> {
    return this.service.readAssetMetadata(auth, id, dto);
  }

  @Post('tools/read-asset-previews')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @ApiCreatedResponse({ type: AgentReadAssetPreviewsToolResponseDto })
  @Endpoint({
    summary: 'Execute the internal readAssetPreviews agent tool',
    description:
      'Internal route for requesting or resuming a strict-approved preview read tool call for an AI agent session.',
    history: new HistoryBuilder().added('v2.7.5').internal('v2.7.5'),
  })
  readAssetPreviews(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AgentReadAssetPreviewsToolRequestDto,
  ): Promise<AgentReadAssetPreviewsToolResponseDto> {
    return this.service.readAssetPreviews(auth, id, dto);
  }

  @Post('tools/read-asset-originals')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @ApiCreatedResponse({ type: AgentReadAssetOriginalsToolResponseDto })
  @Endpoint({
    summary: 'Execute the internal readAssetOriginals agent tool',
    description:
      'Internal route for requesting or resuming a strict-approved original read tool call for an AI agent session.',
    history: new HistoryBuilder().added('v2.7.5').internal('v2.7.5'),
  })
  readAssetOriginals(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AgentReadAssetOriginalsToolRequestDto,
  ): Promise<AgentReadAssetOriginalsToolResponseDto> {
    return this.service.readAssetOriginals(auth, id, dto);
  }

  @Post('tools/list-albums')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @ApiCreatedResponse({ type: AgentListAlbumsToolResponseDto })
  @Endpoint({
    summary: 'Execute the internal listAlbums agent tool',
    description:
      'Internal route for requesting or resuming a strict-approved album list tool call for an AI agent session.',
    history: new HistoryBuilder().added('v2.7.5').internal('v2.7.5'),
  })
  listAlbums(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AgentListAlbumsToolRequestDto,
  ): Promise<AgentListAlbumsToolResponseDto> {
    return this.service.listAlbums(auth, id, dto);
  }

  @Post('tools/read-album')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @ApiCreatedResponse({ type: AgentReadAlbumToolResponseDto })
  @Endpoint({
    summary: 'Execute the internal readAlbum agent tool',
    description:
      'Internal route for requesting or resuming a strict-approved album read tool call for an AI agent session.',
    history: new HistoryBuilder().added('v2.7.5').internal('v2.7.5'),
  })
  readAlbum(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AgentReadAlbumToolRequestDto,
  ): Promise<AgentReadAlbumToolResponseDto> {
    return this.service.readAlbum(auth, id, dto);
  }

  @Post('tools/list-spaces')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @ApiCreatedResponse({ type: AgentListSpacesToolResponseDto })
  @Endpoint({
    summary: 'Execute the internal listSpaces agent tool',
    description:
      'Internal route for requesting or resuming a strict-approved shared-space list tool call for an AI agent session.',
    history: new HistoryBuilder().added('v2.7.5').internal('v2.7.5'),
  })
  listSpaces(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AgentListSpacesToolRequestDto,
  ): Promise<AgentListSpacesToolResponseDto> {
    return this.service.listSpaces(auth, id, dto);
  }

  @Post('tools/list-duplicate-groups')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @ApiCreatedResponse({ type: AgentListDuplicateGroupsToolResponseDto })
  @Endpoint({
    summary: 'Execute the internal listDuplicateGroups agent tool',
    description:
      'Internal route for requesting or resuming a strict-approved duplicate group list tool call for an AI agent session.',
    history: new HistoryBuilder().added('v2.7.5').internal('v2.7.5'),
  })
  listDuplicateGroups(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AgentListDuplicateGroupsToolRequestDto,
  ): Promise<AgentListDuplicateGroupsToolResponseDto> {
    return this.service.listDuplicateGroups(auth, id, dto);
  }

  @Post('tools/read-space')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @ApiCreatedResponse({ type: AgentReadSpaceToolResponseDto })
  @Endpoint({
    summary: 'Execute the internal readSpace agent tool',
    description:
      'Internal route for requesting or resuming a strict-approved shared-space read tool call for an AI agent session.',
    history: new HistoryBuilder().added('v2.7.5').internal('v2.7.5'),
  })
  readSpace(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AgentReadSpaceToolRequestDto,
  ): Promise<AgentReadSpaceToolResponseDto> {
    return this.service.readSpace(auth, id, dto);
  }

  @Post('tools/search-users')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @ApiCreatedResponse({ type: AgentSearchUsersToolResponseDto })
  @Endpoint({
    summary: 'Execute the internal searchUsers agent tool',
    description:
      'Internal route for requesting or resuming a strict-approved visible user lookup tool call for an AI agent session.',
    history: new HistoryBuilder().added('v2.7.5').internal('v2.7.5'),
  })
  searchAgentUsers(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AgentSearchUsersToolRequestDto,
  ): Promise<AgentSearchUsersToolResponseDto> {
    return this.service.searchUsers(auth, id, dto);
  }

  @Post('tools/search-people')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @ApiCreatedResponse({ type: AgentSearchPeopleToolResponseDto })
  @Endpoint({
    summary: 'Execute the internal searchPeople agent tool',
    description:
      'Internal route for requesting or resuming a strict-approved person name resolution tool call for an AI agent session.',
    history: new HistoryBuilder().added('v2.7.5').internal('v2.7.5'),
  })
  searchAgentPeople(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AgentSearchPeopleToolRequestDto,
  ): Promise<AgentSearchPeopleToolResponseDto> {
    return this.service.searchPeople(auth, id, dto);
  }

  @Get('tool-calls')
  @Authenticated({ permission: Permission.AgentSessionRead })
  @Endpoint({
    summary: 'List agent tool calls',
    description: 'List audited internal tool calls for an AI agent session owned by the current user.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  getToolCalls(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<AgentToolCallResponseDto[]> {
    return this.service.getToolCalls(auth, id);
  }

  @Post('tool-calls/:toolCallId/approval')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @Endpoint({
    summary: 'Approve or deny an agent tool call',
    description: 'Record an explicit user approval decision for a pending internal agent tool call.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  approveToolCall(
    @Auth() auth: AuthDto,
    @Param() { id, toolCallId }: AgentToolCallParamsDto,
    @Body() dto: AgentToolApprovalDto,
  ): Promise<AgentToolCallResponseDto> {
    return this.service.approveToolCall(auth, id, toolCallId, dto);
  }
}
