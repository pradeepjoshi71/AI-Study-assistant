import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { UsersService } from "../../users/users.service";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>(
        "JWT_ACCESS_SECRET",
        "access_secret_12345",
      ),
    });
  }

  async validate(payload: { sub: string; email: string; tier?: string; orgId?: string }) {
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException("User does not exist");
    }
    if (!user.isActive) {
      throw new UnauthorizedException("User account is deactivated");
    }

    const rawPlan = user.subscriptionPlan || 'FREE';
    const planStr = rawPlan.toLowerCase();
    const mappedTier = planStr === 'pro' ? 'pro' : (planStr === 'team' || planStr === 'enterprise' || planStr === 'premium' ? 'premium' : 'free');

    // Passport will attach this return value as req.user
    return {
      ...user,
      tier: payload.tier || mappedTier,
      orgId: payload.orgId,
      systemRole: (payload as any).systemRole || user.systemRole || 'USER',
    };
  }
}
