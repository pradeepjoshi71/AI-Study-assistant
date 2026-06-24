import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // 1. Strict Transport Security (HSTS)
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

    // 2. Content Security Policy (CSP)
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.stripe.com;",
    );

    // 3. Prevent Clickjacking (X-Frame-Options)
    res.setHeader('X-Frame-Options', 'DENY');

    // 4. MIME sniffing protection
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // 5. Referrer Policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // 6. XSS protection header for older browsers
    res.setHeader('X-XSS-Protection', '1; mode=block');

    next();
  }
}
