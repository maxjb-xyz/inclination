import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AppConfig } from "../config/app-config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
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
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, JwtStrategy],
  exports: [AuthService, TokenService, PasswordService],
})
export class AuthModule {}
