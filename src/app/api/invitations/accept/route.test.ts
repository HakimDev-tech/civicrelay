import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/invitations/accept/route";
import { getCurrentSession } from "@/lib/auth/session";
import { acceptOrganizationInvitation } from "@/lib/db/repositories/organization-invitations";
import { enforceSharedRateLimit } from "@/lib/security/rate-limit";

vi.mock("@/lib/auth/session", () => ({ getCurrentSession: vi.fn() }));
vi.mock("@/lib/db/repositories/organization-invitations", () => ({
  acceptOrganizationInvitation: vi.fn(),
}));
vi.mock("@/lib/security/rate-limit", () => ({ enforceSharedRateLimit: vi.fn() }));

const token = "a".repeat(43);
const endpoint = "https://civicrelay.test/api/invitations/accept";
const session = {
  user: {
    id: "5b7f4f26-7c45-49b4-b0f4-9f8b0a9f3e12",
    email: "responder@example.invalid",
    emailVerified: true,
  },
};
const accepted = {
  organizationId: "6e6f2a7c-9d42-4c79-9f3b-9a8a64e5c321",
  organizationName: "Test Response Team",
  organizationSlug: "test-response-team",
  membershipId: "2d7b3f90-3e5f-4b7f-9a5c-8b7f9d0e1a23",
  role: "editor",
};

function makeRequest(origin = "https://civicrelay.test") {
  return new Request(endpoint, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

describe("POST /api/invitations/accept", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentSession).mockResolvedValue(session as never);
    vi.mocked(enforceSharedRateLimit).mockResolvedValue();
    vi.mocked(acceptOrganizationInvitation).mockResolvedValue(accepted as never);
  });

  it("accepts invitations only for the verified session email", async () => {
    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
    expect(acceptOrganizationInvitation).toHaveBeenCalledWith({
      token,
      userId: session.user.id,
      email: session.user.email,
    });
    const body = await response.json();
    expect(body.data.role).toBe("editor");
    expect(JSON.stringify(body)).not.toContain(token);
  });

  it("requires an authenticated session", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(null as never);
    const response = await POST(makeRequest());
    expect(response.status).toBe(401);
    expect(acceptOrganizationInvitation).not.toHaveBeenCalled();
  });

  it("requires verified email before accepting an invitation", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: { ...session.user, emailVerified: false },
    } as never);
    const response = await POST(makeRequest());
    expect(response.status).toBe(403);
    expect(acceptOrganizationInvitation).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests", async () => {
    const response = await POST(makeRequest("https://attacker.test"));
    expect(response.status).toBe(403);
    expect(getCurrentSession).not.toHaveBeenCalled();
  });
});
