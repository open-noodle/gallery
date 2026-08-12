import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  FaceSuggestionActionResponseDto,
  PersonFaceSuggestionPageQueryDto,
  PersonFaceSuggestionPageResponseDto,
  PersonFaceSuggestionParamsDto,
} from 'src/dtos/person.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { FaceSuggestionService } from 'src/services/face-suggestion.service';
import { UUIDParamDto } from 'src/validation';

/**
 * Slice 13 (fork isolation): the five `/people/:id/face-suggestions...` routes, extracted out of
 * `person.controller.ts` alongside their service (`face-suggestion.service.ts`). Every route path,
 * `@Authenticated` decorator and `HistoryBuilder` lifecycle is unchanged from before the move — the
 * OpenAPI output is byte-identical (verified by the zero-diff gate in the slice 13 commit).
 */
@ApiTags(ApiTag.People)
@Controller('people')
export class FaceSuggestionController {
  constructor(private service: FaceSuggestionService) {}

  // F21: publishes the permission getFaceSuggestions actually enforces. Deliberately PersonUpdate, not
  // PersonRead — PersonRead also resolves via access.person.checkSharedSpaceAccess (see
  // src/utils/access.ts), which would let a space member read the owner's whole-library pending review
  // queue (D6, see the comment on getFaceSuggestions in face-suggestion.service.ts). Do not relax this
  // back to PersonRead to "match" a shared-space caller; the service enforcement is the source of truth
  // here.
  @Get(':id/face-suggestions')
  @Authenticated({ permission: Permission.PersonUpdate })
  @Endpoint({
    summary: 'Get face suggestions for a person',
    description: 'Retrieve near-miss unassigned faces suggested for this person, best match first.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getPersonFaceSuggestions(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Query() dto: PersonFaceSuggestionPageQueryDto,
  ): Promise<PersonFaceSuggestionPageResponseDto> {
    return this.service.getFaceSuggestions(auth, id, dto);
  }

  // F21: publishes PersonUpdate, the person-level permission confirmFaceSuggestion enforces — not
  // PersonReassign, which the service never checks. confirmFaceSuggestion ALSO enforces PersonCreate on
  // the face itself (assetFaceId), but the guard can only carry one permission; that face-level check
  // stays service-level (see the comment on confirmFaceSuggestion in face-suggestion.service.ts). Do not
  // drop it there on the assumption this decorator covers it.
  //
  // S11 (F24): the response EXPLICITLY reports whether the call acted or was a no-op — the service's return
  // value, not a fixed default. The web modal used to infer "already resolved" from a 400, which is
  // indistinguishable from a genuine authorization failure (see the comment that used to sit here and on
  // PersonSuggestionReviewModal.svelte).
  //
  // S11b (F24): that report is the `acted` field of the BODY, always under 200 — NOT a 200-vs-204 status
  // code. @oazapfts/runtime's ok() resolves to the body and throws away the numeric status for every
  // success code, so no generated client can read a status-code signal. Do not "simplify" this back to
  // @HttpCode + res.status(): it compiles, tests green against supertest, and is unusable from the SDK.
  @Post(':id/face-suggestions/:assetFaceId/confirm')
  @Authenticated({ permission: Permission.PersonUpdate })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Confirm a face suggestion',
    description: 'Assign the suggested face to the person. Idempotent — the response reports whether it acted.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  async confirmPersonFaceSuggestion(
    @Auth() auth: AuthDto,
    @Param() { id, assetFaceId }: PersonFaceSuggestionParamsDto,
  ): Promise<FaceSuggestionActionResponseDto> {
    return { acted: await this.service.confirmFaceSuggestion(auth, id, assetFaceId) };
  }

  @Post(':id/face-suggestions/:assetFaceId/reject')
  @Authenticated({ permission: Permission.PersonUpdate })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Reject a face suggestion',
    description:
      'Reject this suggestion for the person. The face stays unassigned. Idempotent — the response reports whether it acted.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  async rejectPersonFaceSuggestion(
    @Auth() auth: AuthDto,
    @Param() { id, assetFaceId }: PersonFaceSuggestionParamsDto,
  ): Promise<FaceSuggestionActionResponseDto> {
    return { acted: await this.service.rejectFaceSuggestion(auth, id, assetFaceId) };
  }

  @Post(':id/face-suggestions/:assetFaceId/ignore')
  @Authenticated({ permission: Permission.PersonUpdate })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Ignore a face suggestion',
    description:
      'Ignore this suggestion for the person. The face stays unassigned. Idempotent — the response reports whether it acted.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  async ignorePersonFaceSuggestion(
    @Auth() auth: AuthDto,
    @Param() { id, assetFaceId }: PersonFaceSuggestionParamsDto,
  ): Promise<FaceSuggestionActionResponseDto> {
    return { acted: await this.service.ignoreFaceSuggestion(auth, id, assetFaceId) };
  }

  @Post(':id/face-suggestions/:assetFaceId/dismiss')
  @Authenticated({ permission: Permission.PersonUpdate })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Dismiss a face suggestion',
    description:
      'Compatibility alias for rejecting this suggestion. The face stays unassigned. Idempotent — the response reports whether it acted.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  async dismissPersonFaceSuggestion(
    @Auth() auth: AuthDto,
    @Param() { id, assetFaceId }: PersonFaceSuggestionParamsDto,
  ): Promise<FaceSuggestionActionResponseDto> {
    return { acted: await this.service.dismissFaceSuggestion(auth, id, assetFaceId) };
  }
}
