import { prismaStorage } from './prisma.service';

export function UseReplica() {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    descriptor.value = function (...args: any[]) {
      return prismaStorage.run({ useReplica: true }, () => {
        return originalMethod.apply(this, args);
      });
    };
    return descriptor;
  };
}
