/** A tela de quando um erro derruba o app inteiro (o Sentry já recebeu o erro). */
export function CrashScreen() {
  const en = typeof navigator !== "undefined" && !navigator.language?.toLowerCase().startsWith("pt");
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24, fontFamily: "system-ui, sans-serif", textAlign: "center" }}>
      <p style={{ fontSize: 18, fontWeight: 600 }}>{en ? "Something went wrong." : "Algo deu errado."}</p>
      <p style={{ color: "#666", maxWidth: 360 }}>{en ? "We were notified. Reload the page to continue." : "Já fomos avisados. Recarregue a página para continuar."}</p>
      <button type="button" onClick={() => window.location.reload()}
        style={{ padding: "10px 20px", borderRadius: 12, border: "none", background: "#1f1f1f", color: "#fff", fontWeight: 600, cursor: "pointer" }}>
        {en ? "Reload" : "Recarregar"}
      </button>
    </div>
  );
}
