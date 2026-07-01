import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "async_hooks";

export const prismaStorage = new AsyncLocalStorage<{ useReplica: boolean }>();

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  public readonly replica: PrismaClient;

  constructor() {
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
      log:
        process.env.NODE_ENV === "development"
          ? ["query", "info", "warn", "error"]
          : ["error"],
    });

    this.replica = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_REPLICA_URL || process.env.DATABASE_URL,
        },
      },
      log:
        process.env.NODE_ENV === "development"
          ? ["query", "info", "warn", "error"]
          : ["error"],
    });

    // Wrap in a Proxy to transparently forward calls to replica client when UseReplica context is active
    return new Proxy(this, {
      get(target, prop, receiver) {
        const store = prismaStorage.getStore();
        if (store?.useReplica && typeof prop === "string") {
          // Route model collections (e.g. prisma.user, prisma.studyGroup)
          if (target.replica && prop in target.replica && !prop.startsWith("$")) {
            return Reflect.get(target.replica, prop, receiver);
          }
          // Route raw queries
          if (prop === "$queryRaw" || prop === "$queryRawUnsafe") {
            return Reflect.get(target.replica, prop, receiver);
          }
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  async onModuleInit() {
    await Promise.all([
      this.$connect(),
      this.replica.$connect(),
    ]);

    try {
      await this.$executeRawUnsafe(`ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY`);
      await this.$executeRawUnsafe(`DROP POLICY IF EXISTS audit_logs_select_policy ON audit_logs`);
      await this.$executeRawUnsafe(`DROP POLICY IF EXISTS audit_logs_insert_policy ON audit_logs`);
      await this.$executeRawUnsafe(`CREATE POLICY audit_logs_select_policy ON audit_logs FOR SELECT TO public USING (true)`);
      await this.$executeRawUnsafe(`CREATE POLICY audit_logs_insert_policy ON audit_logs FOR INSERT TO public WITH CHECK (true)`);
    } catch (err) {
      console.error("Failed to apply PostgreSQL RLS policy on audit_logs table:", err);
    }
  }

  async onModuleDestroy() {
    await Promise.all([
      this.$disconnect(),
      this.replica.$disconnect(),
    ]);
  }
}

