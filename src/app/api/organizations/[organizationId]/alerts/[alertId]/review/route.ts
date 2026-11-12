import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentUserOrganizationAccess } from "@/lib/auth/authorization";
import { listAlertVersions } from "@/lib/db/repositories/alerts";
import { approveAlertVersion } from "@/lib/db/repositories/publication-workflow";
import { DomainError } from "@/lib/domain/errors";
import { enforceSharedRateLimit } from "@/lib/security/rate-limit";

const uuidSchema = z.string().uuid();
const inputSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().trim().max(2000).nullable().optional(),
});

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status, headers: { "Cache-Control": "no-store" } });
}

async function readInput(request: Request): Promise<unknown> {
  const limit = 4096;
  const declared = request.headers.get("content-length");
  if (declared !== null && (!Number.isSafeInteger(Number(declared)) || Number(declared) > limit || Number(declared) < 0)) {
    throw new DomainError("VALIDATION_ERROR", "Review request body is invalid or too large.");
  }
  if (!request.body) throw new DomainError("VALIDATION_ERROR", "Review decision is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new DomainError("VALIDATION_ERROR", "Review request body is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new DomainError("VALIDATION_ERROR", "Review decision is required.");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new DomainError("VALIDATION_ERROR", "Review body must be valid UTF-8 JSON.");
  }
}

function mapError(error: unknown) {
  if (error instanceof z.ZodError) return jsonError("Invalid review input.", 400);
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
  return jsonError("The review decision could not be recorded.", 500);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string; alertId: string }> },
) {
  try {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) return jsonError("Cross-origin requests are not allowed.", 403);
    if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
      return jsonError("Content-Type must be application/json.", 415);
    }

    const params = await context.params;
    const organizationId = uuidSchema.parse(params.organizationId);
    const alertId = uuidSchema.parse(params.alertId);
    const { membership } = await requireCurrentUserOrganizationAccess({
      organizationId,
      allowedRoles: ["owner", "admin", "reviewer"],
    });

    await enforceSharedRateLimit({ key: `alert-review:${membership.id}`, limit: 30, windowSeconds: 60 });
    const input = inputSchema.parse(await readInput(request));
    const versions = await listAlertVersions({ organizationId, membershipId: membership.id, alertId });
    const latest = versions[0];
    if (!latest) throw new DomainError("NOT_FOUND", "Alert has no CAP version to review.");

    const approval = await approveAlertVersion({
      organizationId,
      membershipId: membership.id,
      alertVersionId: latest.id,
      decision: input.decision,
      comment: input.comment,
    });

    return NextResponse.json({
      data: { id: approval.id, decision: approval.decision, createdAt: approval.createdAt },
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
