import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getResponse<Request>();

    let status: number;
    let errorCode: string;
    let message: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const responseBody = exception.getResponse();
      
      if (typeof responseBody === 'object' && 'error' in responseBody) {
        errorCode = (responseBody as any).error || exception.name;
        message = (responseBody as any).message || exception.message;
      } else {
        errorCode = exception.name;
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      errorCode = 'INTERNAL_SERVER_ERROR';
      message = process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : exception.message;
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      errorCode = 'UNKNOWN_ERROR';
      message = 'An unexpected error occurred';
    }

    const errorResponse = {
      statusCode: status,
      error: errorCode,
      message,
      correlationId: (request as any).correlationId || undefined,
      timestamp: new Date().toISOString(),
    };

    // Log full stack trace for 5xx errors
    if (status >= 500 && exception instanceof Error) {
      console.error('Internal error:', exception.stack);
    }

    response.status(status).json(errorResponse);
  }
}
