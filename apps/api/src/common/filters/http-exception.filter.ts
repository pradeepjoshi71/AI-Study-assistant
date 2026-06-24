import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Response } from "express";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";
    let errors: any[] = [];

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === "object" && exceptionResponse !== null) {
        const resObj = exceptionResponse as any;

        // Handle Validation Pipe outputs
        if (Array.isArray(resObj.message)) {
          message = "Validation failed";
          errors = resObj.message;
        } else {
          message = resObj.message || message;
          errors = [resObj.error || resObj];
        }
      } else {
        message = String(exceptionResponse);
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      if (process.env.NODE_ENV === "development") {
        errors = [exception.stack];
      }
    }

    response.status(status).json({
      success: false,
      message,
      errors,
    });
  }
}
