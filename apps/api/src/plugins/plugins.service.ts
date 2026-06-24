import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Plugin } from '@prisma/client';

@Injectable()
export class PluginsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    key: string;
    name: string;
    version: string;
    description: string;
    permissions: string[];
    inputSchema: any;
    outputSchema: any;
    endpointUrl?: string;
    scriptCode?: string;
    authType?: string;
    priceMonthlyCents?: number;
    costPerExecutionCents?: number;
    authorId: string;
  }): Promise<Plugin> {
    const existing = await this.prisma.plugin.findUnique({
      where: { key: data.key },
    });
    if (existing) {
      throw new ConflictException(`Plugin with key ${data.key} already exists`);
    }

    return this.prisma.plugin.create({
      data: {
        key: data.key,
        name: data.name,
        version: data.version,
        description: data.description,
        permissions: data.permissions,
        inputSchema: data.inputSchema,
        outputSchema: data.outputSchema,
        endpointUrl: data.endpointUrl || null,
        scriptCode: data.scriptCode || null,
        authType: data.authType || 'NONE',
        priceMonthlyCents: data.priceMonthlyCents ?? 0,
        costPerExecutionCents: data.costPerExecutionCents ?? 0,
        authorId: data.authorId,
        isActive: true,
      },
    });
  }

  async findAllActive(): Promise<Plugin[]> {
    return this.prisma.plugin.findMany({
      where: { isActive: true },
    });
  }

  async findById(id: string): Promise<Plugin> {
    const plugin = await this.prisma.plugin.findUnique({
      where: { id },
    });
    if (!plugin) {
      throw new NotFoundException(`Plugin with ID ${id} not found`);
    }
    return plugin;
  }

  async findByKey(key: string): Promise<Plugin> {
    const plugin = await this.prisma.plugin.findUnique({
      where: { key },
    });
    if (!plugin) {
      throw new NotFoundException(`Plugin with key ${key} not found`);
    }
    return plugin;
  }

  async update(
    id: string,
    authorId: string,
    data: Partial<{
      name: string;
      version: string;
      description: string;
      permissions: string[];
      inputSchema: any;
      outputSchema: any;
      endpointUrl: string | null;
      scriptCode: string | null;
      authType: string;
      priceMonthlyCents: number;
      costPerExecutionCents: number;
      isActive: boolean;
    }>,
  ): Promise<Plugin> {
    const plugin = await this.findById(id);
    if (plugin.authorId !== authorId) {
      throw new ForbiddenException('Only the author can update this plugin');
    }

    return this.prisma.plugin.update({
      where: { id },
      data,
    });
  }

  async delete(id: string, authorId: string): Promise<void> {
    const plugin = await this.findById(id);
    if (plugin.authorId !== authorId) {
      throw new ForbiddenException('Only the author can delete this plugin');
    }

    // Soft delete/deactivate to avoid breaking existing installations
    await this.prisma.plugin.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
