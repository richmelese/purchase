import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Every error response is `{ error: string, fields？: Record<string,string>, code？: string }`
 * so the frontend's `lib/api.js` can read `data.error` / `data.fields` / `data.code` uniformly.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        res.status(status).json({ error: body });
      } else {
        const payload = body as Record<string, unknown>;
        const message = payload.message;
        const error = Array.isArray(message) ? message[0] : (message ?? payload.error ?? 'Request failed');
        res.status(status).json({ error, fields: payload.fields, code: payload.code });
      }
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Unexpected server error' });
  }
}
