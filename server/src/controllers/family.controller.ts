import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  FamilyAccessGrantResponseDto,
  FamilyAccessUpdateDto,
  FamilyAccessUserParamDto,
  FamilyClusterResponseDto,
  FamilyGenderUpdateDto,
  FamilyGraphResponseDto,
  FamilyIdentityParamDto,
  FamilyMyRootResponseDto,
  FamilyMyRootUpdateDto,
  FamilyParticipantAddDto,
  FamilyUnionCreateDto,
  FamilyUnionCreateResponseDto,
  FamilyUnionParamDto,
  FamilyUnionParticipantParamDto,
  FamilyUnionsQueryDto,
  FamilyUnionUpdateDto,
} from 'src/dtos/family.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { FamilyService } from 'src/services/family.service';
import { deriveRelationLabel, FamilyGender } from 'src/utils/family-labels';

// Gallery-fork: family relationships. Thin controller over `FamilyService` — every access
// decision (view/contribute for reads/writes, admin-independent-of-family-level for the two
// grant endpoints) lives in the service or in the `@Authenticated` decorator below, never here.
//
// D8.5 — `GET /family/unions` returns `{ unions: [...], identities: {...}, hasNextPage }`,
// never `{ tree: {...} }`. See the note in `family.dto.ts`.
@ApiTags(ApiTag.Family)
@Controller('family')
export class FamilyController {
  constructor(
    private service: FamilyService,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(FamilyController.name);
  }

  // E49: paginated with a stable order (by union id, ascending) across pages. Pagination is
  // applied here, over `FamilyService.getVisibleGraph`'s already-redacted result — the service
  // method itself is unpaginated, since slices 5/6 already fetch and redact the whole graph in a
  // single pass (`E65`) and re-deriving a partial redaction per page would be more work, not
  // less.
  //
  // D4: `deriveRelationLabel` is called on the FULL projected `graph` (never the paginated
  // subset) for every identity that ends up in the response — a path to a person on page 2 can
  // run through a union that only appears on page 1, so labelling off the page alone would miss
  // or mislabel it. Only the OUTPUT (which identities/unions are included) is paginated; the
  // graph handed to the label engine is exactly what slice 5 returned for this viewer, which is
  // what keeps this safe (see the module docs on `family-labels.ts`).
  @Get('unions')
  @Authenticated({ permission: Permission.FamilyRead })
  @Endpoint({
    summary: 'Get family unions',
    description: 'Retrieve the family unions the caller can see, as a flat, paginated collection.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  async getUnions(@Auth() auth: AuthDto, @Query() query: FamilyUnionsQueryDto): Promise<FamilyGraphResponseDto> {
    const [graph, rootId] = await Promise.all([this.service.getVisibleGraph(auth), this.service.getMyRoot(auth)]);

    const sorted = [...graph.unions].sort((a, b) => a.id.localeCompare(b.id));
    const start = (query.page - 1) * query.size;
    const page = sorted.slice(start, start + query.size);
    const hasNextPage = start + query.size < sorted.length;

    const identities: FamilyGraphResponseDto['identities'] = {};
    for (const union of page) {
      for (const participant of [...union.partners, ...union.children]) {
        if (participant.kind !== 'known' || identities[participant.identityId]) {
          continue;
        }

        const info = graph.identities[participant.identityId];
        if (info) {
          identities[participant.identityId] = {
            name: info.name,
            gender: info.gender,
            label: deriveRelationLabel(graph, rootId, participant.identityId),
          };
        }
      }
    }

    const unions = page.map((union) => ({
      id: union.id,
      status: union.status,
      // A7 (slice 10): the canvas's union-connector pill needs both dates to render "1988 – 2007
      // · divorced". `?? null` guards fixtures/older callers that never set these on
      // `ProjectedFamilyUnion` (they are optional there — see the type's own comment).
      startDate: union.startDate ?? null,
      endDate: union.endDate ?? null,
      partners: union.partners.map((participant) => ({ ...participant })),
      children: union.children.map((participant) => ({ ...participant })),
    }));

    return { unions, identities, hasNextPage };
  }

  @Post('unions')
  @Authenticated({ permission: Permission.FamilyWrite })
  @Endpoint({
    summary: 'Create a family union',
    description: 'Create a new family union (a partnership and/or parent-child relationship).',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  createUnion(@Auth() auth: AuthDto, @Body() dto: FamilyUnionCreateDto): Promise<FamilyUnionCreateResponseDto> {
    return this.service.createUnion(auth, dto);
  }

  @Put('unions/:id')
  @Authenticated({ permission: Permission.FamilyWrite })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Update a family union',
    description: 'Update the status or dates of a family union.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  updateUnion(
    @Auth() auth: AuthDto,
    @Param() { id }: FamilyUnionParamDto,
    @Body() dto: FamilyUnionUpdateDto,
  ): Promise<void> {
    return this.service.updateUnion(auth, id, dto);
  }

  @Delete('unions/:id')
  @Authenticated({ permission: Permission.FamilyWrite })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete a family union',
    description: 'Permanently delete a family union.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  deleteUnion(@Auth() auth: AuthDto, @Param() { id }: FamilyUnionParamDto): Promise<void> {
    return this.service.deleteUnion(auth, id);
  }

  @Put('unions/:id/participants')
  @Authenticated({ permission: Permission.FamilyWrite })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Add a participant to a family union',
    description: 'Add an identity to a family union as a partner or a child.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  addParticipant(
    @Auth() auth: AuthDto,
    @Param() { id }: FamilyUnionParamDto,
    @Body() dto: FamilyParticipantAddDto,
  ): Promise<void> {
    return this.service.addParticipant(auth, id, dto);
  }

  @Delete('unions/:id/participants/:identityId')
  @Authenticated({ permission: Permission.FamilyWrite })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Remove a participant from a family union',
    description: 'Remove an identity from a family union, whichever role it holds.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  removeParticipant(@Auth() auth: AuthDto, @Param() { id, identityId }: FamilyUnionParticipantParamDto): Promise<void> {
    return this.service.removeParticipant(auth, id, identityId);
  }

  @Get('clusters')
  @Authenticated({ permission: Permission.FamilyRead })
  @Endpoint({
    summary: 'Get family clusters',
    description:
      'Retrieve the disconnected components of the family graph the caller can see — how "multiple family trees" surfaces without a tree object.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getClusters(@Auth() auth: AuthDto): Promise<FamilyClusterResponseDto[]> {
    return this.service.getClusters(auth);
  }

  // D4: requires only `view` — reading back your own root discloses nothing about anyone else.
  @Get('me')
  @Authenticated({ permission: Permission.FamilyRead })
  @Endpoint({
    summary: "Get the viewer's family root",
    description: 'Retrieve the identity the caller previously nominated as themselves, or null if never set.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  async getMyRoot(@Auth() auth: AuthDto): Promise<FamilyMyRootResponseDto> {
    return { identityId: await this.service.getMyRoot(auth) };
  }

  // D4: requires only `view` — nominating yourself as the root changes nothing anyone else can
  // see, so this is intentionally NOT gated behind `FamilyWrite`.
  @Put('me')
  @Authenticated({ permission: Permission.FamilyRead })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: "Set the viewer's family root",
    description:
      'Nominate the identity that represents the caller, used to derive relative labels ("your sister"). Pass a null identityId to clear it.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  setMyRoot(@Auth() auth: AuthDto, @Body() dto: FamilyMyRootUpdateDto): Promise<void> {
    return this.service.setMyRoot(auth, dto.identityId);
  }

  // D4: gender requires `contribute`, not `view` — it is shared data that alters the label every
  // OTHER viewer reads for this identity, not a personal preference like the root above.
  @Put('identities/:id/gender')
  @Authenticated({ permission: Permission.FamilyWrite })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: "Set an identity's gender",
    description: 'Set or clear the gender recorded for an identity, used only to pick relation-label wording.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  updateGender(
    @Auth() auth: AuthDto,
    @Param() { id }: FamilyIdentityParamDto,
    @Body() dto: FamilyGenderUpdateDto,
  ): Promise<void> {
    // The DTO's runtime `.refine()` already restricts this to 'male' | 'female' | null (see
    // family.dto.ts for why it isn't typed as a literal union at the OpenAPI/SDK boundary) —
    // this cast just restores that narrower type for FamilyService's slice-6 `FamilyGender`.
    return this.service.updateGender(auth, id, dto.gender as FamilyGender);
  }

  // Admin grant administration — deliberately independent of the caller's own family access
  // level (D2). An admin with no family grant of their own must still be able to administer
  // other people's, so this is `admin: true` alone, never additionally gated by
  // `requireFamilyRead`/`requireFamilyWrite`.
  @Get('access')
  @Authenticated({ admin: true })
  @Endpoint({
    summary: 'Get all family access grants',
    description: 'Retrieve every explicit family access grant on the instance, for admin management.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getAllAccess(): Promise<FamilyAccessGrantResponseDto[]> {
    return this.service.getAllAccessGrants();
  }

  @Put('access/:userId')
  @Authenticated({ admin: true })
  @Endpoint({
    summary: "Set a user's family access grant",
    description: 'Grant a user an explicit family access level, overriding the instance default.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  setAccess(
    @Auth() auth: AuthDto,
    @Param() { userId }: FamilyAccessUserParamDto,
    @Body() dto: FamilyAccessUpdateDto,
  ): Promise<FamilyAccessGrantResponseDto> {
    return this.service.setAccessGrant(auth, userId, dto.level);
  }
}
