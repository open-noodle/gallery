import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Next,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NextFunction, Response } from 'express';
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
  FamilyPersonParamDto,
  FamilyPersonRelationsResponseDto,
  FamilyUnionCreateDto,
  FamilyUnionCreateResponseDto,
  FamilyUnionParamDto,
  FamilyUnionParticipantParamDto,
  FamilyUnionsQueryDto,
  FamilyUnionUpdateDto,
} from 'src/dtos/family.dto';
import { PersonResponseDto } from 'src/dtos/person.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated, FileResponse } from 'src/middleware/auth.guard';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { FamilyService } from 'src/services/family.service';
import { asDateString } from 'src/utils/date';
import { deriveRelationLabel, FamilyGender, ProjectedFamilyParticipant } from 'src/utils/family-labels';
import { sendFile } from 'src/utils/file';

// The internal `ProjectedFamilyParticipant` (slice 6) is `{kind:'known', identityId}` OR
// `{kind:'anonymous'}` with NO `identityId` key at all. The wire DTO is a flat
// `{kind, identityId: string | null}` instead (see `family.dto.ts` for why: a `oneOf`
// discriminated union broke the generated Dart client on exactly the anonymous case). This is
// the one place that bridges the two — never spread a participant straight onto the response.
const toParticipantDto = (
  participant: ProjectedFamilyParticipant,
): { kind: 'known' | 'anonymous'; identityId: string | null } =>
  participant.kind === 'known'
    ? { kind: 'known', identityId: participant.identityId }
    : { kind: 'anonymous', identityId: null };

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
      startDate: asDateString(union.startDate ?? null),
      endDate: asDateString(union.endDate ?? null),
      partners: union.partners.map((participant) => toParticipantDto(participant)),
      children: union.children.map((participant) => toParticipantDto(participant)),
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

  // A genuinely different query from `PersonResponseDto.familyRelationLabel`: THAT field answers
  // "how does this person relate to the VIEWER" (one label on an already-fetched person); this
  // endpoint answers "what are THIS PERSON's own relations", each labelled relative to that
  // person. Same engine (`deriveDirectRelations`), same graph, different root — see
  // `FamilyService.getPersonRelations`.
  @Get('people/:personId/relations')
  @Authenticated({ permission: Permission.FamilyRead })
  @Endpoint({
    summary: "Get a person's own family relations",
    description:
      "Retrieve a person's direct relations (parents, partners, children, siblings, etc.), each labelled relative to that person rather than the caller.",
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  async getPersonRelations(
    @Auth() auth: AuthDto,
    @Param() { personId }: FamilyPersonParamDto,
  ): Promise<FamilyPersonRelationsResponseDto> {
    return { relations: await this.service.getPersonRelations(auth, personId) };
  }

  // D4: requires only `view` — reading back your own root and access level discloses nothing
  // about anyone else.
  @Get('me')
  @Authenticated({ permission: Permission.FamilyRead })
  @Endpoint({
    summary: "Get the viewer's family root and access level",
    description:
      'Retrieve the identity the caller previously nominated as themselves (or null if never set) and their own effective family access level, so a client can decide what to render in one call.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  async getMyRoot(@Auth() auth: AuthDto): Promise<FamilyMyRootResponseDto> {
    const [rootIdentityId, access] = await Promise.all([
      this.service.getMyRoot(auth),
      this.service.resolveFamilyAccess(auth),
    ]);
    return { rootIdentityId, access };
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
    // `personId` is the form the /family first-run picker can supply; `identityId` (including an
    // explicit null, which clears the root) stays the form the canvas already uses.
    return dto.personId === undefined
      ? this.service.setMyRoot(auth, dto.identityId ?? null)
      : this.service.setMyRootByPerson(auth, dto.personId);
  }

  // Canvas node avatars. Addressed by IDENTITY id, not person id: a canvas client only ever
  // holds identity ids (`PersonResponseDto` withholds `identityId` by design, E30), and for an
  // identity resolved through a shared space the owner-only `GET /people/:id/thumbnail` 404s.
  // `view` is sufficient — the same predicate already decided this viewer may see the identity's
  // name, so the face discloses nothing further (see `FamilyService.getIdentityThumbnail`).
  @Get('identities/:id/thumbnail')
  @FileResponse()
  @Authenticated({ permission: Permission.FamilyRead })
  @Endpoint({
    summary: "Get a family identity's thumbnail",
    description: 'Retrieve the face thumbnail for an identity the caller can resolve, for the family canvas.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  async getIdentityThumbnail(
    @Res() res: Response,
    @Next() next: NextFunction,
    @Auth() auth: AuthDto,
    @Param() { id }: FamilyIdentityParamDto,
  ) {
    await sendFile(res, next, () => this.service.getIdentityThumbnail(auth, id), this.logger);
  }

  // Lets the canvas show and edit the person behind a card — birthday, name — from the surface
  // their name is already on. `view` is sufficient to READ it; the write endpoints this feeds
  // enforce their own permissions, so family access never becomes a back door to renaming people.
  @Get('identities/:id/person')
  @Authenticated({ permission: Permission.FamilyRead })
  @Endpoint({
    summary: 'Get the person behind a family identity',
    description:
      "Retrieve the caller's own accessible person profile for an identity they can resolve, so a family client can show and edit that person.",
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getIdentityPerson(@Auth() auth: AuthDto, @Param() { id }: FamilyIdentityParamDto): Promise<PersonResponseDto> {
    return this.service.getIdentityPerson(auth, id);
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

  // Reverts a user to the instance default by removing their explicit grant entirely — the ONLY
  // way back to "inherits default" once a user has one (setting a value that happens to MATCH
  // the default still leaves the row, and therefore the explicit grant, behind). Deleting a
  // grant that never existed is not an error. Same admin-independent-of-family-level authority
  // as the other two grant endpoints.
  @Delete('access/:userId')
  @Authenticated({ admin: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: "Remove a user's family access grant",
    description: "Remove a user's explicit family access grant, reverting them to the instance default.",
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  deleteAccess(@Param() { userId }: FamilyAccessUserParamDto): Promise<void> {
    return this.service.deleteAccessGrant(userId);
  }
}
