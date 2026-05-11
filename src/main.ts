import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import type { Request, Response } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // Custom body parsers that capture raw body for webhook HMAC verification
  app.use(json({
    verify: (req: Request, _res: Response, buf: Buffer) => {
      (req as any).rawBody = buf;
    },
  }));
  app.use(urlencoded({ extended: true }));

  const config = app.get(ConfigService);

  app.enableCors({
    origin: config.get('corsOrigins'),
    credentials: true,
  });

  app.setGlobalPrefix('v1');

  app.use(helmet());

  if (config.get('nodeEnv') !== 'production') {
    const swaggerDoc = new DocumentBuilder()
      .setTitle('TrafficPay API')
      .setDescription(
        'TrafficPay is a paid traffic platform where advertisers create campaigns and users earn money by visiting them.\n\n' +
        '**Authentication:** Google OAuth → JWT access tokens (Bearer, 15min) + refresh token rotation (30d).\n\n' +
        '**Response format:** All responses are wrapped in `{ success: true, data: ... }` or `{ success: false, error: { code, message, statusCode } }`.\n\n' +
        '**Money:** All monetary amounts are in **kobo** (1 NGN = 100 kobo). Never use decimals.\n\n' +
        '**Rate limiting:** 100 requests per minute per IP.',
      )
      .setVersion('1.0.0')
      .addBearerAuth()
      .addTag('Auth', 'Google OAuth sign-in, token refresh, and logout')
      .addTag('Users', 'User profile and dashboard')
      .addTag('Campaigns', 'Browse, create, and manage campaigns')
      .addTag('Visits', 'Start/complete campaign visits and view history')
      .addTag('Wallet', 'Balance, deposits, withdrawals, bank accounts, and transactions')
      .addTag('Referrals', 'Referral statistics and milestones')
      .addTag('Platform', 'Public platform stats and configuration')
      .addTag('Admin', 'Admin-only user management, campaign review, withdrawal oversight, and analytics')
      .addTag('Webhooks', 'Paystack webhook receiver (server-to-server)')
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerDoc));
  }

  await app.listen(config.get('port')!);
}
bootstrap();
