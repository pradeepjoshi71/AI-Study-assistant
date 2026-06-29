import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";

@Injectable()
export class FieldFilterInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const fieldsQuery = request.query.fields;

    return next.handle().pipe(
      map((data) => {
        if (!fieldsQuery || typeof fieldsQuery !== "string") {
          return data;
        }

        const allowedFields = fieldsQuery
          .split(",")
          .map((f) => f.trim())
          .filter(Boolean);

        if (allowedFields.length === 0) {
          return data;
        }

        return this.filterData(data, allowedFields);
      }),
    );
  }

  private filterData(data: any, allowedFields: string[]): any {
    if (!data) return data;

    if (Array.isArray(data)) {
      return data.map((item) => this.filterObject(item, allowedFields));
    }

    if (typeof data === "object") {
      // If mobile wrapped payload, filter data payload or object keys
      if (data.data && typeof data.data === "object") {
        return {
          ...data,
          data: this.filterData(data.data, allowedFields),
        };
      }
      return this.filterObject(data, allowedFields);
    }

    return data;
  }

  private filterObject(obj: any, allowedFields: string[]): any {
    if (!obj || typeof obj !== "object" || obj instanceof Date) {
      return obj;
    }

    const filtered: any = {};
    allowedFields.forEach((field) => {
      // support nested property checks
      if (field.includes(".")) {
        const parts = field.split(".");
        const topField = parts[0];
        const subField = parts.slice(1).join(".");
        if (topField in obj) {
          filtered[topField] = this.filterData(obj[topField], [subField]);
        }
      } else if (field in obj) {
        filtered[field] = obj[field];
      }
    });

    return filtered;
  }
}
