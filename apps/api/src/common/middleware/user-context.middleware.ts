import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { userContextStorage } from "../context/user-context";

function decodeJwt(token: string): any {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], "base64").toString("utf-8");
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

@Injectable()
export class UserContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    let userId: string | undefined;
    let orgId: string | undefined;

    // Check if req.user has already been attached by Passport JwtAuthGuard
    if ((req as any).user) {
      userId = (req as any).user.id;
      orgId = (req as any).user.orgId;
    } else {
      // Manually parse Authorization header if guards haven't run yet
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        const payload = decodeJwt(token);
        if (payload) {
          userId = payload.sub;
          orgId = payload.orgId;
        }
      }
    }

    if (userId) {
      userContextStorage.run({ userId, orgId }, () => next());
    } else {
      next();
    }
  }
}
