import { describe, it, expect, afterEach } from "vitest";
import { setLocale, fmtCurrency, currencySymbol, hourLabel, durationLabel, timeFmt } from "@/lib/i18n";

// Moeda com símbolo livre e hora no jeito de cada língua (Thiago, 27/09).
afterEach(() => { setLocale("pt-BR", "BRL", null); });

describe("moeda", () => {
  it("símbolo livre na frente do número, no formato da língua", () => {
    setLocale("pt-BR", "BRL", "MT");
    expect(fmtCurrency(1234.5)).toBe("MT 1.234,50");
    expect(fmtCurrency(-10)).toBe("-MT 10,00");
    expect(currencySymbol()).toBe("MT");
    setLocale("en", "USD", "S/");
    expect(fmtCurrency(1234.5)).toBe("S/ 1,234.50");
  });

  it("moeda dada à mão (assinatura) ignora o símbolo livre", () => {
    setLocale("pt-BR", "USD", "MT");
    expect(fmtCurrency(10, "USD")).toContain("US$");
  });

  it("sem símbolo livre, segue a moeda", () => {
    setLocale("pt-BR", "BRL", null);
    expect(fmtCurrency(10)).toBe("R$ 10,00");
  });
});

describe("hora", () => {
  it("português em 24h, inglês com AM/PM", () => {
    expect(hourLabel(15)).toBe("15h");
    expect(durationLabel(90)).toBe("1h30");
    expect(timeFmt()).toBe("HH:mm");
    setLocale("en", "USD", null);
    expect(hourLabel(15)).toBe("3 PM");
    expect(hourLabel(0)).toBe("12 AM");
    expect(hourLabel(12)).toBe("12 PM");
    expect(durationLabel(90)).toBe("1h 30m");
    expect(durationLabel(45)).toBe("45 min");
    expect(timeFmt()).toBe("h:mm a");
  });
});
