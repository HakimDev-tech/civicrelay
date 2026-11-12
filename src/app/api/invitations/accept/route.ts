import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/session";
import { acceptOrganizationInvitation } from "@/lib/db/repositories/organization-invitations";
import { DomainError } from "@/lib/domain/errors";
import { enforceSharedRateLimit } from "@/lib/security/rate-limit";

const inputSchema = z.object({ token: z.string().min(32).max(256) });

function jsonError(message: string, status: number, details?: unknown) {
  return NextResponse.json(
    { error: { message, ...(details === undefined ? {} : { details }) } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

async function readJsonBody(request: Request): Promise<unknown> {
  const maxBytes = 1024;
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) throw new DomainError("VALIDATION_ERROR", "Invalid Content-Length.");
    if (length > maxBytes) throw new DomainError("VALIDATION_ERROR", "Invitation token request is too large.");
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
        throw new DomainError("VALIDATION_ERROR", "Invitation token request is too large.");
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
  if (error instanceof z.ZodError) return jsonError("Invalid invitation token.", 400, error.issues);
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
  return jsonError("The invitation could not be accepted.", 500);
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) return jsonError("Cross-origin requests are not allowed.", 403);

    const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/json") return jsonError("Content-Type must be application/json.", 415);

    const session = await getCurrentSession();
    if (!session) return jsonError("Authentication is required.", 401);
    if (!session.user.emailVerified) return jsonError("Verify your email address before accepting an organization invitation.", 403);

    await enforceSharedRateLimit({
      key: `invitation-accept:${session.user.id}`,
      limit: 10,
      windowSeconds: 60 * 60,
    });

    const input = inputSchema.parse(await readJsonBody(request));
    const membership = await acceptOrganizationInvitation({
      token: input.token,
      userId: session.user.id,
      email: session.user.email,
    });

    return NextResponse.json({ data: membership }, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
