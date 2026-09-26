import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ANNUAL_MONTHS_CHARGED, ACTIVE_CLIENT_DAYS, CURRENCIES, LOOKUP, MONTHLY, PLANS,
  annualMonthlyEquivalent, annualPrice, assistantMessages, itemOfLookup, planFeaturesJson,
  priceCents, teacherUpgrade, teamMonthly, type Item,
} from "@shared/plans";
import { PLAN_SQL_BEGIN, planFeaturesSql } from "@/lib/planSql";

const ITEMS: Item[] = ["start", "pro_solo", "pro", "extra", "assistant"];

describe("preços", () => {
  it("anual = 10 mensalidades (2 meses grátis), em todas as moedas e itens", () => {
    expect(ANNUAL_MONTHS_CHARGED).toBe(10);
    for (const c of CURRENCIES) for (const i of ITEMS) {
      expect(annualPrice(i, c)).toBeCloseTo(MONTHLY[c][i] * 10, 2);
    }
  });

  it("valores combinados", () => {
    expect(annualPrice("start", "BRL")).toBe(299);
    expect(annualPrice("pro_solo", "BRL")).toBe(499);
    expect(annualPrice("pro", "BRL")).toBe(1299);
    expect(annualPrice("extra", "BRL")).toBe(199);
    expect(annualPrice("assistant", "BRL")).toBe(249);
    expect(annualPrice("pro_solo", "USD")).toBe(150);
    expect(annualPrice("pro", "EUR")).toBe(390);
    expect(annualPrice("pro_solo", "GBP")).toBe(120);
    expect(annualPrice("start", "GBP")).toBe(70);
  });

  it("'equivale a X/mês' é o anual dividido por 12", () => {
    expect(annualMonthlyEquivalent("pro_solo", "BRL")).toBe(41.58);
    expect(annualMonthlyEquivalent("start", "USD")).toBe(6.67);
  });

  it("centavos para o Stripe, sem erro de arredondamento", () => {
    expect(priceCents("start", "BRL", "month")).toBe(2990);
    expect(priceCents("pro", "BRL", "year")).toBe(129900);
    expect(priceCents("assistant", "GBP", "year")).toBe(8000);
  });

  it("lookup_key vai e volta", () => {
    for (const i of ITEMS) for (const iv of ["month", "year"] as const) {
      expect(itemOfLookup(LOOKUP[i][iv])).toEqual({ item: i, interval: iv });
    }
    expect(itemOfLookup("qualquer")).toBeNull();
  });
});

describe("IA", () => {
  it("a amostra do Pro soma com o adicional", () => {
    expect(assistantMessages("pro_solo", false)).toBe(20);
    expect(assistantMessages("pro_solo", true)).toBe(120);
    expect(assistantMessages("start", true)).toBe(100);
    expect(assistantMessages("start", false)).toBe(0);
    expect(assistantMessages("pro", false)).toBe(200);
    expect(assistantMessages("essencial", true)).toBe(0);
  });
});

describe("profissionais", () => {
  it("o Pro vai até 3; o 4º sugere o Max", () => {
    expect(teacherUpgrade("pro_solo", 3)).toEqual({ fits: true, suggest: null });
    expect(teacherUpgrade("pro_solo", 4)).toEqual({ fits: false, suggest: "pro" });
    expect(teacherUpgrade("start", 2)).toEqual({ fits: false, suggest: "pro_solo" });
    expect(teacherUpgrade("essencial", 2).suggest).toBe("pro_solo");
    expect(teacherUpgrade("pro", 9)).toEqual({ fits: true, suggest: null });
  });

  it("mensalidade com extras", () => {
    expect(teamMonthly("pro_solo", 3, "BRL")).toBe(89.7);
    expect(teamMonthly("pro", 7, "BRL")).toBe(169.7);
    expect(teamMonthly("start", 1, "USD")).toBe(8);
  });
});

describe("limites e recursos", () => {
  it("cliente ativo: 60 dias; Essencial 10, Start 25, Pro e Max sem teto", () => {
    expect(ACTIVE_CLIENT_DAYS).toBe(60);
    expect(PLANS.essencial.maxActiveClients).toBe(10);
    expect(PLANS.start.maxActiveClients).toBe(25);
    expect(PLANS.pro_solo.maxActiveClients).toBeNull();
    expect(PLANS.pro.maxActiveClients).toBeNull();
  });

  it("palavras do ramo no Essencial; franquia de mensagens automáticas ainda nula", () => {
    expect(planFeaturesJson("essencial").vocabulary).toBe(true);
    for (const p of Object.values(PLANS)) expect(p.autoMessagesQuota).toBeNull();
  });

  it("o banco diz exatamente o que plans.ts diz (a última migration de plan_features foi gerada daqui)", () => {
    const dir = path.resolve(__dirname, "../../supabase/migrations");
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
    const last = [...files].reverse().find(f => fs.readFileSync(path.join(dir, f), "utf8").includes(PLAN_SQL_BEGIN));
    expect(last, "nenhuma migration com o bloco gerado de plan_features").toBeTruthy();
    const later = files.filter(f => f > last!).filter(f => fs.readFileSync(path.join(dir, f), "utf8").includes("FUNCTION public.plan_features"));
    expect(later, "migration posterior redefine plan_features à mão").toEqual([]);
    expect(fs.readFileSync(path.join(dir, last!), "utf8")).toContain(planFeaturesSql());
  });
});
