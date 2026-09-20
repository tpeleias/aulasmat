#!/usr/bin/env python3
"""Gera toda a arte do Cronys a partir de UMA descricao geometrica.

Rode assim, da raiz do projeto:

    pip install pillow cairosvg
    python3 scripts/gerar-identidade.py

O motivo de existir um script em vez de 30 PNGs versionados sem origem: icone
tem 28 tamanhos (5 densidades Android x 3 variantes, favicon em 3, PWA em 2,
apple-touch, og-image, 11 splashes). Editar isso a mao garante que um dia uma
densidade fica com o desenho velho e ninguem descobre - o celular que usa
aquela densidade e' que mostra o icone errado. Aqui o desenho existe uma vez.

O SIMBOLO
---------
Um "C" dourado com um ponteiro saindo do centro. Le-se como letra (Cronys) e
como relogio (Chronos), que e' o que o produto vende: horario.

Ele foi desenhado a 48px primeiro, nao a 512px. 48px e' o tamanho que importa
- icone na tela de inicio, favicon na aba - e e' onde contorno fino morre. Daí
as escolhas abaixo: traco grosso (10 de 100), miolo cheio, e um vao de 5,7
entre a ponta do ponteiro e a borda de dentro do C, que a 48px ainda sobra ~3px
e nao vira borrao.

O ponteiro cruza um pouco o eixo, do jeito que ponteiro de relogio de verdade
cruza: e' esse contrapeso curto que faz o centro parecer um eixo. Sem ele o
traco fica boiando, e o desenho vira um C com um acento.

O ponteiro aponta para 1 hora, nao para 12. Na vertical ele vira uma barra
dentro de um C - poderia ser um simbolo de centavo. Inclinado, so' ha uma
leitura possivel: ponteiro de relogio.
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
# Paleta
# --------------------------------------------------------------------------
# Os mesmos valores estao em src/index.css como tokens HSL. Se mudar um lado,
# mude o outro - o icone e a tela tem que ser a mesma marca.
NAVY_FUNDO = "#0D1828"   # fundo do icone, barra lateral, topo do login
GOLD       = "#C9A227"   # o simbolo, e o acento da marca
BRANCO     = "#F5F2EA"   # o texto do wordmark (branco levemente quente)

# --------------------------------------------------------------------------
# Geometria do simbolo, num quadro de 100x100
# --------------------------------------------------------------------------
CENTRO = 50.0
ARCO_R = 32.0            # linha de centro do C
ARCO_W = 10.0            # espessura do C -> borda interna em 27, externa em 37
VAO_GRAUS = 38.0         # metade da abertura do C, centrada nas 3 horas
PONT_ANG = 285.0         # 1 hora (0 = 3h, e o y cresce para baixo)
PONT_R = 17.0            # da ponta: com a cabeca redonda, chega a 21,2
PONT_CAUDA = 5.5         # o contrapeso, do outro lado do eixo
PONT_W = 8.5

# O desenho inteiro cabe num circulo de raio 37 -> 74% do quadro.
MARCA_DIAM = 2 * (ARCO_R + ARCO_W / 2) / 100.0   # 0.74


def _ponto(ang_graus, raio):
    a = math.radians(ang_graus)
    return CENTRO + raio * math.cos(a), CENTRO + raio * math.sin(a)


def simbolo_svg(escala=1.0, cor=GOLD):
    """Os elementos do simbolo, centrados em 50,50 e escalados em torno dali."""
    ini, fim = VAO_GRAUS, 360.0 - VAO_GRAUS
    x1, y1 = _ponto(ini, ARCO_R)
    x2, y2 = _ponto(fim, ARCO_R)
    px, py = _ponto(PONT_ANG, PONT_R)
    cx, cy = _ponto(PONT_ANG, -PONT_CAUDA)
    # sweep=1: o arco vai de 38 graus ate 322 pelo caminho longo, passando por
    # 180 - e' o caminho longo que deixa a abertura do C na direita.
    arco = (f'M {x1:.3f} {y1:.3f} '
            f'A {ARCO_R} {ARCO_R} 0 1 1 {x2:.3f} {y2:.3f}')
    return (
        f'<g transform="translate({CENTRO} {CENTRO}) scale({escala:.5f}) '
        f'translate({-CENTRO} {-CENTRO})" '
        f'fill="none" stroke="{cor}" stroke-linecap="butt">'
        f'<path d="{arco}" stroke-width="{ARCO_W}"/>'
        f'<path d="M {cx:.3f} {cy:.3f} L {px:.3f} {py:.3f}" '
        f'stroke-width="{PONT_W}" stroke-linecap="round"/>'
        f'</g>'
    )


def svg_documento(lado, escala_marca, fundo=None, raio_canto=0.0, circulo=False):
    """Um SVG completo de `lado`x`lado` com o simbolo dentro."""
    partes = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{lado}" '
              f'height="{lado}" viewBox="0 0 100 100">']
    if fundo and circulo:
        partes.append(f'<circle cx="50" cy="50" r="50" fill="{fundo}"/>')
    elif fundo:
        partes.append(f'<rect x="0" y="0" width="100" height="100" '
                      f'rx="{raio_canto}" ry="{raio_canto}" fill="{fundo}"/>')
    partes.append(simbolo_svg(escala_marca))
    partes.append('</svg>')
    return "".join(partes)


def png(caminho, lado, escala_marca, fundo=None, raio_canto=0.0, circulo=False):
    svg = svg_documento(lado, escala_marca, fundo, raio_canto, circulo)
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    cairosvg.svg2png(bytestring=svg.encode(), write_to=caminho,
                     output_width=lado, output_height=lado,
                     background_color="transparent")
    return caminho


# --------------------------------------------------------------------------
# 1. O SVG da marca, para o site, a loja e quem pedir o logo
# --------------------------------------------------------------------------
def gerar_svgs():
    fora = os.path.join(RAIZ, "public")
    # Simbolo sozinho, transparente: serve sobre qualquer fundo.
    with open(os.path.join(fora, "cronys-simbolo.svg"), "w") as f:
        f.write(svg_documento(512, 1.0) + "\n")
    # Simbolo sobre navy, cantos arredondados: o "app icon" de referencia.
    with open(os.path.join(fora, "cronys-icone.svg"), "w") as f:
        f.write(svg_documento(512, 0.88, NAVY_FUNDO, raio_canto=22) + "\n")
    print("public/cronys-simbolo.svg, public/cronys-icone.svg")


# --------------------------------------------------------------------------
# 2. Web: favicon, PWA, apple-touch
# --------------------------------------------------------------------------
def gerar_web():
    pub = os.path.join(RAIZ, "public")
    tmp = os.path.join(RAIZ, ".icones-tmp")
    os.makedirs(tmp, exist_ok=True)

    # PWA: cantos arredondados, porque o Android/Chrome mostra a imagem como ela
    # vem quando o purpose e' "any".
    for lado in (192, 512):
        png(os.path.join(pub, f"pwa-{lado}.png"), lado, 0.88,
            NAVY_FUNDO, raio_canto=22)

    # apple-touch-icon: quadrado cheio, sem canto. O iOS recorta por conta e
    # arredondar aqui daria canto duplo.
    png(os.path.join(pub, "apple-touch-icon.png"), 180, 0.88, NAVY_FUNDO)

    # favicon.ico com os tres tamanhos que os navegadores pedem. O de 16 leva a
    # marca um pouco maior: nesse tamanho margem e' desperdicio de pixel.
    quadros = []
    for lado, esc in ((16, 0.98), (32, 0.92), (48, 0.90)):
        p = png(os.path.join(tmp, f"fav{lado}.png"), lado, esc,
                NAVY_FUNDO, raio_canto=(10 if lado >= 32 else 6))
        quadros.append(Image.open(p).convert("RGBA"))
    quadros[-1].save(os.path.join(pub, "favicon.ico"),
                     sizes=[(16, 16), (32, 32), (48, 48)],
                     append_images=quadros[:-1])
    print("public/pwa-192.png, pwa-512.png, apple-touch-icon.png, favicon.ico")


# --------------------------------------------------------------------------
# 3. Android: mipmaps
# --------------------------------------------------------------------------
# ic_launcher / _round: o icone de verdade no Android 7 e anterior.
# ic_launcher_foreground: a camada de frente do icone adaptativo (Android 8+).
#   O canvas dele e' 108dp mas so' os 66dp do meio sao garantidos - o resto o
#   sistema corta para fazer circulo, squircle, gota. Por isso a marca entra a
#   0.82: 74% x 0.82 = 61% = exatamente os 66 de 108.
DENSIDADES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
SEGURO = 66.0 / 108.0 / MARCA_DIAM     # 0.826


def gerar_android():
    res = os.path.join(RAIZ, "android/app/src/main/res")
    for dens, lado in DENSIDADES.items():
        d = os.path.join(res, f"mipmap-{dens}")
        png(os.path.join(d, "ic_launcher.png"), lado, 0.88,
            NAVY_FUNDO, raio_canto=18)
        png(os.path.join(d, "ic_launcher_round.png"), lado, 0.88,
            NAVY_FUNDO, circulo=True)
        # O foreground e' 2.25x o icone legado (108dp contra 48dp de base).
        png(os.path.join(d, "ic_launcher_foreground.png"),
            round(lado * 2.25), SEGURO)
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


def _fonte(tamanho):
    """Fraunces, a mesma do wordmark na tela. Sem ela, o texto nao sai."""
    caminho = os.path.join(RAIZ, ".icones-tmp", "fraunces.ttf")
    if not os.path.exists(caminho):
        return None
    try:
        f = ImageFont.truetype(caminho, tamanho)
        try:
            f.set_variation_by_axes([100.0, tamanho, 600.0])  # SOFT, opsz, wght
        except Exception:
            pass
        return f
    except Exception:
        return None


def gerar_splash():
    res = os.path.join(RAIZ, "android/app/src/main/res")
    tmp = os.path.join(RAIZ, ".icones-tmp")
    for pasta, (w, h) in SPLASHES.items():
        base = Image.new("RGB", (w, h), NAVY_FUNDO)
        menor = min(w, h)
        lado = round(menor * 0.30)
        p = png(os.path.join(tmp, f"splash-mark-{lado}.png"), lado, 1.0)
        marca = Image.open(p).convert("RGBA")

        texto_alt = 0
        fonte = _fonte(round(menor * 0.085))
        if fonte:
            texto_alt = round(menor * 0.085 * 1.5)

        # O bloco (marca + palavra) fica centrado no conjunto, nao a marca
        # sozinha - senao a palavra joga o peso visual para baixo.
        vao = round(menor * 0.06)
        bloco = lado + (vao + texto_alt if fonte else 0)
        y = (h - bloco) // 2
        base.paste(marca, ((w - lado) // 2, y), marca)

        if fonte:
            d = ImageDraw.Draw(base)
            # "Cron" + "y" dourado + "s": o y dourado e' o mesmo detalhe da
            # landing page, e e' o que faz a palavra ser desta marca.
            partes = [("Cron", BRANCO), ("y", GOLD), ("s", BRANCO)]
            larguras = [d.textlength(t, font=fonte) for t, _ in partes]
            x = (w - sum(larguras)) / 2
            ty = y + lado + vao
            for (t, cor), lw in zip(partes, larguras):
                d.text((x, ty), t, font=fonte, fill=cor)
                x += lw

        os.makedirs(os.path.join(res, pasta), exist_ok=True)
        base.save(os.path.join(res, pasta, "splash.png"))
    print(f"android splash ({len(SPLASHES)} arquivos)")


# --------------------------------------------------------------------------
# 5. og-image: o retangulo que WhatsApp, LinkedIn e Google mostram
# --------------------------------------------------------------------------
def gerar_og():
    w, h = 1200, 630
    base = Image.new("RGB", (w, h), NAVY_FUNDO)
    d = ImageDraw.Draw(base)
    # Uma regua dourada embaixo: e' o unico enfeite, e existe para a imagem nao
    # ser um retangulo escuro solto num feed claro.
    d.rectangle([0, h - 10, w, h], fill=GOLD)

    lado = 210
    p = png(os.path.join(RAIZ, ".icones-tmp", f"og-mark-{lado}.png"), lado, 1.0)
    marca = Image.open(p).convert("RGBA")

    fonte = _fonte(112)
    sub = _fonte(38)
    if fonte:
        partes = [("Cron", BRANCO), ("y", GOLD), ("s", BRANCO)]
        larguras = [d.textlength(t, font=fonte) for t, _ in partes]
        texto_w = sum(larguras)
        vao = 40
        total = lado + vao + texto_w
        x0 = (w - total) / 2
        base.paste(marca, (round(x0), (h - lado) // 2 - 30), marca)
        x = x0 + lado + vao
        ty = (h - 112 * 1.35) / 2 - 30
        for (t, cor), lw in zip(partes, larguras):
            d.text((x, ty), t, font=fonte, fill=cor)
            x += lw
        if sub:
            linha = "Agenda, alunos e cobrança para quem dá aula particular"
            lw = d.textlength(linha, font=sub)
            d.text(((w - lw) / 2, h - 150), linha, font=sub, fill="#A9B4C4")
    else:
        base.paste(marca, ((w - lado) // 2, (h - lado) // 2), marca)

    base.save(os.path.join(RAIZ, "public", "og-image.png"))
    print("public/og-image.png")


def baixar_fonte():
    """Fraunces em TTF, so' para o Pillow desenhar texto. Nao vai para o git."""
    tmp = os.path.join(RAIZ, ".icones-tmp")
    os.makedirs(tmp, exist_ok=True)
    destino = os.path.join(tmp, "fraunces.ttf")
    if os.path.exists(destino):
        return
    url = ("https://fonts.gstatic.com/s/fraunces/v38/"
           "6NUh8FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0K7iN7hzFUPJH58"
           "nib1603gg7S2nfgRYIcaRyjDg.ttf")
    try:
        subprocess.run(["curl", "-sSfL", "-o", destino, url], check=True,
                       timeout=60)
    except Exception as e:
        print(f"  aviso: nao baixou a fonte ({e}); splash e og sairao sem texto")


if __name__ == "__main__":
    baixar_fonte()
    gerar_svgs()
    gerar_web()
    gerar_android()
    gerar_splash()
    gerar_og()
    print("\nPronto. Confira antes de commitar: os PNG entram no git.")
