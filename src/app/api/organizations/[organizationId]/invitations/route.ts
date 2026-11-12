import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentUserOrganizationAccess } from "@/lib/auth/authorization";
import { organizationInvitationEmailText, sendAuthEmail } from "@/lib/auth/email";
import { createOrganizationInvitation, revokeUndeliveredOrganizationInvitation } from "@/lib/db/repositories/organization-invitations";
import { DomainError } from "@/lib/domain/errors";
import { enforceSharedRateLimit } from "@/lib/security/rate-limit";

const inputSchema = z.object({
  email: z.string().trim().email().max(320),
  role: z.enum(["admin", "editor", "reviewer", "publisher", "reader"]),
});
const uuidSchema = z.string().uuid();

function jsonError(message: string, status: number, details?: unknown) {
  return NextResponse.json(
    { error: { message, ...(details === undefined ? {} : { details }) } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

async function readJsonBody(request: Request): Promise<unknown> {
  const maxBytes = 4096;
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) throw new DomainError("VALIDATION_ERROR", "Invalid Content-Length.");
    if (length > maxBytes) throw new DomainError("VALIDATION_ERROR", "Invitation request is too large.");
  }
  if (!request.body) throw new DomainError("VALIDATION_ERROR", "Request body is required.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new DomainError("VALIDATION_ERROR", "Invitation request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new DomainError("VALIDATION_ERROR", "Request body is required.");

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new DomainError("VALIDATION_ERROR", "Request body must be valid UTF-8 JSON.");
  }
}

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) return jsonError("Invalid invitation input.", 400, error.issues);
  if (error instanceof DomainError) {
    const statuses = {
      VALIDATION_ERROR: 400,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      INVARIANT_VIOLATION: 500,
      RATE_LIMITED: 429,
    } as const;
    return jsonError(error.code === "INVARIANT_VIOLATION" ? "An internal error occurred." : error.message, statuses[error.code]);
  }
  return jsonError("The invitation could not be created.", 500);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
) {
  let created: Awaited<ReturnType<typeof createOrganizationInvitation>> | undefined;
  let membershipId: string | undefined;
  let organizationId: string | undefined;

  try {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) return jsonError("Cross-origin requests are not allowed.", 403);

    const rawOrganizationId = (await context.params).organizationId;
    organizationId = uuidSchema.parse(rawOrganizationId);

    const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/json") return jsonError("Content-Type must be application/json.", 415);

    const access = await requireCurrentUserOrganizationAccess({
      organizationId,
      allowedRoles: ["owner", "admin"],
    });
    membershipId = access.membership.id;

    await enforceSharedRateLimit({
      key: `organization-invite:${membershipId}`,
      limit: 20,
      windowSeconds: 60 * 60,
    });

    const input = inputSchema.parse(await readJsonBody(request));
    created = await createOrganizationInvitation({
      organizationId,
      inviterMembershipId: membershipId,
      email: input.email,
      role: input.role,
    });

    const inviteUrl = new URL("/invitations/accept", request.url);
    inviteUrl.searchParams.set("token", created.token);
    await sendAuthEmail({
      to: created.email,
      subject: `Invitation to ${created.organizationName} on CivicRelay`,
      text: organizationInvitationEmailText({
        organizationName: created.organizationName,
        role: created.role,
        url: inviteUrl.toString(),
        expiresAt: created.expiresAt,
      }),
    });

    return NextResponse.json({
      data: {
        id: created.id,
        email: created.email,
        role: created.role,
        expiresAt: created.expiresAt,
      },
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (created && membershipId && organizationId) {
      try {
        await revokeUndeliveredOrganizationInvitation({
          organizationId,
          invitationId: created.id,
          inviterMembershipId: membershipId,
        });
      } catch {
        // Preserve the original delivery failure; the undelivered invite is still unusable without its token.
      }
      return jsonError("Invitation delivery failed. The invitation was invalidated; verify the email provider configuration and retry.", 503);
    }
    return errorResponse(error);
  }
}
