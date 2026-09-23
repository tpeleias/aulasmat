import { describe, it, expect } from "vitest";
import { computeStatements, type LedgerTx, type LedgerLesson } from "@/lib/billing";

const lesson = (over: Partial<LedgerLesson> & { id: string; start_at: string }): LedgerLesson => ({
  student_name: "Ana",
  duration_minutes: 60,
  subject: "Matemática",
  teacher: "prof",
  ...over,
});

const tx = (over: Partial<LedgerTx> & { id: string; amount: number; kind: string }): LedgerTx => ({
  guardian_name: null,
  student_name: "Ana",
  lesson_id: null,
  description: null,
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

// account_discounts lança, via sync_lesson_wallet, um voucher com lesson_id
// apontando pra aula certa. O bug era juntar isso num pool que quita a
// cobrança mais antiga - um desconto de hoje quitando uma aula de três
// semanas atrás, e a aula de hoje continuando cheia.
describe("computeStatements - desconto discriminado na aula", () => {
  it("o voucher da aula abate a PRÓPRIA aula, não a mais antiga em aberto", () => {
    const lessons = [
      lesson({ id: "l1", start_at: "2026-01-01T10:00:00Z" }),
      lesson({ id: "l2", start_at: "2026-01-08T10:00:00Z" }),
    ];
    const txs = [
      tx({ id: "c1", kind: "lesson", lesson_id: "l1", amount: -220, description: "Aula" }),
      tx({ id: "c2", kind: "lesson", lesson_id: "l2", amount: -220, description: "Aula" }),
      // Desconto de 10% só na segunda aula.
      tx({ id: "v2", kind: "voucher", lesson_id: "l2", amount: 22, description: "Desconto de 10% - Aula em 08/01" }),
    ];

    const [acc] = computeStatements(txs, lessons);
    expect(acc.items).toHaveLength(2);

    const first = acc.items.find(i => i.id === "c1")!;
    const second = acc.items.find(i => i.id === "c2")!;
    expect(first.amount).toBe(220);
    expect(first.discount).toBeUndefined();
    expect(second.amount).toBe(198);
    expect(second.discount).toEqual({ amount: 22, label: "Desconto de 10% - Aula em 08/01" });
    expect(acc.owed).toBe(418);
  });

  it("desconto maior que a aula não vira crédito do nada - o troco volta pro pool geral", () => {
    const lessons = [lesson({ id: "l1", start_at: "2026-01-01T10:00:00Z" })];
    const txs = [
      tx({ id: "c1", kind: "lesson", lesson_id: "l1", amount: -100 }),
      // sync_lesson_wallet nunca deixaria isso passar do valor da aula, mas o
      // teste cobre o caso mesmo assim: o excedente não pode desaparecer.
      tx({ id: "v1", kind: "voucher", lesson_id: "l1", amount: 150, description: "Desconto" }),
    ];

    const [acc] = computeStatements(txs, lessons);
    expect(acc.items).toHaveLength(0);
    expect(acc.balance).toBe(50);
  });

  it("voucher solto (sem lesson_id) continua indo pro pool geral, como antes", () => {
    const lessons = [
      lesson({ id: "l1", start_at: "2026-01-01T10:00:00Z" }),
      lesson({ id: "l2", start_at: "2026-01-08T10:00:00Z" }),
    ];
    const txs = [
      tx({ id: "c1", kind: "lesson", lesson_id: "l1", amount: -220 }),
      tx({ id: "c2", kind: "lesson", lesson_id: "l2", amount: -220 }),
      tx({ id: "v1", kind: "voucher", lesson_id: null, amount: 100, description: "Abatimento pontual" }),
    ];

    const [acc] = computeStatements(txs, lessons);
    // Sem aula vinculada, o crédito quita a mais antiga primeiro - mesmo
    // comportamento de sempre pra pagamento e voucher avulso.
    const first = acc.items.find(i => i.id === "c1")!;
    const second = acc.items.find(i => i.id === "c2")!;
    expect(first.amount).toBe(120);
    expect(first.partial).toBe(true);
    expect(first.discount).toBeUndefined();
    expect(second.amount).toBe(220);
  });
});
