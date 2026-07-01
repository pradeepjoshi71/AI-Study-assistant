import {
  Controller,
  Post,
  Patch,
  Get,
  Delete,
  Query,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { FileInterceptor } from "@nestjs/platform-express";
import { ResellerService, CreateTenantDto, UpdateConfigDto } from "./reseller.service";

@Controller("reseller")
@UseGuards(JwtAuthGuard)
export class ResellerController {
  constructor(private readonly resellerService: ResellerService) {}

  @Get("tenants/check-subdomain")
  async checkSubdomain(@Query("subdomain") subdomain: string) {
    return this.resellerService.checkSubdomain(subdomain);
  }

  @Get("dashboard")
  async getDashboard(@CurrentUser() user: any) {
    return this.resellerService.getDashboard(user.id);
  }

  @Get("tenants/:id")
  async getTenantDetails(@Param("id") tenantId: string) {
    return this.resellerService.getTenantDetails(tenantId);
  }

  @Post("tenants")
  async createTenant(
    @CurrentUser() user: any,
    @Body() dto: CreateTenantDto,
  ) {
    return this.resellerService.createTenant(user.id, dto);
  }

  @Patch("tenants/:id/config")
  @UseInterceptors(FileInterceptor("logo"))
  async updateConfig(
    @Param("id") tenantId: string,
    @Body() dto: UpdateConfigDto,
    @UploadedFile() logoFile?: Express.Multer.File,
  ) {
    if (typeof dto.features === "string") {
      try {
        dto.features = JSON.parse(dto.features);
      } catch (err) {
        // Fallback
      }
    }
    return this.resellerService.updateTenantConfig(tenantId, dto, logoFile);
  }

  @Patch("tenants/:id/suspend")
  async suspendTenant(@Param("id") tenantId: string) {
    return this.resellerService.suspendTenant(tenantId);
  }

  @Delete("tenants/:id")
  async deleteTenant(@Param("id") tenantId: string) {
    return this.resellerService.deleteTenant(tenantId);
  }
}
