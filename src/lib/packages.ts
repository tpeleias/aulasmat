// Pacotes da empresa (tabela lesson_packages): "N aulas por R$ X".
//
// A aula continua valendo o preço cheio; o desconto do pacote entra como
// voucher, para a conta da família fechar em zero depois das N aulas. O
// voucher é a diferença entre o valor cheio das N aulas (1 hora cada, ao
// valor da hora da empresa) e o preço do pacote.

export type LessonPackage = {
  id: string;
  name: string;
  lessons: number;
  price: number;
  active: boolean;
  sort_order: number;
  /** Pacote de um serviço (migration 20260925150000); nulo = pacote geral. */
  service_id?: string | null;
};

/**
 * Quanto vale UMA sessão do pacote pelo preço cheio: a do serviço dele (ou o
 * valor da hora na duração do serviço, se o serviço não tem preço); sem
 * serviço, 1 hora ao valor da hora da empresa.
 */
export function packageUnitPrice(
  p: Pick<LessonPackage, "service_id">,
  services: { id: string; price: number | null; duration_minutes: number }[],
  hourlyPrice: number,
): number {
  const s = p.service_id ? services.find(x => x.id === p.service_id) : undefined;
  if (!s) return hourlyPrice;
  return s.price != null ? Number(s.price) : Math.round(hourlyPrice * s.duration_minutes / 60 * 100) / 100;
}

// `unitPrice`: o valor cheio de uma sessão (packageUnitPrice).
export function packageVoucher(lessons: number, price: number, unitPrice: number): number {
  if (!(lessons > 0) || !(price > 0) || !(unitPrice > 0)) return 0;
  return Math.max(0, Math.round((lessons * unitPrice - price) * 100) / 100);
}
