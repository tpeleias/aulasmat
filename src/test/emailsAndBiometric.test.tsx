import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// E-mails automáticos, "esqueci a senha" e a digital (03/10).

const invoke = vi.fn(async (_name: string, _opts?: unknown) => ({ data: null, error: null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (n: string, o: unknown) => invoke(n, o) } } }));

import { EmailNotificationsSettings } from "@/components/EmailNotificationsSettings";
import { ForgotPasswordDialog } from "@/components/ForgotPasswordDialog";
import { biometricAvailable, declineFor, declinedFor, hasSavedLogin } from "@/lib/biometric";

beforeEach(() => { invoke.mockClear(); localStorage.clear(); });

describe("EmailNotificationsSettings", () => {
  it("nasce desligado e, ligado, vem com o pacote padrão (lembrete do dia fora)", () => {
    const onChange = vi.fn();
    const { rerender } = render(<EmailNotificationsSettings value={{}} onChange={onChange} />);
    expect(screen.queryByText(/Lembrete no dia/)).toBeNull();
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true });

    rerender(<EmailNotificationsSettings value={{ enabled: true }} onChange={onChange} />);
    const box = (re: RegExp) => screen.getByRole("checkbox", { name: re });
    expect(box(/Lembrete na véspera/).getAttribute("data-state")).toBe("checked");
    expect(box(/Lembrete no dia/).getAttribute("data-state")).toBe("unchecked");
    fireEvent.click(box(/Lembrete no dia/));
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, reminder_day: true });
  });
});

describe("ForgotPasswordDialog", () => {
  it("manda o pedido pelo e-mail e responde sempre igual", async () => {
    render(<ForgotPasswordDialog open onOpenChange={() => {}} initial="Ana@Gmail.com " />);
    fireEvent.click(screen.getByRole("button", { name: /Mandar o link/ }));
    await waitFor(() => screen.getByText(/Se esse e-mail tiver uma conta/));
    expect(invoke).toHaveBeenCalledWith("emails", { body: { action: "password_reset", email: "ana@gmail.com", locale: expect.any(String) } });
  });

  it("usuário sem @ não manda nada e explica a quem pedir", () => {
    render(<ForgotPasswordDialog open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "joao" } });
    expect(screen.getByText(/pede a senha nova a quem te atende/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Mandar o link/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("biometria", () => {
  it("no site não existe", async () => {
    expect(await biometricAvailable()).toBe(false);
    expect(await hasSavedLogin()).toBe(false);
  });

  it("'agora não' vale para aquele login, sem diferença de maiúsculas", () => {
    expect(declinedFor("Ana@x.com")).toBe(false);
    declineFor("Ana@x.com");
    expect(declinedFor("ana@x.com")).toBe(true);
    expect(declinedFor("bia@x.com")).toBe(false);
  });
});

describe("NotificationEmailCard", () => {
  it("cliente com responsável grava os dois e-mails pela função", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const calls: [string, unknown][] = [];
    (supabase as unknown as { rpc: unknown }).rpc = async (fn: string, args: unknown) => {
      calls.push([fn, args]);
      return fn === "my_notification_email"
        ? { data: { kind: "client", email: null, guardian_name: "Ana", guardian_email: null }, error: null }
        : { data: { kind: "client", email: "bia@x.com", guardian_name: "Ana", guardian_email: "ana@x.com" }, error: null };
    };
    const { NotificationEmailCard } = await import("@/components/NotificationEmailCard");
    render(<NotificationEmailCard />);
    await waitFor(() => screen.getByText("E-mail de Ana"));
    fireEvent.change(screen.getByLabelText("E-mail para avisos"), { target: { value: " Bia@X.com" } });
    fireEvent.change(screen.getByLabelText("E-mail de Ana"), { target: { value: "ana@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar e-mail" }));
    await waitFor(() => expect(calls.some(c => c[0] === "set_my_notification_email")).toBe(true));
    expect(calls.find(c => c[0] === "set_my_notification_email")![1]).toEqual({ _email: "bia@x.com", _guardian_email: "ana@x.com" });
  });

  it("some para quem não tem cadastro ligado ao login", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    (supabase as unknown as { rpc: unknown }).rpc = async () => ({ data: null, error: null });
    const { NotificationEmailCard } = await import("@/components/NotificationEmailCard");
    const { container } = render(<NotificationEmailCard />);
    await new Promise(r => setTimeout(r, 0));
    expect(container.textContent).toBe("");
  });
});
