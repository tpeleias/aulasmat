/**
 * A marca Cronys: o símbolo e o wordmark, como `docs/cronys-brand-spec.md`
 * define. Os números aqui são do spec; nada foi improvisado.
 *
 * Existe como componente, e não como <img src="/cronys-simbolo.svg">, por dois
 * motivos. O primeiro é o wordmark: o símbolo tem que encostar no "r" com um
 * alinhamento por baseline e uma folga negativa, e isso só dá com o SVG inline.
 * O segundo é o app Android, que pinta a tela antes de qualquer requisição
 * terminar: símbolo embutido no JS aparece junto com o resto, símbolo em <img>
 * pisca.
 *
 * A GEOMETRIA é a mesma de `scripts/gerar-identidade.py`, que gera os ícones.
 * Se um dia o desenho mudar, muda no spec, depois no script, depois aqui —
 * senão o ícone da tela de início deixa de ser o logo de dentro do app.
 */

/** O anel dourado com os três ponteiros. Recorte justo, do spec. */
export function CronysMark(
  { className = "h-6 w-6", style }: { className?: string; style?: React.CSSProperties },
) {
  return (
    <svg viewBox="90 105 370 380" className={className} style={style} aria-hidden="true">
      {/* O C: anel aberto. */}
      <path d="M 439.2 397.5 A 170 170 0 1 1 439.2 202.5"
            fill="none" stroke="#c9a24b" strokeWidth="34" strokeLinecap="round" />
      {/* Hora (curto e grosso) e minuto (longo e fino). O ângulo dos dois é
          o mesmo V das duas pernas do `y` — não se mexe num sem mexer no outro. */}
      <line x1="280" y1="300" x2="248.4" y2="255.0"
            stroke="#c9a24b" strokeWidth="14" strokeLinecap="round" />
      <line x1="280" y1="300" x2="334.5" y2="222.2"
            stroke="#c9a24b" strokeWidth="9" strokeLinecap="round" />
      {/* Segundo, com contrapeso, em teal. */}
      <line x1="289" y1="284.4" x2="217.5" y2="408.3"
            stroke="#3f9c94" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="280" cy="300" r="10" fill="#3f9c94" />
    </svg>
  );
}

/**
 * O wordmark: o símbolo **é** a letra C, e ao lado vem "ronys" em Fraunces.
 *
 * O `y` é a letra da fonte, não um desenho: a mesma letra empilhada três vezes,
 * uma invisível só para reservar o espaço e duas recortadas — corpo em dourado,
 * descendente em teal e alongado, ecoando o ponteiro de segundo. O recorte de
 * baixo passa de 100% de propósito, porque a ponta da perna fica abaixo da
 * caixa do texto.
 *
 * `tamanho` é o tamanho da fonte em qualquer unidade CSS; o símbolo se
 * dimensiona a partir dele, e não o contrário, para os dois crescerem juntos.
 */
export function CronysWordmark({
  tamanho = "1.5rem", className = "",
}: { tamanho?: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-baseline font-serif font-medium leading-none ${className}`}
      style={{ fontSize: tamanho }}
    >
      {/* -4px fecha a folga entre o C e o r, como o spec pede. */}
      <CronysMark style={{ width: "1.2em", height: "1.2em", marginRight: "-0.1em" }} />
      <span>ron</span>
      <span className="relative inline-block">
        <span className="invisible">y</span>
        <span
          className="absolute left-0 top-0"
          style={{ color: "#c9a24b", clipPath: "polygon(0 0, 100% 0, 100% 78%, 0 78%)" }}
        >y</span>
        <span
          className="absolute left-0 top-0"
          style={{
            color: "#3f9c94",
            clipPath: "polygon(0 78%, 100% 78%, 100% 300%, 0 300%)",
            transform: "scaleY(1.35)",
            transformOrigin: "0 78%",
          }}
        >y</span>
      </span>
      <span>s</span>
    </span>
  );
}

/** O símbolo dentro do quadrado navy, como ele aparece no ícone do celular. */
export function CronysBadge({ className = "h-11 w-11" }: { className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-2xl bg-brand-navy ${className}`}>
      <CronysMark className="h-[70%] w-[70%]" />
    </div>
  );
}
