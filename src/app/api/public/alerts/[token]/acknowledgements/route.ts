import { NextResponse } from "next/server";
import { z } from "zod";
import { recordPublicAcknowledgement } from "@/lib/db/repositories/publication-workflow";
import { DomainError } from "@/lib/domain/errors";
import { enforceSharedRateLimit } from "@/lib/security/rate-limit";

const inputSchema = z.object({ type: z.enum(["received", "understood", "safe", "need_help"]) });

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) return NextResponse.json({ error: { message: "Invalid acknowledgement." } }, { status: 400 });
  if (error instanceof DomainError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "RATE_LIMITED" ? 429 : 400;
    return NextResponse.json({ error: { message: error.message } }, { status });
  }
  return NextResponse.json({ error: { message: "The acknowledgement could not be recorded." } }, { status: 500 });
}

async function readInput(request: Request) {
  const limit = 1024;
  const declared = request.headers.get("content-length");
  if (declared !== null && (!Number.isSafeInteger(Number(declared)) || Number(declared) < 0 || Number(declared) > limit)) {
    throw new DomainError("VALIDATION_ERROR", "Acknowledgement request is too large.");
  }
  if (!request.body) throw new DomainError("VALIDATION_ERROR", "Acknowledgement type is required.");
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
        throw new DomainError("VALIDATION_ERROR", "Acknowledgement request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new DomainError("VALIDATION_ERROR", "Acknowledgement type is required.");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new DomainError("VALIDATION_ERROR", "Acknowledgement body must be valid UTF-8 JSON."); }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) {
      return NextResponse.json({ error: { message: "Cross-origin requests are not allowed." } }, { status: 403 });
    }
    if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
      return NextResponse.json({ error: { message: "Content-Type must be application/json." } }, { status: 415 });
    }

    const token = z.string().min(32).max(128).parse((await context.params).token);
    await enforceSharedRateLimit({ key: `public-ack:${token}`, limit: 30, windowSeconds: 60 });
    const input = inputSchema.parse(await readInput(request));
    const entry = await recordPublicAcknowledgement({ token, type: input.type });

    return NextResponse.json({ data: { type: entry.type, createdAt: entry.createdAt } }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
