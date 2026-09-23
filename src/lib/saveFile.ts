import { Capacitor } from "@capacitor/core";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// No site, baixa o arquivo. No app Android isso não existe: o WebView ignora
// tanto o <a download> quanto o window.print(). Lá o arquivo vai para o cache
// do app e abre o menu de compartilhar - de onde dá para salvar, imprimir ou
// mandar direto pelo WhatsApp. O cache é o que file_paths.xml já libera para
// o FileProvider.
export async function saveOrShareFile(name: string, data: Blob, title = name): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);
  const { uri } = await Filesystem.writeFile({ path: name, data: await blobToBase64(data), directory: Directory.Cache });
  try {
    await Share.share({ title, files: [uri], dialogTitle: title });
  } catch (e) {
    // Fechar o menu sem escolher nada não é erro.
    if (!/cancel/i.test(String((e as Error)?.message ?? e))) throw e;
  }
}

export const canOnlyShare = () => Capacitor.isNativePlatform();
