import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentUserOrganizationAccess } from "@/lib/auth/authorization";
import { listAlertVersions } from "@/lib/db/repositories/alerts";
import {
  getLatestApprovalForVersion,
  publishAlertVersion,
} from "@/lib/db/repositories/publication-workflow";
import { DomainError } from "@/lib/domain/errors";
import { enforceSharedRateLimit } from "@/lib/security/rate-limit";

const uuidSchema = z.string().uuid();

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status, headers: { "Cache-Control": "no-store" } });
}

function mapError(error: unknown) {
  if (error instanceof z.ZodError) return jsonError("Invalid alert identifier.", 400);
  if (error instanceof DomainError) {
    const status = {
      VALIDATION_ERROR: 400,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      INVARIANT_VIOLATION: 409,
      RATE_LIMITED: 429,
    }[error.code];
    return jsonError(error.message, status);
  }
  return jsonError("The alert could not be published.", 500);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string; alertId: string }> },
) {
  try {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) return jsonError("Cross-origin requests are not allowed.", 403);

    const params = await context.params;
    const organizationId = uuidSchema.parse(params.organizationId);
    const alertId = uuidSchema.parse(params.alertId);
    const { membership } = await requireCurrentUserOrganizationAccess({
      organizationId,
      allowedRoles: ["owner", "admin", "publisher"],
    });

    await enforceSharedRateLimit({ key: `alert-publish:${membership.id}`, limit: 20, windowSeconds: 60 });
    const versions = await listAlertVersions({ organizationId, membershipId: membership.id, alertId });
    const latest = versions[0];
    if (!latest) throw new DomainError("NOT_FOUND", "Alert has no CAP version to publish.");

    const approval = await getLatestApprovalForVersion({
      organizationId,
      membershipId: membership.id,
      alertVersionId: latest.id,
    });
    if (!approval || approval.decision !== "approved") {
      throw new DomainError("CONFLICT", "The latest version must have an approved human review before publication.");
    }

    const result = await publishAlertVersion({
      organizationId,
      membershipId: membership.id,
      alertVersionId: latest.id,
      approvalId: approval.id,
    });
    const publicUrl = new URL(`/alerts/${result.publicToken}`, request.url).toString();

    return NextResponse.json({
      data: {
        publicationId: result.publication.id,
        publishedAt: result.publication.publishedAt,
        publicUrl,
      },
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
