import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto';
import { FamilyAccessLevel } from 'src/enum';
import { BaseService } from 'src/services/base.service';

// Gallery-fork: family relationships. Access comes from an admin-granted level, never from
// a shared-space role — this file must never reference spaces, membership or roles.
@Injectable()
export class FamilyService extends BaseService {
  async resolveFamilyAccess(auth: AuthDto): Promise<FamilyAccessLevel> {
    const { familyTree } = await this.getConfig({ withCache: false });
    if (!familyTree.enabled) {
      return FamilyAccessLevel.None;
    }

    const row = await this.familyRepository.getAccess(auth.user.id);
    return (row?.level ?? familyTree.defaultAccess) as FamilyAccessLevel;
  }

  async requireFamilyWrite(auth: AuthDto): Promise<void> {
    const level = await this.resolveFamilyAccess(auth);
    if (level !== FamilyAccessLevel.Contribute) {
      throw new ForbiddenException();
    }
  }
}
