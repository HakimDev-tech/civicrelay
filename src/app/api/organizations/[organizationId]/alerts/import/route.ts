import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentUserOrganizationAccess } from "@/lib/auth/authorization";
import { ingestCapXml } from "@/lib/cap/ingest";
import { DomainError } from "@/lib/domain/errors";
import { enforceSharedRateLimit } from "@/lib/security/rate-limit";

const organizationIdSchema = z.string().uuid();
const editorRoles = ["owner", "admin", "editor"] as const;
const DEFAULT_MAX_BYTES = 1_048_576;

function maxPayloadBytes(): number {
  const configured = Number(process.env.CAP_MAX_PAYLOAD_BYTES ?? DEFAULT_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_BYTES;
}

function jsonError(message: string, status: number, details?: unknown) {
  return NextResponse.json(
    { error: { message, ...(details === undefined ? {} : { details }) } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

async function readBoundedUtf8(request: Request, limit: number): Promise<string> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new DomainError("VALIDATION_ERROR", "Invalid Content-Length header.");
    }
    if (parsedLength > limit) {
      throw new PayloadTooLargeError();
    }
  }

  if (!request.body) {
    throw new DomainError("VALIDATION_ERROR", "The request body is empty.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > limit) {
        await reader.cancel();
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) {
    throw new DomainError("VALIDATION_ERROR", "The request body is empty.");
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DomainError("VALIDATION_ERROR", "The request body must be valid UTF-8.");
  }
}

class PayloadTooLargeError extends Error {
  constructor() {
    super("CAP XML payload exceeds the configured size limit.");
    this.name = "PayloadTooLargeError";
  }
}

function errorResponse(error: unknown) {
  if (error instanceof PayloadTooLargeError) {
    return jsonError(error.message, 413);
  }
  if (error instanceof z.ZodError) {
    return jsonError("Invalid request.", 400, error.issues);
  }
  if (error instanceof DomainError) {
    const statusByCode = {
      VALIDATION_ERROR: 400,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      INVARIANT_VIOLATION: 500,
      RATE_LIMITED: 429,
    } as const;
    return jsonError(
      error.code === "INVARIANT_VIOLATION" ? "An internal consistency error occurred." : error.message,
      statusByCode[error.code],
      error.code === "INVARIANT_VIOLATION" ? undefined : error.details,
    );
  }

  return jsonError("An unexpected error occurred while importing the CAP message.", 500);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
) {
  try {
    // Cookie-authenticated mutations must originate from this exact application origin.
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) {
      return jsonError("Cross-origin requests are not allowed.", 403);
    }

    const { organizationId: rawOrganizationId } = await context.params;
    const organizationId = organizationIdSchema.parse(rawOrganizationId);

    const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (!contentType || !["application/cap+xml", "application/xml", "text/xml"].includes(contentType)) {
      return jsonError("Content-Type must be application/cap+xml, application/xml, or text/xml.", 415);
    }

    // Resolve both identity and membership from the verified server-side session.
    const { membership } = await requireCurrentUserOrganizationAccess({
      organizationId,
      allowedRoles: editorRoles,
    });

    await enforceSharedRateLimit({ key: `cap-import:${membership.id}`, limit: 10, windowSeconds: 60 });

    const xml = await readBoundedUtf8(request, maxPayloadBytes());
    const result = await ingestCapXml({
      organizationId,
      membershipId: membership.id,
      xml,
    });

    return NextResponse.json({
      data: {
        outcome: result.outcome,
        alert: {
          id: result.alert.id,
          status: result.alert.status,
          severity: result.alert.severity,
          urgency: result.alert.urgency,
          certainty: result.alert.certainty,
          effectiveAt: result.alert.effectiveAt,
          expiresAt: result.alert.expiresAt,
        },
        version: {
          id: result.version.id,
          versionNumber: result.version.versionNumber,
          messageType: result.version.capMessageType,
          sentAt: result.version.capSentAt,
          sourceSha256: result.version.sourceSha256,
        },
        issues: result.issues,
      },
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
