// Pacotes da empresa (tabela lesson_packages): "N aulas por R$ X".
//
// Desde 08/10 o pacote abate AULAS, não valor: vender cria uma compra com N
// aulas de X minutos, e cada aula realizada gasta duração / X delas (migration
// 20261008010000). packageUnitPrice e packageVoucher ficam para ler os
// pacotes antigos, vendidos como dinheiro + voucher.

export type LessonPackage = {
  id: string;
  name: string;
  lessons: number;
  price: number;
  active: boolean;
  sort_order: number;
  /** Pacote de um serviço (migration 20260925150000); nulo = pacote geral. */
  service_id?: string | null;
  /** Minutos de cada aula do pacote (migration 20261008010000); nulo = a duração do serviço, ou 60. */
  minutes?: number | null;
};

/** De quantos minutos é cada aula do pacote. */
export function packageMinutes(p: Pick<LessonPackage, "minutes" | "service_id">, services: { id: string; duration_minutes: number }[]): number {
  return p.minutes ?? services.find(s => s.id === p.service_id)?.duration_minutes ?? 60;
}

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
