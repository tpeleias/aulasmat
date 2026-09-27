import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

import { routeUrl } from "@/lib/navigation";

describe("routeUrl", () => {
  it("Waze e Google Maps levam ao mesmo endereço", () => {
    expect(routeUrl("Rua A, 10", "waze")).toBe("https://waze.com/ul?q=Rua%20A%2C%2010&navigate=yes");
    expect(routeUrl("Rua A, 10", "maps")).toBe("https://www.google.com/maps/dir/?api=1&destination=Rua%20A%2C%2010");
  });
});
