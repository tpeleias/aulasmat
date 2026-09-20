# Cronys — especificação da identidade visual

Referência para implementar a marca no app (web + Android). Todos os valores
abaixo são finais; não improvisar variações.

## Cores

| Token | Hex | Uso |
|---|---|---|
| `navy` | `#13141b` | fundo principal |
| `navy-2` | `#1b1d28` | superfícies elevadas (cards, campos) |
| `gold` | `#c9a24b` | marca, acento principal, botões |
| `teal` | `#3f9c94` | acento secundário, pivô do símbolo, perna do y |
| `ink` | `#ece7db` | texto sobre fundo escuro (nunca branco puro) |
| `ink-dim` | `#a9a79c` | texto secundário |
| `line` | `rgba(236,231,219,0.12)` | divisórias e bordas |

## Tipografia

- **Display / wordmark / títulos:** Fraunces, peso 500
- **Corpo / interface:** Work Sans, pesos 400 / 500 / 600
- Ambas via Google Fonts. Sempre declarar fallback (`Georgia, serif` e
  `system-ui, sans-serif`).

## Símbolo

O C é um anel aberto dourado. Do centro saem três ponteiros de relógio:
hora (curto e grosso) e minuto (mais longo e fino) em dourado, segundo
(fino, com contrapeso) em teal. O pivô é um círculo teal.

O ângulo dos dois ponteiros dourados é proposital: eles formam o mesmo V
das duas pernas do `y` do wordmark.

```svg
<svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
  <path d="M 439.2 397.5 A 170 170 0 1 1 439.2 202.5"
        fill="none" stroke="#c9a24b" stroke-width="34" stroke-linecap="round"/>
  <line x1="280" y1="300" x2="248.4" y2="255.0"
        stroke="#c9a24b" stroke-width="14" stroke-linecap="round"/>
  <line x1="280" y1="300" x2="334.5" y2="222.2"
        stroke="#c9a24b" stroke-width="9" stroke-linecap="round"/>
  <line x1="289" y1="284.4" x2="217.5" y2="408.3"
        stroke="#3f9c94" stroke-width="3.5" stroke-linecap="round"/>
  <circle cx="280" cy="300" r="10" fill="#3f9c94"/>
</svg>
```

**Recorte justo** (para colar ao lado do texto no wordmark, sem folga):
usar `viewBox="90 105 370 380"` no mesmo desenho.

## Wordmark

Símbolo + a palavra "ronys" em Fraunces 500 — o C do símbolo faz o papel da
letra C. O `y` é a letra real da fonte, colorida em duas partes: o corpo
superior em `gold`, o descendente (a perna que desce) em `teal` e alongado.

```html
<span class="y-wrap">
  <span class="y-base">y</span>
  <span class="y-top">y</span>
  <span class="y-bottom">y</span>
</span>
```

```css
.y-wrap { position: relative; display: inline-block; }
.y-wrap .y-base { visibility: hidden; }          /* reserva o espaço da letra */
.y-wrap .y-top,
.y-wrap .y-bottom { position: absolute; left: 0; top: 0; }

.y-wrap .y-top {
  color: #c9a24b;
  clip-path: polygon(0 0, 100% 0, 100% 78%, 0 78%);
}

/* o recorte passa de 100% de propósito: a ponta do descendente fica abaixo
   da caixa do texto. o scaleY alonga a perna, ecoando o ponteiro de segundo. */
.y-wrap .y-bottom {
  color: #3f9c94;
  clip-path: polygon(0 78%, 100% 78%, 100% 300%, 0 300%);
  transform: scaleY(1.35);
  transform-origin: 0 78%;
}
```

Alinhamento: símbolo e texto em `display: flex; align-items: baseline`, com
`margin-right: -4px` no SVG para fechar a folga entre o C e o `r`.

## Ícone do app (Android adaptativo)

- Fundo `#13141b` sólido, sem gradiente
- Símbolo centralizado ocupando ~70% da largura
- Cantos arredondados: ~22% do lado (512px → 112px), mas o Android aplica a
  máscara própria — entregar o símbolo dentro da safe zone central
- Favicon do site: mesmo símbolo, sem o fundo arredondado

## O que NÃO fazer

- Não usar branco puro em cima do navy
- Não colocar gradiente no fundo do símbolo nem do ícone
- Não redesenhar o `y`: é a letra da fonte, só recolorida
- Não mudar o ângulo dos ponteiros sem mudar junto o `y` (eles são o mesmo
  motivo)
- Não usar o teal como cor de fundo ou de grandes áreas — ele é traço fino
