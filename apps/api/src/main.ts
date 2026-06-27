import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { userContextStorage } from "./common/context/user-context";

// Transparently propagate request-scoped User ID to the AI service
const originalFetch = global.fetch;
global.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
  const store = userContextStorage.getStore();
  if (store && store.userId) {
    const urlString = typeof input === "string" ? input : (input instanceof URL ? input.toString() : input.url);
    const aiServiceUrl = process.env.NEXT_PUBLIC_AI_SERVICE_URL || "http://localhost:8000";
    const isAiCall = urlString.startsWith(aiServiceUrl) || urlString.includes("ai-service") || urlString.includes(":8000");
    if (isAiCall) {
      init = init || {};
      const headers = new Headers(init.headers || {});
      if (!headers.has("x-user-id")) {
        headers.set("x-user-id", store.userId);
      }
      init.headers = headers;
    }
  }
  return originalFetch(input, init);
};

import * as express from "express";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const configService = app.get(ConfigService);

  const port = configService.get<number>("API_PORT", 3001);
  const prefix = configService.get<string>("API_PREFIX", "api/v1");

  // Custom middleware to handle raw body for Stripe webhook and JSON for other routes
  app.use((req: any, res: any, next: any) => {
    if (req.originalUrl.includes("/billing/webhook")) {
      express.raw({ type: "application/json" })(req, res, next);
    } else {
      express.json()(req, res, next);
    }
  });

  app.use(express.urlencoded({ extended: true }));

  app.setGlobalPrefix(prefix);
  app.enableCors();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.listen(port);
  console.log(
    `[NestJS Backend API] Server started on: http://localhost:${port}/${prefix}`,
  );
}
bootstrap();
