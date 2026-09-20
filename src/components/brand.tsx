/**
 * A marca Cronys: o símbolo e a palavra.
 *
 * Existe como componente, e não como <img src="/cronys-simbolo.svg">, por dois
 * motivos. O primeiro é a cor: inline o símbolo herda `currentColor`, então o
 * mesmo desenho serve dourado sobre a barra lateral e navy sobre fundo claro —
 * com <img> seriam dois arquivos que um dia divergem. O segundo é o app
 * Android, que carrega a tela antes de qualquer requisição terminar: símbolo
 * embutido no JS aparece junto com o resto, símbolo em <img> pisca.
 *
 * A GEOMETRIA é a mesma de `scripts/gerar-identidade.py`, que desenha os
 * ícones. Os números abaixo saíram de lá; se um dia o desenho mudar, mude no
 * script e traga os dois `d` de volta para cá — senão o ícone da tela de início
 * deixa de ser o logo de dentro do app.
 */
export function CronysMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true"
         fill="none" stroke="currentColor">
      {/* O C: arco de 38° a 322°, pelo caminho longo, com a abertura nas 3h. */}
      <path d="M 75.216 69.701 A 32 32 0 1 1 75.216 30.299" strokeWidth="10" />
      {/* O ponteiro em 1h, cruzando um pouco o eixo para o centro virar eixo. */}
      <path d="M 48.576 55.313 L 54.400 33.579" strokeWidth="8.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * "Cronys" com o **y** dourado.
 *
 * O y é o detalhe que veio da landing page e é o que faz a palavra ser desta
 * marca e não de qualquer outra em serifada. Ele só é dourado sobre fundo
 * escuro — em fundo claro o dourado tem contraste 2,3:1, que é ilegível — e
 * quem decide isso é quem chama, pelo `destaque`.
 */
export function CronysWordmark({
  className = "", destaque = true,
}: { className?: string; destaque?: boolean }) {
  return (
    <span className={`font-serif font-semibold tracking-tight ${className}`}>
      Cron<span className={destaque ? "text-brand-gold" : undefined}>y</span>s
    </span>
  );
}

/** O símbolo dentro do quadrado navy, como ele aparece no ícone do celular. */
export function CronysBadge({ className = "h-11 w-11" }: { className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-2xl bg-brand-navy ${className}`}>
      <CronysMark className="h-[62%] w-[62%] text-brand-gold" />
    </div>
  );
}
