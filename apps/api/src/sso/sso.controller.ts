import { Controller, Post, Get, Body, Req, Res, BadRequestException } from '@nestjs/common';
import { Request, Response } from 'express';
import { SsoService } from './sso.service';
import { AuthService } from '../auth/auth.service';
import { ConfigService } from '@nestjs/config';

class SsoLoginDto {
  email!: string;
}

@Controller('sso')
export class SsoController {
  private readonly frontendUrl: string;
  private readonly appUrl: string;

  constructor(
    private readonly ssoService: SsoService,
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {
    this.frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');
    this.appUrl = this.config.get<string>('APP_URL', 'http://localhost:3000');
  }

  @Post('login')
  async initiateSso(@Body() dto: SsoLoginDto) {
    const ssoConfig = await this.ssoService.resolveProviderByEmail(dto.email);
    if (!ssoConfig) {
      throw new BadRequestException('Single Sign-On is not configured for your organization email domain.');
    }

    let redirectUrl = '';

    if (ssoConfig.providerType === 'SAML') {
      const samlRequest = this.ssoService.generateSamlAuthnRequest(ssoConfig.entryPoint);
      // Construct redirection URL with URL-encoded AuthnRequest and RelayState (organizationId)
      redirectUrl = `${ssoConfig.entryPoint}?SAMLRequest=${encodeURIComponent(samlRequest)}&RelayState=${ssoConfig.organizationId}`;
    } else if (ssoConfig.providerType === 'OIDC') {
      // OIDC auth code redirection flow
      const state = ssoConfig.organizationId;
      redirectUrl = `${ssoConfig.entryPoint}?client_id=${ssoConfig.clientId}&redirect_uri=${encodeURIComponent(
        `${this.appUrl}/sso/oidc/callback`,
      )}&response_type=code&scope=openid%20email%20profile&state=${state}`;
    }

    return { redirectUrl };
  }

  @Post('saml/callback')
  async handleSamlCallback(@Req() req: Request, @Res() res: Response) {
    const samlResponse = req.body.SAMLResponse;
    const organizationId = req.body.RelayState; // RelayState passes organizationId back

    if (!samlResponse || !organizationId) {
      throw new BadRequestException('Missing SAMLResponse or RelayState parameters');
    }

    // 1. Verify response and extract subject email
    const email = await this.ssoService.validateSamlResponse(samlResponse, organizationId);

    // 2. Auto-provision user & map workspace membership
    const user = await this.ssoService.provisionSsoUser({
      email,
      organizationId,
      provider: 'SAML',
      providerUserId: email, // SAML uses NameID email as provider ID
    });

    // 3. Issue Platform Session JWTs
    const tokens = await this.authService.generateTokensForUser(user.id, user.email);

    // 4. Redirect browser back to Frontend callback handler with tokens
    res.redirect(
      `${this.frontendUrl}/auth/sso/callback?accessToken=${tokens.accessToken}&refreshToken=${tokens.refreshToken}`,
    );
  }

  @Get('saml/metadata')
  async getSpMetadata(@Res() res: Response) {
    const entityId = `${this.appUrl}/sso/saml/metadata`;
    const acsUrl = `${this.appUrl}/sso/saml/callback`;

    const metadataXml = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${entityId}">
  <SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
    <AssertionConsumerService index="1" isDefault="true" Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acsUrl}"/>
  </SPSSODescriptor>
</EntityDescriptor>`;

    res.header('Content-Type', 'application/xml');
    res.status(200).send(metadataXml);
  }
}
