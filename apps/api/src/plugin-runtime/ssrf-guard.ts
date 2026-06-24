import * as dns from 'dns';
import * as net from 'net';
import { BadRequestException } from '@nestjs/common';

export class SsrfGuard {
  /**
   * Validate that a target URL does not point to a restricted loopback, private subnet, or link-local IP.
   */
  static async validateUrl(urlStr: string): Promise<string> {
    try {
      const url = new URL(urlStr);
      const hostname = url.hostname;

      // 1. If hostname is already a raw IP
      if (net.isIP(hostname)) {
        if (this.isPrivateIp(hostname)) {
          throw new BadRequestException(`Blocked access to restricted IP subnet: ${hostname}`);
        }
        return urlStr;
      }

      // 2. Resolve Hostname to IPs
      const lookupResult = await dns.promises.lookup(hostname, { all: true });
      for (const entry of lookupResult) {
        if (this.isPrivateIp(entry.address)) {
          throw new BadRequestException(`Blocked access: hostname resolves to restricted IP: ${entry.address}`);
        }
      }

      return urlStr;
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`Invalid plugin URL destination: ${err.message}`);
    }
  }

  private static isPrivateIp(ip: string): boolean {
    // Loopback IPv6
    if (ip === '::1') return true;

    // IPv4 Checks
    if (ip.startsWith('127.')) return true;     // Loopback
    if (ip.startsWith('10.')) return true;      // Private class A
    if (ip.startsWith('169.254.')) return true;  // Link-Local (AWS metadata endpoint)
    if (ip.startsWith('192.168.')) return true;  // Private class C

    // Private class B (172.16.0.0 - 172.31.255.255)
    if (ip.startsWith('172.')) {
      const parts = ip.split('.').map(Number);
      if (parts.length >= 2 && parts[1] >= 16 && parts[1] <= 31) return true;
    }

    // IPv6 Private / Unique Local / Link-Local
    const lowerIp = ip.toLowerCase();
    if (lowerIp.startsWith('fc') || lowerIp.startsWith('fd')) return true;
    if (lowerIp.startsWith('fe80')) return true;

    return false;
  }
}
