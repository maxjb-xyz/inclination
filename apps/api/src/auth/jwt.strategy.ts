import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AppConfig } from "../config/app-config";
import { PrismaService } from "../prisma/prisma.service";
import { toPublicUser, type PublicUser } from "../common/public-user";
import type { AccessClaims } from "./token.service";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwtAccessSecret,
    });
  }

  /** Runs after signature/exp checks; loads the user so it still exists. */
  async validate(payload: AccessClaims): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException("User no longer exists");
    }
    return toPublicUser(user);
  }
}
