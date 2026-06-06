import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/** Requires a valid Bearer access token; populates `request.user`. */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {}
