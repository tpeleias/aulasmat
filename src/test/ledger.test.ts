import { describe, expect, it } from "vitest";
import { buildLedger, lessonsLeftIn, packageSizeFrom } from "@/lib/ledger";
import { computeStatements, type LedgerLesson, type LedgerTx } from "@/lib/billing";

const labels = { appointment: "Aula", entry: "Lançamento", payment: "Pagamento", package: "Pacote", voucher: "Voucher", leftover: "Sobra de desconto", adjustment: "Ajuste" };
let n = 0;
const tx = (amount: number, kind: string, created_at: string, extra: Partial<LedgerTx> = {}): LedgerTx => ({
  id: `t${++n}`, guardian_name: "Ana", student_name: "Bia", amount, kind, lesson_id: null, description: null, created_at, ...extra,
});
const lesson = (id: string, start_at: string): LedgerLesson => ({ id, student_name: "Bia", start_at, duration_minutes: 60, subject: "Matemática", teacher: "t" });

describe("razão da conta (pacotes e aulas)", () => {
  it("põe as aulas na ordem da data da aula, não de quando foram lançadas", () => {
    const ls = [lesson("a", "2026-09-20T15:00:00Z"), lesson("b", "2026-08-01T15:00:00Z"), lesson("c", "2026-09-01T15:00:00Z")];
    const txs = [
      tx(-200, "lesson", "2026-09-21T00:00:00Z", { lesson_id: "a" }),
      tx(-200, "lesson", "2026-09-30T00:00:00Z", { lesson_id: "b" }), // lançada por último
      tx(-200, "lesson", "2026-09-02T00:00:00Z", { lesson_id: "c" }),
    ];
    const led = buildLedger(txs, ls, labels);
    expect(led.charges.map(c => c.lessonId)).toEqual(["b", "c", "a"]);
    expect(led.entries.map(e => e.lessonId)).toEqual(["b", "c", "a"]);
    expect(led.entries.at(-1)!.balance).toBe(-600);
  });

  it("junta o pacote com o voucher dele e mostra as aulas que ele abateu", () => {
    const ls = [lesson("a", "2026-09-02T15:00:00Z"), lesson("b", "2026-09-09T15:00:00Z"), lesson("c", "2026-09-16T15:00:00Z")];
    const at = "2026-09-01T10:00:00Z";
    const txs = [
      tx(400, "package", at, { description: "Pacote 3 aulas" }),
      tx(200, "voucher", at, { description: "Voucher pacote 3 aulas" }),
      tx(-220, "lesson", "2026-09-03T00:00:00Z", { lesson_id: "a" }),
      tx(-220, "lesson", "2026-09-10T00:00:00Z", { lesson_id: "b" }),
      tx(-220, "lesson", "2026-09-17T00:00:00Z", { lesson_id: "c" }),
    ];
    const led = buildLedger(txs, ls, labels);
    expect(led.sources).toHaveLength(1);
    const p = led.sources[0];
    expect(p).toMatchObject({ kind: "package", money: 400, voucher: 200, total: 600, used: 600, left: 0, packageSize: 3 });
    expect(p.covers.map(c => [c.amount, c.partial])).toEqual([[220, false], [220, false], [160, true]]);
    expect(led.charges.map(c => c.status)).toEqual(["paid", "paid", "partial"]);
    expect(led.charges[2].open).toBe(60);
    // O extrato mostra o pacote numa linha só.
    expect(led.entries.filter(e => e.kind === "package")).toHaveLength(1);
  });

  it("desconto fixo abate a própria aula, e o pacote paga só o resto", () => {
    const ls = [lesson("a", "2026-09-02T15:00:00Z")];
    const txs = [
      tx(500, "package", "2026-09-01T10:00:00Z", { description: "Pacote 5 aulas" }),
      tx(-200, "lesson", "2026-09-03T00:00:00Z", { lesson_id: "a" }),
      tx(50, "voucher", "2026-09-03T00:00:00Z", { lesson_id: "a", description: "Desconto de R$ 50,00" }),
    ];
    const led = buildLedger(txs, ls, labels);
    expect(led.charges[0]).toMatchObject({ gross: 200, discount: 50, net: 150, paid: 150, status: "paid" });
    expect(led.sources[0]).toMatchObject({ used: 150, left: 350 });
    // Pacote de 5 por 500: cada aula do pacote vale 100, e sobram 350.
    expect(lessonsLeftIn(led.sources[0], led.charges)).toBe(3);
    // Sem saber o tamanho, conta pelo valor da última aula (150).
    expect(lessonsLeftIn({ ...led.sources[0], packageSize: null }, led.charges)).toBe(2);
  });

  it("deixa em aberto exatamente o que o extrato da cobrança diz (contas aleatórias)", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let round = 0; round < 200; round++) {
      const ls: LedgerLesson[] = [];
      const txs: LedgerTx[] = [];
      const k = 1 + Math.floor(rnd() * 8);
      for (let i = 0; i < k; i++) {
        const id = `L${round}-${i}`;
        const day = String(1 + Math.floor(rnd() * 28)).padStart(2, "0");
        ls.push(lesson(id, `2026-09-${day}T15:00:00Z`));
        txs.push(tx(-(100 + Math.floor(rnd() * 3) * 50), "lesson", `2026-10-0${1 + Math.floor(rnd() * 8)}T00:00:00Z`, { lesson_id: id }));
        if (rnd() < 0.3) txs.push(tx(Math.floor(rnd() * 300), "voucher", "2026-10-01T00:00:00Z", { lesson_id: id }));
      }
      const credits = Math.floor(rnd() * 4);
      for (let i = 0; i < credits; i++) {
        const at = `2026-0${7 + Math.floor(rnd() * 3)}-1${i}T00:00:00Z`;
        txs.push(tx(Math.floor(rnd() * 500), rnd() < 0.5 ? "package" : "adjustment", at));
        if (rnd() < 0.5) txs.push(tx(Math.floor(rnd() * 100), "voucher", at));
      }
      if (rnd() < 0.3) txs.push(tx(-80, "adjustment", "2026-09-05T00:00:00Z", { description: "Material" }));
      const st = computeStatements(txs, ls)[0];
      const led = buildLedger(txs, ls, labels);
      const open = led.charges.filter(c => c.open > 0);
      expect(open.map(c => [c.id, c.open, c.status === "partial"])).toEqual(st.items.map(i => [i.id, i.amount, i.partial]));
      const left = Math.round(led.sources.reduce((s, x) => s + x.left, 0) * 100) / 100;
      expect(Math.round((left - st.owed) * 100) / 100).toBe(st.balance);
      expect(led.entries.at(-1)?.balance ?? 0).toBe(st.balance);
    }
  });

  it("pacote por aulas: aula coberta aparece como do pacote, com o numero dela", () => {
    const ls = [lesson("a", "2026-09-02T15:00:00Z"), { ...lesson("b", "2026-09-09T15:00:00Z"), duration_minutes: 120 }, lesson("c", "2026-09-16T15:00:00Z")];
    const txs = [
      tx(-2000, "package", "2026-09-01T10:00:00Z", { description: "Pacote 10", package_purchase_id: "P" } as Partial<LedgerTx>),
      tx(2000, "adjustment", "2026-09-01T10:00:00Z", { description: "Pix" }),
      tx(0, "lesson", "2026-09-03T00:00:00Z", { lesson_id: "a" }),
      tx(0, "lesson", "2026-09-10T00:00:00Z", { lesson_id: "b" }),
      tx(-110, "lesson", "2026-09-17T00:00:00Z", { lesson_id: "c" }),
    ];
    const led = buildLedger(txs, ls, labels, {
      purchases: [{ id: "P", name: "Pacote 10", sessions: 3.5, minutes: 60, price: 2000, created_at: "2026-09-01T10:00:00Z" }],
      uses: [{ purchase_id: "P", lesson_id: "a", sessions: 1 }, { purchase_id: "P", lesson_id: "b", sessions: 2 }, { purchase_id: "P", lesson_id: "c", sessions: 0.5 }],
    });
    expect(led.charges.filter(c => !c.packageSale).map(c => c.status)).toEqual(["package", "package", "open"]);
    expect(led.charges.find(c => c.lessonId === "b")!.packageUses[0]).toMatchObject({ from: 1, to: 3, total: 3.5 });
    expect(led.packages[0]).toMatchObject({ used: 3.5, left: 0, saleChargeId: led.charges.find(c => c.packageSale)!.id });
    // A venda do pacote foi paga pelo Pix; a terceira aula, meio coberta, deve 110.
    expect(led.charges.find(c => c.packageSale)!.status).toBe("paid");
    const st = computeStatements(txs, ls)[0];
    expect(st.owed).toBe(110);
    expect(led.charges.filter(c => c.open > 0).map(c => c.open)).toEqual([110]);
  });

  it("descobre o tamanho do pacote pelo cadastro ou pelo nome", () => {
    expect(packageSizeFrom("Mensal", [{ name: "Mensal", lessons: 8 }])).toBe(8);
    expect(packageSizeFrom("Pacote 5 aulas — R$ 1.050,00")).toBe(5);
    expect(packageSizeFrom("Pacote especial")).toBeNull();
  });
});
