import { Injectable } from "@nestjs/common";
import type { UpdateProfileInput } from "@inclination/shared";
import { PrismaService } from "../prisma/prisma.service";
import { toPublicUser, type PublicUser } from "../common/public-user";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<PublicUser> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      },
    });
    return toPublicUser(user);
  }
}
