import { Controller, Get, Req } from "@nestjs/common";
import { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";

@Controller("api/public")
export class PublicTenantController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("tenant-config")
  async getTenantConfig(@Req() req: Request) {
    const hostHeader = req.headers.host || "";
    const host = hostHeader.split(":")[0].toLowerCase(); // strip port

    // 1. Resolve via Custom Domain
    let tenant = await this.prisma.tenant.findFirst({
      where: { customDomain: host },
      include: { config: true },
    });

    // 2. Resolve via Subdomain
    if (!tenant) {
      const parts = host.split(".");
      const subdomain = parts.length > 1 ? parts[0] : host;
      tenant = await this.prisma.tenant.findFirst({
        where: { subdomain },
        include: { config: true },
      });
    }

    if (!tenant || !tenant.config) {
      // Fallback: return default theme config
      return {
        appName: "AI Study Assistant",
        logoUrl: null,
        primaryColor: "#6366f1",
        secondaryColor: "#8b5cf6",
        fontFamily: "Inter",
        customCss: "",
      };
    }

    return {
      appName: tenant.config.appName,
      logoUrl: tenant.config.logoUrl,
      primaryColor: tenant.config.primaryColor,
      secondaryColor: tenant.config.secondaryColor,
      fontFamily: tenant.config.fontFamily,
      customCss: tenant.config.customCss || "",
    };
  }
}
