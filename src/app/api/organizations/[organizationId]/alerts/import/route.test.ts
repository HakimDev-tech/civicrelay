import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/organizations/[organizationId]/alerts/import/route";
import { requireCurrentUserOrganizationAccess } from "@/lib/auth/authorization";
import { ingestCapXml } from "@/lib/cap/ingest";
import { DomainError } from "@/lib/domain/errors";

vi.mock("@/lib/auth/authorization", () => ({
  requireCurrentUserOrganizationAccess: vi.fn(),
}));
vi.mock("@/lib/cap/ingest", () => ({
  ingestCapXml: vi.fn(),
}));

const organizationId = "6e6f2a7c-9d42-4c79-9f3b-9a8a64e5c321";
const membershipId = "5b7f4f26-7c45-49b4-b0f4-9f8b0a9f3e12";
const endpoint = `https://civicrelay.test/api/organizations/${organizationId}/alerts/import`;

function makeRequest(input?: {
  origin?: string;
  contentType?: string;
  body?: string;
}) {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      ...(input?.origin === undefined ? { origin: "https://civicrelay.test" } : { origin: input.origin }),
      "content-type": input?.contentType ?? "application/cap+xml",
    },
    body: input?.body ?? "<alert/>",
  });
}

const successfulIngestion = {
  outcome: "created",
  alert: {
    id: "2d7b3f90-3e5f-4b7f-9a5c-8b7f9d0e1a23",
    status: "draft",
    severity: "Severe",
    urgency: "Immediate",
    certainty: "Observed",
    effectiveAt: null,
    expiresAt: null,
  },
  version: {
    id: "3d7b3f90-3e5f-4b7f-9a5c-8b7f9d0e1a23",
    versionNumber: 1,
    capMessageType: "Alert",
    capSentAt: new Date("2026-11-12T10:00:00Z"),
    sourceSha256: "a".repeat(64),
  },
  issues: [],
};

describe("POST /api/organizations/:organizationId/alerts/import", () => {
  const previousMaxBytes = process.env.CAP_MAX_PAYLOAD_BYTES;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCurrentUserOrganizationAccess).mockResolvedValue({
      membership: { id: membershipId },
    } as never);
    vi.mocked(ingestCapXml).mockResolvedValue(successfulIngestion as never);
    delete process.env.CAP_MAX_PAYLOAD_BYTES;
  });

  afterEach(() => {
    if (previousMaxBytes === undefined) delete process.env.CAP_MAX_PAYLOAD_BYTES;
    else process.env.CAP_MAX_PAYLOAD_BYTES = previousMaxBytes;
  });

  it("derives the membership from the authenticated server-side authorization result", async () => {
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(201);
    expect(requireCurrentUserOrganizationAccess).toHaveBeenCalledWith({
      organizationId,
      allowedRoles: ["owner", "admin", "editor"],
    });
    expect(ingestCapXml).toHaveBeenCalledWith({
      organizationId,
      membershipId,
      xml: "<alert/>",
    });

    const body = await response.json();
    expect(body.data.version.versionNumber).toBe(1);
    expect(JSON.stringify(body)).not.toContain("<alert/>");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects cross-origin requests before resolving organization access", async () => {
    const response = await POST(makeRequest({ origin: "https://attacker.test" }), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(403);
    expect(requireCurrentUserOrganizationAccess).not.toHaveBeenCalled();
    expect(ingestCapXml).not.toHaveBeenCalled();
  });

  it("rejects unsupported media types", async () => {
    const response = await POST(makeRequest({ contentType: "application/json" }), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(415);
    expect(requireCurrentUserOrganizationAccess).not.toHaveBeenCalled();
  });

  it("rejects payloads above the configured byte limit without parsing them", async () => {
    process.env.CAP_MAX_PAYLOAD_BYTES = "4";
    const response = await POST(makeRequest({ body: "12345" }), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(413);
    expect(ingestCapXml).not.toHaveBeenCalled();
  });

  it("maps authorization failures to a forbidden response", async () => {
    vi.mocked(requireCurrentUserOrganizationAccess).mockRejectedValue(
      new DomainError("FORBIDDEN", "No active organization membership."),
    );

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(403);
    expect(ingestCapXml).not.toHaveBeenCalled();
  });

  it("rejects malformed organization identifiers", async () => {
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ organizationId: "not-a-uuid" }),
    });

    expect(response.status).toBe(400);
    expect(requireCurrentUserOrganizationAccess).not.toHaveBeenCalled();
  });
});
