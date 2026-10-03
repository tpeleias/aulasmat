import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// E-mails automáticos, "esqueci a senha" e a digital (03/10).

const invoke = vi.fn(async (_name: string, _opts?: unknown) => ({ data: null, error: null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (n: string, o: unknown) => invoke(n, o) } } }));
let billing = true;
let brand = false, custom = false;
vi.mock("@/hooks/usePlan", () => ({ usePlan: () => ({ plan: { email_billing: billing, email_branding: brand, email_custom: custom }, loading: false }) }));

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

describe("EmailNotificationsSettings: financeiro", () => {
  it("cobrança automática nasce desligada; o recibo, ligado", () => {
    billing = true;
    const onChange = vi.fn();
    render(<EmailNotificationsSettings value={{ enabled: true }} onChange={onChange} />);
    const box = (re: RegExp) => screen.getByRole("checkbox", { name: re });
    expect(box(/fim do dia/).getAttribute("data-state")).toBe("unchecked");
    expect(box(/segunda-feira/).getAttribute("data-state")).toBe("unchecked");
    expect(box(/todo mês/).getAttribute("data-state")).toBe("unchecked");
    expect(box(/Pagamento recebido/).getAttribute("data-state")).toBe("checked");
    fireEvent.click(box(/segunda-feira/));
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, billing_weekly: true });
  });

  it("fora do plano, as opções aparecem travadas", () => {
    billing = false;
    render(<EmailNotificationsSettings value={{ enabled: true }} onChange={() => {}} />);
    expect(screen.getByText(/nos planos Start, Pro e Max/)).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: /segunda-feira/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Pacote acabando/ }) as HTMLButtonElement).disabled).toBe(true);
    billing = true;
  });
});

describe("EmailNotificationsSettings: personalização (etapa 3)", () => {
  it("sem Pro/Max fica travado; no Max, o texto editado vai para templates", () => {
    brand = false; custom = false;
    const onChange = vi.fn();
    const { unmount } = render(<EmailNotificationsSettings value={{ enabled: true }} onChange={onChange} accountId="acc" />);
    expect(screen.getByText(/nos planos Pro e Max/)).toBeTruthy();
    expect(screen.getByText(/no plano Max/)).toBeTruthy();
    expect((screen.getByLabelText("Assinatura no fim de cada e-mail") as HTMLTextAreaElement).disabled).toBe(true);
    unmount();

    brand = true; custom = true;
    render(<EmailNotificationsSettings value={{ enabled: true }} onChange={onChange} accountId="acc" />);
    fireEvent.change(screen.getByLabelText("Assinatura no fim de cada e-mail"), { target: { value: "Um abraço" } });
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, brand_signature: "Um abraço" });
    fireEvent.change(screen.getByLabelText("Assunto"), { target: { value: "Até amanhã, {nome}!" } });
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, templates: { eve: { subject: "Até amanhã, {nome}!" } } });
    brand = false; custom = false;
  });
});

describe("EmailNotificationsSettings: tarefas, resumo, pacote e agenda", () => {
  it("nascem ligados e cada um desliga sozinho", () => {
    billing = true;
    const onChange = vi.fn();
    render(<EmailNotificationsSettings value={{ enabled: true }} onChange={onChange} />);
    const box = (re: RegExp) => screen.getByRole("checkbox", { name: re });
    for (const re of [/Tarefa nova/, /Tarefas pendentes na véspera/, /^Resumo/, /Pacote acabando/, /Agenda de amanhã/]) {
      expect(box(re).getAttribute("data-state")).toBe("checked");
    }
    fireEvent.click(box(/Agenda de amanhã/));
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, agenda_tomorrow: false });
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
  it("login da família: o seu e-mail e, recolhido, o do aluno", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const calls: [string, unknown][] = [];
    (supabase as unknown as { rpc: unknown }).rpc = async (fn: string, args: unknown) => {
      calls.push([fn, args]);
      return fn === "my_notification_email"
        ? { data: { kind: "guardian", email: null, guardian_name: "Ana", student_name: "Bia", student_email: null }, error: null }
        : { data: { kind: "guardian", email: "ana@x.com", guardian_name: "Ana", student_name: "Bia", student_email: "bia@x.com" }, error: null };
    };
    const { NotificationEmailCard } = await import("@/components/NotificationEmailCard");
    render(<NotificationEmailCard />);
    await waitFor(() => screen.getByText("Seu e-mail"));
    expect(screen.queryByLabelText("E-mail de Bia")).toBeNull();
    fireEvent.change(screen.getByLabelText("E-mail para avisos"), { target: { value: " Ana@X.com" } });
    fireEvent.click(screen.getByText("Adicionar o e-mail de Bia"));
    fireEvent.change(screen.getByLabelText("E-mail de Bia"), { target: { value: "bia@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar e-mail" }));
    await waitFor(() => expect(calls.some(c => c[0] === "save_my_notification_email")).toBe(true));
    expect(calls.find(c => c[0] === "save_my_notification_email")![1]).toEqual({ _mine: "ana@x.com", _student: "bia@x.com" });
  });

  it("login do aluno: só o e-mail dele, já com o que a família pôs", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    (supabase as unknown as { rpc: unknown }).rpc = async () => ({ data: { kind: "child", email: "bia@x.com", student_name: "Bia" }, error: null });
    const { NotificationEmailCard } = await import("@/components/NotificationEmailCard");
    render(<NotificationEmailCard />);
    await waitFor(() => expect((screen.getByLabelText("E-mail para avisos") as HTMLInputElement).value).toBe("bia@x.com"));
    expect(screen.queryByText("Seu e-mail")).toBeNull();
    expect(screen.queryByText(/Adicionar o e-mail/)).toBeNull();
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
