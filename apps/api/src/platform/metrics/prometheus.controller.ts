import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { register, Counter } from 'prom-client';

// Global counter tracking archived audit log rows by organization
export const auditLogsArchivedCounter = new Counter({
  name: 'audit_logs_archived_total',
  help: 'Total number of audit logs archived and deleted',
  labelNames: ['orgId'],
});

@Controller('metrics')
export class PrometheusMetricsController {
  @Get()
  async getMetrics(@Res() res: Response) {
    res.setHeader('Content-Type', register.contentType);
    res.send(await register.metrics());
  }
}
