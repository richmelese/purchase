import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['log', 'warn', 'error'] });
  app.use(cookieParser());
  // Raw-body routes: these endpoints receive a raw .xlsx upload, not JSON, so they need the body
  // captured as a Buffer before Nest's default body parsers (which only match json/urlencoded
  // content-types and otherwise leave the stream untouched) would see it.
  app.use('/api/reconciliation/import', express.raw({ type: '*/*', limit: '20mb' }));
  // POST /api/import/parties and /api/import/products (Excel imports) — same reasoning.
  app.use('/api/import', express.raw({ type: '*/*', limit: '20mb' }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.set('trust proxy', true);

  const port = Number(process.env.PORT) || 5000;
  const host = process.env.HOST || '127.0.0.1';
  await app.listen(port, host);
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://${host}:${port}`);
}

bootstrap();
