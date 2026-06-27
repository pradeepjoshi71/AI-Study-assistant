import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateOrganizationDto } from "./dto/create-organization.dto";
import { UpdateOrganizationDto } from "./dto/update-organization.dto";
import { PlanType } from "@prisma/client";

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async create(userId: string, dto: CreateOrganizationDto) {
    if (!dto.name) {
      throw new BadRequestException("Organization name is required");
    }

    const freePlan = await this.prisma.plan.findFirst({
      where: { type: PlanType.FREE },
    });
    if (!freePlan) {
      throw new NotFoundException("FREE subscription plan not found");
    }

    const slug = dto.slug || `${dto.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;

    // Create Organization and assign caller as OWNER
    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: dto.name,
          slug,
          planId: freePlan.id,
        },
      });

      await tx.orgMember.create({
        data: {
          orgId: org.id,
          userId,
          role: "OWNER",
        },
      });

      await tx.knowledgeGraph.create({
        data: {
          orgId: org.id,
        },
      });

      return org;
    });
  }

  async findAllForUser(userId: string) {
    return this.prisma.organization.findMany({
      where: {
        members: {
          some: { userId },
        },
      },
      include: {
        plan: true,
      },
    });
  }

  async findOne(id: string, userId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        plan: true,
      },
    });

    if (!org) {
      throw new NotFoundException("Organization not found");
    }

    // Verify user is a member of this org
    const membership = await this.prisma.orgMember.findUnique({
      where: {
        orgId_userId: {
          orgId: id,
          userId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException("You are not a member of this organization");
    }

    return org;
  }

  async update(id: string, userId: string, dto: UpdateOrganizationDto) {
    // Assert user is OWNER or ADMIN
    await this.assertUserRole(id, userId, ["OWNER", "ADMIN"]);

    const slug = dto.slug ? dto.slug.toLowerCase().replace(/[^a-z0-9]+/g, "-") : undefined;

    return this.prisma.organization.update({
      where: { id },
      data: {
        name: dto.name,
        slug,
      },
    });
  }

  async remove(id: string, userId: string) {
    // Assert user is OWNER
    await this.assertUserRole(id, userId, ["OWNER"]);

    await this.prisma.organization.delete({
      where: { id },
    });

    return { success: true, message: "Organization deleted successfully" };
  }

  private async assertUserRole(orgId: string, userId: string, allowedRoles: string[]) {
    const membership = await this.prisma.orgMember.findUnique({
      where: {
        orgId_userId: {
          orgId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException("You are not a member of this organization");
    }

    if (!allowedRoles.includes(membership.role)) {
      throw new ForbiddenException(
        `Required permissions: ${allowedRoles.join(" or ")}. Current role: ${membership.role}`,
      );
    }
  }
}
