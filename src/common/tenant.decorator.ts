import { BadRequestException, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

const TENANT_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Single tenant for this POC. Callers do not send a tenant header. */
export const POC_TENANT_ID = 'demo';

/**
 * Dev stand-in for the host project's auth guard. The POC always uses POC_TENANT_ID.
 * An explicit `x-tenant-id` is still honored so e2e can keep runs off the demo tenant.
 */
export const TenantId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const raw = req.headers['x-tenant-id'];
  const tenant = Array.isArray(raw) ? raw[0] : raw;
  if (!tenant) return POC_TENANT_ID;
  if (!TENANT_RE.test(tenant)) {
    throw new BadRequestException({
      code: 'TENANT_REQUIRED',
      message: 'x-tenant-id header is invalid',
    });
  }
  return tenant;
});
