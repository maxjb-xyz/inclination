import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AppConfig } from "../config/app-config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { OidcController } from "./oidc.controller";
import { OidcService } from "./oidc.service";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.jwtAccessSecret,
        signOptions: { expiresIn: config.accessTtlSec },
      }),
    }),
  ],
  controllers: [AuthController, OidcController],
  providers: [AuthService, PasswordService, TokenService, JwtStrategy, OidcService],
  exports: [AuthService, TokenService, PasswordService],
})
export class AuthModule {}
