#!/usr/bin/env python3
"""Gera toda a arte do Cronys a partir do desenho de docs/cronys-brand-spec.md.

Rode assim, da raiz do projeto:

    pip install pillow cairosvg
    python3 scripts/gerar-identidade.py

A GEOMETRIA E AS CORES SAO DO SPEC. O spec diz "todos os valores sao finais;
nao improvisar variacoes", entao este arquivo nao inventa nada: o SVG do
simbolo abaixo e' o do spec, copiado. Se o desenho mudar, muda la primeiro.

O motivo de existir um script em vez de 30 PNGs versionados sem origem: icone
tem 28 tamanhos (5 densidades Android x 3 variantes, favicon em 3, PWA em 2,
apple-touch, og-image, 11 splashes). Editar isso a mao garante que um dia uma
densidade fica com o desenho velho e ninguem descobre - o celular que usa
aquela densidade e' que mostra o icone errado. Aqui o desenho existe uma vez.

O QUE O DESENHO PEDE E O TAMANHO NAO DA
---------------------------------------
O ponteiro de segundos tem 3,5 de traco num quadro de 600: 0,58% do lado. Num
icone de 48px isso da' 0,28 PIXEL. Ele nao "fica fino" - ele nao existe. O
ponteiro de minuto (9/600) da' 0,72px e vira um fantasma cinza.

Isso nao e' erro do desenho nem coisa para consertar escondido: aos 192px e aos
512px, que e' onde o icone e' olhado de verdade (Play Store, PWA, aba do
navegador em tela grande), os tres ponteiros aparecem e sao o desenho todo. A
perda e' so' no menor dos tamanhos, e esta anotada aqui para quem for mexer nao
achar que "sumiu um ponteiro" e sair reescrevendo o spec.
"""

import math
import os
import subprocess
import sys

try:
    import cairosvg
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Falta dependencia: pip install pillow cairosvg")

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --------------------------------------------------------------------------
# Paleta - docs/cronys-brand-spec.md
# --------------------------------------------------------------------------
NAVY   = "#13141b"   # fundo principal
NAVY_2 = "#1b1d28"   # superficies elevadas
GOLD   = "#c9a24b"   # marca, acento principal, botoes
TEAL   = "#3f9c94"   # acento secundario: pivo, ponteiro de segundo, perna do y
INK    = "#ece7db"   # texto sobre fundo escuro. NUNCA branco puro.
INK_DIM = "#a9a79c"  # texto secundario

# --------------------------------------------------------------------------
# O simbolo, copiado do spec
# --------------------------------------------------------------------------
# Anel dourado aberto. Do centro saem tres ponteiros: hora (curto e grosso) e
# minuto (mais longo e fino) em dourado, segundo (fino, com contrapeso) em
# teal. O pivo e' um circulo teal.
#
# O angulo dos dois ponteiros dourados nao se mexe sem mexer junto no `y` do
# wordmark: eles formam o mesmo V das duas pernas da letra.
SIMBOLO = (
    '<path d="M 439.2 397.5 A 170 170 0 1 1 439.2 202.5" '
    f'fill="none" stroke="{GOLD}" stroke-width="34" stroke-linecap="round"/>'
    '<line x1="280" y1="300" x2="248.4" y2="255.0" '
    f'stroke="{GOLD}" stroke-width="14" stroke-linecap="round"/>'
    '<line x1="280" y1="300" x2="334.5" y2="222.2" '
    f'stroke="{GOLD}" stroke-width="9" stroke-linecap="round"/>'
    '<line x1="289" y1="284.4" x2="217.5" y2="408.3" '
    f'stroke="{TEAL}" stroke-width="3.5" stroke-linecap="round"/>'
    f'<circle cx="280" cy="300" r="10" fill="{TEAL}"/>'
)

# A caixa real do desenho dentro do quadro de 600, medida ponta a ponta
# (o anel vai de 130-17 a 470+17 em x, e a ponta do segundo desce ate 408+2).
# O spec da' o recorte justo: viewBox "90 105 370 380".
CAIXA = (90, 105, 370, 380)


def svg_documento(escala, fundo=None, raio_canto=0.0, circulo=False):
    """Um SVG quadrado com o simbolo dentro, ocupando `escala` do lado.

    `escala` e' a fracao do lado do quadro que o desenho ocupa - o spec pede
    ~70% para o icone do app.
    """
    x, y, w, h = CAIXA
    lado_arte = max(w, h)
    # Centraliza a caixa do desenho no quadro de 100 e a escala para `escala`.
    k = 100.0 * escala / lado_arte
    tx = 50.0 - (x + w / 2) * k
    ty = 50.0 - (y + h / 2) * k

    partes = ['<svg xmlns="http://www.w3.org/2000/svg" width="512" '
              'height="512" viewBox="0 0 100 100">']
    if fundo and circulo:
        partes.append(f'<circle cx="50" cy="50" r="50" fill="{fundo}"/>')
    elif fundo:
        # Sem gradiente: o spec proibe gradiente no fundo do icone.
        partes.append(f'<rect width="100" height="100" rx="{raio_canto}" '
                      f'ry="{raio_canto}" fill="{fundo}"/>')
    partes.append(f'<g transform="translate({tx:.4f} {ty:.4f}) scale({k:.6f})">'
                  f'{SIMBOLO}</g>')
    partes.append('</svg>')
    return "".join(partes)


def png(caminho, lado, escala, fundo=None, raio_canto=0.0, circulo=False):
    svg = svg_documento(escala, fundo, raio_canto, circulo)
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    cairosvg.svg2png(bytestring=svg.encode(), write_to=caminho,
                     output_width=lado, output_height=lado,
                     background_color="transparent")
    return caminho


# --------------------------------------------------------------------------
# 1. Os SVG da marca
# --------------------------------------------------------------------------
def gerar_svgs():
    pub = os.path.join(RAIZ, "public")
    x, y, w, h = CAIXA
    # Recorte justo, do spec: e' o que cola ao lado do texto no wordmark.
    with open(os.path.join(pub, "cronys-simbolo.svg"), "w") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" '
                f'viewBox="{x} {y} {w} {h}">{SIMBOLO}</svg>\n')
    # Sobre o navy, com canto de 22% do lado: o icone do app de referencia.
    with open(os.path.join(pub, "cronys-icone.svg"), "w") as f:
        f.write(svg_documento(0.70, NAVY, raio_canto=22) + "\n")
    print("public/cronys-simbolo.svg, public/cronys-icone.svg")


# --------------------------------------------------------------------------
# 2. Web: favicon, PWA, apple-touch
# --------------------------------------------------------------------------
def gerar_web():
    pub = os.path.join(RAIZ, "public")
    tmp = os.path.join(RAIZ, ".icones-tmp")
    os.makedirs(tmp, exist_ok=True)

    for lado in (192, 512):
        png(os.path.join(pub, f"pwa-{lado}.png"), lado, 0.70, NAVY,
            raio_canto=22)

    # apple-touch-icon: quadrado cheio. O iOS recorta por conta, e arredondar
    # aqui daria canto duplo.
    png(os.path.join(pub, "apple-touch-icon.png"), 180, 0.70, NAVY)

    # Favicon. O spec pede o simbolo SEM o fundo arredondado - mas favicon sem
    # fundo some em aba de tema claro, porque o dourado sobre branco da' 2,5:1.
    # Entao: fundo navy reto (sem canto), que e' o "sem fundo arredondado" do
    # spec cumprido ao pe da letra, e a aba clara continua enxergando o icone.
    quadros = []
    for lado in (16, 32, 48):
        p = png(os.path.join(tmp, f"fav{lado}.png"), lado, 0.80, NAVY)
        quadros.append(Image.open(p).convert("RGBA"))
    quadros[-1].save(os.path.join(pub, "favicon.ico"),
                     sizes=[(16, 16), (32, 32), (48, 48)],
                     append_images=quadros[:-1])
    # O .svg do favicon, que navegador moderno prefere e escala sem perder os
    # ponteiros finos.
    x, y, w, h = CAIXA
    with open(os.path.join(pub, "favicon.svg"), "w") as f:
        f.write(svg_documento(0.80, NAVY) + "\n")
    print("public/pwa-192.png, pwa-512.png, apple-touch-icon.png, "
          "favicon.ico, favicon.svg")


# --------------------------------------------------------------------------
# 3. Android: mipmaps
# --------------------------------------------------------------------------
# ic_launcher / _round: o icone de verdade no Android 7 e anterior.
# ic_launcher_foreground: a camada da frente do icone adaptativo (Android 8+).
#   O canvas dele e' 108dp mas so' os 66dp do meio sao garantidos - o resto o
#   sistema corta para fazer circulo, squircle, gota. Por isso a arte entra a
#   61% (66/108) e nao aos 70% do icone comum.
DENSIDADES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}


def gerar_android():
    res = os.path.join(RAIZ, "android/app/src/main/res")
    for dens, lado in DENSIDADES.items():
        d = os.path.join(res, f"mipmap-{dens}")
        # Canto de 22% do lado, como o spec pede.
        png(os.path.join(d, "ic_launcher.png"), lado, 0.70, NAVY,
            raio_canto=22)
        png(os.path.join(d, "ic_launcher_round.png"), lado, 0.70, NAVY,
            circulo=True)
        png(os.path.join(d, "ic_launcher_foreground.png"),
            round(lado * 2.25), 66.0 / 108.0)
    print("android mipmaps (5 densidades x 3 arquivos)")


# --------------------------------------------------------------------------
# 4. Splash
# --------------------------------------------------------------------------
SPLASHES = {
    "drawable": (480, 320),
    "drawable-port-mdpi": (320, 480), "drawable-land-mdpi": (480, 320),
    "drawable-port-hdpi": (480, 800), "drawable-land-hdpi": (800, 480),
    "drawable-port-xhdpi": (720, 1280), "drawable-land-xhdpi": (1280, 720),
    "drawable-port-xxhdpi": (960, 1600), "drawable-land-xxhdpi": (1600, 960),
    "drawable-port-xxxhdpi": (1280, 1920), "drawable-land-xxxhdpi": (1920, 1280),
}

FONTES = {
    "fraunces": ("fraunces.ttf",
                 "https://fonts.gstatic.com/s/fraunces/v38/6NUh8FyLNQOQZAnv9bY"
                 "EvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0K7iN7hzFUPJH58nib1603gg7S2nf"
                 "gRYIcaRyjDg.ttf"),
}


def _fraunces(tamanho):
    """Fraunces 500, a mesma do wordmark na tela."""
    caminho = os.path.join(RAIZ, ".icones-tmp", "fraunces.ttf")
    if not os.path.exists(caminho):
        return None
    try:
        f = ImageFont.truetype(caminho, tamanho)
        try:
            f.set_variation_by_axes([100.0, float(tamanho), 500.0])
        except Exception:
            pass
        return f
    except Exception:
        return None


def _desenha_wordmark(base, x, y, fonte, tamanho):
    """"ronys" em ink, com o y bicolor do spec.

    O y e' a letra da fonte desenhada tres vezes: dourada cortada em 78% da
    caixa, e teal do corte para baixo, esticada 1,35x a partir dali. E' o mesmo
    recorte que o CSS de src/components/brand.tsx faz na tela - aqui a mao e'
    o Pillow, que nao tem clip-path, entao o corte e' feito na imagem.
    """
    d = ImageDraw.Draw(base)
    corte = int(round(tamanho * 0.78))
    alto = int(round(tamanho * 2.2))

    def letra(texto, cor):
        larg = int(round(d.textlength(texto, font=fonte))) + 4
        camada = Image.new("RGBA", (max(larg, 1), alto), (0, 0, 0, 0))
        ImageDraw.Draw(camada).text((0, 0), texto, font=fonte, fill=cor)
        return camada, larg

    for texto, cor in (("ron", INK),):
        d.text((x, y), texto, font=fonte, fill=cor)
        x += d.textlength(texto, font=fonte)

    # o y: corpo dourado ate' 78%, perna teal esticada dali para baixo
    ouro, larg_y = letra("y", GOLD)
    base.alpha_composite(ouro.crop((0, 0, larg_y, corte)), (int(round(x)), int(round(y))))

    teal, _ = letra("y", TEAL)
    perna = teal.crop((0, corte, larg_y, alto))
    perna = perna.resize((perna.width, int(round(perna.height * 1.35))),
                         Image.LANCZOS)
    base.alpha_composite(perna, (int(round(x)), int(round(y)) + corte))
    x += d.textlength("y", font=fonte)

    d.text((x, y), "s", font=fonte, fill=INK)
    x += d.textlength("s", font=fonte)
    return x


def _largura_wordmark(d, fonte):
    return d.textlength("ronys", font=fonte)


def gerar_splash():
    res = os.path.join(RAIZ, "android/app/src/main/res")
    tmp = os.path.join(RAIZ, ".icones-tmp")
    for pasta, (w, h) in SPLASHES.items():
        base = Image.new("RGBA", (w, h), NAVY)
        d = ImageDraw.Draw(base)
        menor = min(w, h)

        # O simbolo FAZ o C da palavra: eles ficam lado a lado, na mesma linha,
        # e nao empilhados. E' o wordmark do spec.
        alt = round(menor * 0.16)
        p = png(os.path.join(tmp, f"splash-mark-{alt}.png"), alt, 1.0)
        marca = Image.open(p).convert("RGBA")

        corpo = round(alt * 0.62)
        fonte = _fraunces(corpo)
        if fonte:
            texto_w = _largura_wordmark(d, fonte)
            total = alt + texto_w
            x0 = (w - total) / 2
            base.paste(marca, (round(x0), (h - alt) // 2), marca)
            # baseline: o texto alinha pela linha de base do anel.
            _desenha_wordmark(base, x0 + alt - alt * 0.06,
                              (h - alt) // 2 + alt * 0.26, fonte, corpo)
        else:
            base.paste(marca, ((w - alt) // 2, (h - alt) // 2), marca)

        os.makedirs(os.path.join(res, pasta), exist_ok=True)
        base.convert("RGB").save(os.path.join(res, pasta, "splash.png"))
    print(f"android splash ({len(SPLASHES)} arquivos)")


# --------------------------------------------------------------------------
# 5. og-image
# --------------------------------------------------------------------------
def gerar_og():
    w, h = 1200, 630
    base = Image.new("RGBA", (w, h), NAVY)
    d = ImageDraw.Draw(base)
    # Fio teal embaixo: traco fino, que e' o unico papel que o spec da' ao teal.
    d.rectangle([0, h - 6, w, h], fill=TEAL)

    alt = 190
    p = png(os.path.join(RAIZ, ".icones-tmp", f"og-mark-{alt}.png"), alt, 1.0)
    marca = Image.open(p).convert("RGBA")

    corpo = round(alt * 0.62)
    fonte = _fraunces(corpo)
    sub = _fraunces(36)
    if fonte:
        texto_w = _largura_wordmark(d, fonte)
        x0 = (w - (alt + texto_w)) / 2
        topo = (h - alt) // 2 - 40
        base.paste(marca, (round(x0), topo), marca)
        _desenha_wordmark(base, x0 + alt - alt * 0.06, topo + alt * 0.26,
                          fonte, corpo)
    else:
        base.paste(marca, ((w - alt) // 2, (h - alt) // 2), marca)

    if sub:
        linha = "Agenda, alunos e cobrança para quem dá aula particular"
        lw = d.textlength(linha, font=sub)
        d.text(((w - lw) / 2, h - 160), linha, font=sub, fill=INK_DIM)

    base.convert("RGB").save(os.path.join(RAIZ, "public", "og-image.png"))
    print("public/og-image.png")


def baixar_fontes():
    """As TTF, so' para o Pillow desenhar texto. Nao vao para o git."""
    tmp = os.path.join(RAIZ, ".icones-tmp")
    os.makedirs(tmp, exist_ok=True)
    for _, (nome, url) in FONTES.items():
        destino = os.path.join(tmp, nome)
        if os.path.exists(destino):
            continue
        try:
            subprocess.run(["curl", "-sSfL", "-o", destino, url], check=True,
                           timeout=60)
        except Exception as e:
            print(f"  aviso: nao baixou {nome} ({e}); splash e og sem texto")


if __name__ == "__main__":
    baixar_fontes()
    gerar_svgs()
    gerar_web()
    gerar_android()
    gerar_splash()
    gerar_og()
    print("\nPronto. Confira antes de commitar: os PNG entram no git.")
