import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/organizations/[organizationId]/invitations/route";
import { requireCurrentUserOrganizationAccess } from "@/lib/auth/authorization";
import { sendAuthEmail } from "@/lib/auth/email";
import {
  createOrganizationInvitation,
  revokeUndeliveredOrganizationInvitation,
} from "@/lib/db/repositories/organization-invitations";
import { enforceSharedRateLimit } from "@/lib/security/rate-limit";

vi.mock("@/lib/auth/authorization", () => ({ requireCurrentUserOrganizationAccess: vi.fn() }));
vi.mock("@/lib/auth/email", () => ({
  sendAuthEmail: vi.fn(),
  organizationInvitationEmailText: vi.fn(() => "invitation email body"),
}));
vi.mock("@/lib/db/repositories/organization-invitations", () => ({
  createOrganizationInvitation: vi.fn(),
  revokeUndeliveredOrganizationInvitation: vi.fn(),
}));
vi.mock("@/lib/security/rate-limit", () => ({ enforceSharedRateLimit: vi.fn() }));

const organizationId = "6e6f2a7c-9d42-4c79-9f3b-9a8a64e5c321";
const membershipId = "5b7f4f26-7c45-49b4-b0f4-9f8b0a9f3e12";
const endpoint = `https://civicrelay.test/api/organizations/${organizationId}/invitations`;
const created = {
  id: "2d7b3f90-3e5f-4b7f-9a5c-8b7f9d0e1a23",
  email: "responder@example.invalid",
  role: "editor",
  expiresAt: new Date("2026-11-19T10:00:00Z"),
  organizationName: "Test Response Team",
  token: "a".repeat(43),
};

function makeRequest(input?: { origin?: string; body?: unknown }) {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      origin: input?.origin ?? "https://civicrelay.test",
      "content-type": "application/json",
    },
    body: JSON.stringify(input?.body ?? { email: created.email, role: "editor" }),
  });
}

describe("POST /api/organizations/:organizationId/invitations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCurrentUserOrganizationAccess).mockResolvedValue({
      membership: { id: membershipId },
    } as never);
    vi.mocked(enforceSharedRateLimit).mockResolvedValue();
    vi.mocked(createOrganizationInvitation).mockResolvedValue(created as never);
    vi.mocked(sendAuthEmail).mockResolvedValue();
    vi.mocked(revokeUndeliveredOrganizationInvitation).mockResolvedValue();
  });

  it("creates and emails an invitation without returning its bearer token", async () => {
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(201);
    expect(requireCurrentUserOrganizationAccess).toHaveBeenCalledWith({
      organizationId,
      allowedRoles: ["owner", "admin"],
    });
    expect(createOrganizationInvitation).toHaveBeenCalledWith({
      organizationId,
      inviterMembershipId: membershipId,
      email: created.email,
      role: "editor",
    });
    expect(sendAuthEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: created.email,
      subject: expect.stringContaining(created.organizationName),
    }));

    const body = await response.json();
    expect(body.data.email).toBe(created.email);
    expect(JSON.stringify(body)).not.toContain(created.token);
  });

  it("rejects cross-origin requests", async () => {
    const response = await POST(makeRequest({ origin: "https://attacker.test" }), {
      params: Promise.resolve({ organizationId }),
    });
    expect(response.status).toBe(403);
    expect(createOrganizationInvitation).not.toHaveBeenCalled();
  });

  it("does not permit invitations that assign owner privileges", async () => {
    const response = await POST(makeRequest({
      body: { email: created.email, role: "owner" },
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(400);
    expect(createOrganizationInvitation).not.toHaveBeenCalled();
  });

  it("invalidates the invitation if transactional email delivery fails", async () => {
    vi.mocked(sendAuthEmail).mockRejectedValue(new Error("provider unavailable"));
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(503);
    expect(revokeUndeliveredOrganizationInvitation).toHaveBeenCalledWith({
      organizationId,
      invitationId: created.id,
      inviterMembershipId: membershipId,
    });
  });
});
