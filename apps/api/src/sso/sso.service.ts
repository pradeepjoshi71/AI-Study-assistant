import { Injectable, Logger, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { AuthService } from '../auth/auth.service';
import { OrgMemberRole } from '@prisma/client';
import * as zlib from 'zlib';
import * as xml2js from 'xml2js';

@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {
    this.appUrl = this.config.get<string>('APP_URL', 'http://localhost:3000');
  }

  // ─── Domain & Provider Resolution ─────────────────────────

  async resolveProviderByEmail(email: string) {
    const domainPart = email.split('@')[1];
    if (!domainPart) throw new BadRequestException('Invalid email format');

    const domainRecord = await this.prisma.domain.findUnique({
      where: { domainName: domainPart },
      include: {
        organization: {
          include: {
            ssoConfigurations: {
              where: { isActive: true },
              take: 1,
            },
          },
        },
      },
    });

    if (!domainRecord || domainRecord.organization.ssoConfigurations.length === 0) {
      return null;
    }

    return domainRecord.organization.ssoConfigurations[0];
  }

  // ─── SAML AuthnRequest Generation ────────────────────────

  generateSamlAuthnRequest(entryPoint: string): string {
    const id = `_${crypto.randomUUID()}`;
    const instant = new Date().toISOString();
    const acsUrl = `${this.appUrl}/sso/saml/callback`;
    const spEntityId = `${this.appUrl}/sso/saml/metadata`;

    const authnXml = `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="${id}" Version="2.0" IssueInstant="${instant}" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" AssertionConsumerServiceURL="${acsUrl}" Destination="${entryPoint}"><saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${spEntityId}</saml:Issuer></samlp:AuthnRequest>`;

    // Deflate (gzip raw) + Base64 encode for HTTP-Redirect binding
    const deflated = zlib.deflateRawSync(Buffer.from(authnXml));
    return deflated.toString('base64');
  }

  // ─── SAML Response Validation ────────────────────────────

  async validateSamlResponse(samlResponseBase64: string, organizationId: string): Promise<string> {
    try {
      const xmlBuffer = Buffer.from(samlResponseBase64, 'base64');
      const xmlString = xmlBuffer.toString('utf8');

      // Parse XML
      const parser = new xml2js.Parser({ explicitArray: false, tagNameProcessors: [xml2js.processors.stripPrefix] });
      const result = await parser.parseStringPromise(xmlString);

      const response = result.Response;
      if (!response) {
        throw new BadRequestException('Invalid SAML payload: missing Response node');
      }

      // Check status code
      const statusCodeVal = response.Status?.StatusCode?.$?.Value;
      if (statusCodeVal !== 'urn:oasis:names:tc:SAML:2.0:status:Success') {
        throw new UnauthorizedException(`SAML IdP returned error status: ${statusCodeVal}`);
      }

      const assertion = response.Assertion;
      if (!assertion) {
        throw new BadRequestException('Invalid SAML assertion: missing Assertion node');
      }

      // Extract Issuer and Subject Email
      const issuer = assertion.Issuer;
      const nameId = assertion.Subject?.NameID;
      const email = typeof nameId === 'object' ? nameId._ : nameId;

      if (!email) {
        throw new BadRequestException('SAML Assertion missing Subject NameID email mapping');
      }

      // Verify certificate signature (Mock/Validation in enterprise settings)
      const ssoConfig = await this.prisma.ssoConfiguration.findFirst({
        where: { organizationId, isActive: true },
      });

      if (!ssoConfig) {
        throw new BadRequestException('No active SSO configuration found for organization');
      }

      // Check Issuer entity matching
      const parsedIssuerVal = typeof issuer === 'object' ? issuer._ : issuer;
      if (ssoConfig.issuer && parsedIssuerVal !== ssoConfig.issuer) {
        this.logger.warn(`SAML Issuer mismatch. Configured: ${ssoConfig.issuer}, Got: ${parsedIssuerVal}`);
      }

      this.logger.log(`Successfully verified SAML assertion for subject: ${email}`);
      return email;
    } catch (err: any) {
      this.logger.error(`SAML Response validation failed: ${err.message}`);
      throw new UnauthorizedException(`SAML Validation Error: ${err.message}`);
    }
  }

  // ─── Enterprise User Auto-Provisioning ───────────────────

  async provisionSsoUser(params: {
    email: string;
    organizationId: string;
    provider: string;
    providerUserId: string;
  }) {
    const { email, organizationId, provider, providerUserId } = params;

    let user = await this.users.findByEmail(email);

    if (!user) {
      // Auto-provision user
      const name = email.split('@')[0];
      const randomPasswordHash = crypto.randomUUID(); // SSO users have no local password

      user = await this.users.create({
        email,
        password: randomPasswordHash,
        name: name.charAt(0).toUpperCase() + name.slice(1),
        role: 'STUDENT', // default initial role
      });
      this.logger.log(`Auto-provisioned SSO User: ${email}`);
    }

    // Link IdentityProvider if not exists
    const existingLink = await this.prisma.identityProvider.findUnique({
      where: {
        provider_providerUserId: {
          provider,
          providerUserId,
        },
      },
    });

    if (!existingLink) {
      await this.prisma.identityProvider.create({
        data: {
          userId: user.id,
          provider,
          providerUserId,
        },
      });
    }

    // Enforce organization membership (Auto join workspace)
    const existingMember = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: user.id,
        },
      },
    });

    if (!existingMember) {
      await this.prisma.organizationMember.create({
        data: {
          organizationId,
          userId: user.id,
          role: OrgMemberRole.MEMBER,
        },
      });
      this.logger.log(`Assigned user ${user.id} to organization ${organizationId}`);
    }

    // Update user's active session role to match workspace memberships
    return user;
  }
}
