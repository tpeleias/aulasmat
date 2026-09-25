// WhatsApp "de um toque": o app monta a mensagem e abre o WhatsApp do próprio
// celular com ela pronta; quem envia é a pessoa. Não passa por servidor nem
// custa nada - é o que o Pro e o Max têm (plan_features.whatsapp_link).

import { format } from "date-fns";
import { Capacitor } from "@capacitor/core";
import { ptBR } from "date-fns/locale";
import type { Vocabulary } from "@/lib/vocabulary";
import { cap } from "@/lib/vocabulary";
import { fillTemplate, templateFor, type MessageTemplates } from "@/lib/messageTemplates";

/**
 * Número como o banco guarda (students.whatsapp): só dígitos, com o 55.
 * Aceita o que a pessoa digita - "(11) 98765-4321", "+55 11 98765 4321".
 * Devolve null para vazio e "invalido" para o que não parece telefone.
 */
export function normalizeWhatsApp(input: string | null | undefined): string | null | "invalido" {
  const d = String(input ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (!d) return null;
  // DDD + número (10 ou 11 dígitos): é do Brasil, falta o 55.
  const full = d.length === 10 || d.length === 11 ? `55${d}` : d;
  return full.length >= 12 && full.length <= 15 ? full : "invalido";
}

/** Link que abre o WhatsApp com a mensagem. Sem número, a pessoa escolhe o contato. */
export function whatsAppLink(phone: string | null | undefined, text: string): string {
  const n = String(phone ?? "").replace(/\D/g, "");
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

type LessonInfo = {
  student_name: string;
  guardian_name?: string | null;
  start_at: string | Date;
  address?: string | null;
  is_online?: boolean;
};

const firstName = (s: string | null | undefined) => String(s ?? "").trim().split(/\s+/)[0] ?? "";

/** Os campos que os modelos de mensagem usam ({nome}, {dia}...). */
export function lessonVars(l: LessonInfo, w: Vocabulary): Record<string, string> {
  const d = new Date(l.start_at);
  const who = cap(firstName(l.guardian_name) || firstName(l.student_name));
  const aluno = cap(firstName(l.student_name));
  const toGuardian = !!l.guardian_name?.trim() && l.guardian_name.trim().toLowerCase() !== l.student_name.trim().toLowerCase();
  const address = l.address?.trim() ?? "";
  return {
    saudacao: who ? `Olá, ${who}!` : "Olá!",
    nome: who,
    aluno,
    de_aluno: toGuardian ? ` de ${aluno}` : "",
    responsavel: cap(firstName(l.guardian_name)),
    dia: format(d, "EEEE, dd/MM", { locale: ptBR }),
    hora: format(d, "HH:mm"),
    endereco: l.is_online ? "on-line" : address,
    local: l.is_online ? ` (${w.appointment.s.toLowerCase()} on-line)` : address ? ` em ${address}` : "",
  };
}

/** Lembrete do atendimento. */
export function reminderMessage(l: LessonInfo, w: Vocabulary, t?: MessageTemplates | null): string {
  return fillTemplate(templateFor("lembrete", w, t), lessonVars(l, w));
}

/** Aviso logo depois de marcar. */
export function confirmMessage(l: LessonInfo, w: Vocabulary, t?: MessageTemplates | null): string {
  return fillTemplate(templateFor("confirmacao", w, t), lessonVars(l, w));
}

/** "Estou a caminho" com a localização de agora (só no Max). */
export function onMyWayMessage(l: LessonInfo, w: Vocabulary, pos: { lat: number; lng: number } | null, t?: MessageTemplates | null): string {
  const map = pos ? `https://maps.google.com/?q=${pos.lat.toFixed(5)},${pos.lng.toFixed(5)}` : "";
  return fillTemplate(templateFor("a_caminho", w, t), {
    ...lessonVars(l, w),
    mapa: map,
    localizacao: map ? ` Minha localização agora: ${map}` : "",
  });
}

/** A posição de agora, uma vez só, com o app aberto. Pede permissão na primeira vez. */
export function currentPosition(timeoutMs = 15000): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Este aparelho não informa a localização."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      e => reject(new Error(e.code === 1
        ? "Sem permissão de localização. Libere nas configurações do celular para o Cronys."
        : "Não foi possível pegar a localização agora.")),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}

/**
 * Abre um link fora do app (WhatsApp, Waze). No Android o próprio app entrega
 * o link ao sistema, mesmo depois de esperar o GPS. No navegador, abrir aba
 * depois de uma espera pode ser bloqueado: devolve false para a tela oferecer
 * um botão.
 */
export function openExternal(url: string): boolean {
  if (Capacitor.isNativePlatform()) {
    window.location.href = url;
    return true;
  }
  return window.open(url, "_blank", "noopener,noreferrer") !== null;
}

/** Waze com a rota até o endereço. */
export function wazeLink(address: string): string {
  return `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;
}
