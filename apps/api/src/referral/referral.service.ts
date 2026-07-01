import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ReferralService {
  constructor(private readonly prisma: PrismaService) {}

  async validateCode(code: string) {
    return this.prisma.referralCode.findUnique({
      where: { code },
    });
  }
}
