import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { JwtAuthGuard } from "./jwt.guard";
import { RedisService } from "../../redis/redis.service";

@Injectable()
export class MobileJwtAuthGuard extends JwtAuthGuard implements CanActivate {
  constructor(private readonly redisService: RedisService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Run standard Jwt validation first
    const isAuthorized = (await super.canActivate(context)) as boolean;
    if (!isAuthorized) {
      return false;
    }

    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (token) {
      // 2. Check if token is blacklisted in Redis
      const isBlacklisted = await this.redisService.getClient().get(`blacklist:${token}`);
      if (isBlacklisted) {
        throw new UnauthorizedException("Token has been revoked or logged out");
      }
    }

    return true;
  }

  private extractTokenFromHeader(request: any): string | null {
    const authHeader = request.headers.authorization;
    if (!authHeader) return null;
    const parts = authHeader.split(" ");
    if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
      return parts[1];
    }
    return null;
  }
}
