import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Req,
  Res,
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
  RawBodyRequest,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { BillingService } from './billing.service';
import { PlansService } from './plans.service';
import { WebhookHandler } from './webhook.handler';
import { StripeService } from './stripe.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UpgradeSubscriptionDto } from './dtos/upgrade-subscription.dto';
import { BillingCycle, PlanType } from '@prisma/client';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly plans: PlansService,
    private readonly stripe: StripeService,
    private readonly webhook: WebhookHandler,
  ) {}

  // ─── Public: list plans ───────────────────────────────────

  @Get('plans')
  async getPlans() {
    return this.plans.findAll();
  }

  // ─── Auth required endpoints ──────────────────────────────

  @Get('subscription')
  @UseGuards(JwtAuthGuard)
  async getSubscription(@CurrentUser() user: any) {
    return this.billing.getOrganizationSubscription(user.organizationId);
  }

  @Post('subscribe')
  @UseGuards(JwtAuthGuard)
  async upgrade(
    @CurrentUser() user: any,
    @Body() dto: UpgradeSubscriptionDto,
  ) {
    return this.billing.upgradeSubscription(user.organizationId, dto, user.id);
  }

  @Delete('subscription')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async cancel(@CurrentUser() user: any) {
    return this.billing.cancelSubscription(user.organizationId, user.id);
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  async createCheckout(
    @CurrentUser() user: any,
    @Body() body: { planType: PlanType; cycle: BillingCycle; successUrl: string; cancelUrl: string },
  ) {
    return this.billing.createCheckoutSession(
      user.organizationId,
      body.planType,
      body.cycle,
      body.successUrl,
      body.cancelUrl,
    );
  }

  @Post('portal')
  @UseGuards(JwtAuthGuard)
  async createPortal(@CurrentUser() user: any, @Body('returnUrl') returnUrl: string) {
    return this.billing.createBillingPortalSession(user.organizationId, returnUrl);
  }

  @Get('invoices')
  @UseGuards(JwtAuthGuard)
  async getInvoices(@CurrentUser() user: any) {
    return this.billing.getInvoices(user.organizationId);
  }

  // ─── Stripe Webhook (raw body required!) ─────────────────

  @Post('webhook/stripe')
  @HttpCode(HttpStatus.OK)
  async handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
    @Res() res: Response,
  ) {
    if (!signature) {
      res.status(400).json({ error: 'Missing stripe-signature header' });
      return;
    }

    let event;
    try {
      event = this.stripe.constructWebhookEvent(req.rawBody!, signature);
    } catch (err: any) {
      res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
      return;
    }

    await this.webhook.handle(event);
    res.json({ received: true });
  }
}
