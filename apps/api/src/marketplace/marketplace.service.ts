import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PluginRuntimeService } from '../plugin-runtime/plugin-runtime.service';
import { PluginInstall } from '@prisma/client';

@Injectable()
export class MarketplaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pluginRuntime: PluginRuntimeService,
  ) {}

  async installPlugin(params: {
    organizationId: string;
    pluginId: string;
    installedById: string;
    config?: any;
  }): Promise<PluginInstall> {
    const { organizationId, pluginId, installedById, config } = params;

    // Verify plugin exists
    const plugin = await this.prisma.plugin.findUnique({
      where: { id: pluginId },
    });
    if (!plugin || !plugin.isActive) {
      throw new NotFoundException('Plugin not found or is inactive');
    }

    // Check if already installed
    const existing = await this.prisma.pluginInstall.findUnique({
      where: {
        organizationId_pluginId: { organizationId, pluginId },
      },
    });
    if (existing) {
      throw new ConflictException('Plugin is already installed in this organization');
    }

    return this.prisma.pluginInstall.create({
      data: {
        organizationId,
        pluginId,
        installedById,
        config: config ?? {},
      },
      include: { plugin: true },
    });
  }

  async uninstallPlugin(organizationId: string, pluginId: string): Promise<void> {
    const existing = await this.prisma.pluginInstall.findUnique({
      where: {
        organizationId_pluginId: { organizationId, pluginId },
      },
    });
    if (!existing) {
      throw new NotFoundException('Plugin installation not found');
    }

    await this.prisma.pluginInstall.delete({
      where: {
        organizationId_pluginId: { organizationId, pluginId },
      },
    });
  }

  async getInstalledPlugins(organizationId: string): Promise<any[]> {
    const installs = await this.prisma.pluginInstall.findMany({
      where: { organizationId },
      include: { plugin: true },
    });
    return installs.map((inst) => ({
      ...inst.plugin,
      installedAt: inst.createdAt,
      config: inst.config,
    }));
  }

  async ratePlugin(params: {
    pluginId: string;
    userId: string;
    rating: number;
    review?: string;
  }) {
    const { pluginId, userId, rating, review } = params;
    if (rating < 1 || rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }

    return this.prisma.pluginRating.upsert({
      where: {
        pluginId_userId: { pluginId, userId },
      },
      update: { rating, review },
      create: { pluginId, userId, rating, review },
    });
  }

  async executeInstalledPlugin(params: {
    organizationId: string;
    pluginId: string;
    userId: string;
    inputData: Record<string, any>;
    conversationId?: string;
    userEmail?: string;
  }): Promise<any> {
    const { organizationId, pluginId, userId, inputData, conversationId, userEmail } = params;

    // Verify plugin is installed
    const install = await this.prisma.pluginInstall.findUnique({
      where: {
        organizationId_pluginId: { organizationId, pluginId },
      },
      include: { plugin: true },
    });

    if (!install) {
      throw new BadRequestException('Plugin is not installed in this organization');
    }

    // Merge installation config into inputData so that the plugin execution has credentials (e.g. API keys)
    const mergedInputData = {
      ...inputData,
      _config: install.config || {},
    };

    const userContext = {
      userId,
      email: userEmail,
      organizationId,
    };

    return this.pluginRuntime.executePlugin({
      plugin: install.plugin,
      inputData: mergedInputData,
      organizationId,
      userId,
      conversationId,
      userContext,
    });
  }
}
