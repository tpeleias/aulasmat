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
};

export function packageVoucher(lessons: number, price: number, hourlyPrice: number): number {
  if (!(lessons > 0) || !(price > 0) || !(hourlyPrice > 0)) return 0;
  return Math.max(0, Math.round((lessons * hourlyPrice - price) * 100) / 100);
}
