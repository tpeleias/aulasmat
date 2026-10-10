import { Suspense } from "react";
import { motion } from "framer-motion";
import { useLocation, useOutlet } from "react-router-dom";

/**
 * A troca de tela (10/10, o Thiago achou o app lento): antes a tela velha
 * saía (0,22 s) e só depois a nova entrava (mais 0,22 s), quase meio segundo
 * por toque no menu. Agora a nova aparece na hora, com um fade curto.
 */
export default function AnimatedOutlet() {
  const location = useLocation();
  const element = useOutlet();

  return (
    <motion.div
      key={location.pathname}
      className="flex min-h-0 flex-1 flex-col"
      initial={{ opacity: 0.6 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
    >
      {/* Cada tela é baixada na primeira visita (App.tsx): o menu fica e só o
          miolo espera. */}
      <Suspense fallback={null}>{element}</Suspense>
    </motion.div>
  );
}
