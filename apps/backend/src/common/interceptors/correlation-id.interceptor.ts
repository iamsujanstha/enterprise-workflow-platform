import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();

    // Use incoming correlation ID or generate one
    const correlationId = req.headers['x-correlation-id'] || `req_${uuidv4()}`;
    req.correlationId = correlationId;
    res.setHeader('X-Correlation-ID', correlationId);

    return next.handle().pipe(
      tap({
        error: () => {
          // correlationId is already on the request for the exception filter to pick up
        },
      }),
    );
  }
}
