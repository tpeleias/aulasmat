import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listStudents from "./tools/list-students";
import listTeachers from "./tools/list-teachers";
import listLessons from "./tools/list-lessons";
import createLesson from "./tools/create-lesson";
import updateLesson from "./tools/update-lesson";
import deleteLesson from "./tools/delete-lesson";
import { getWalletBalance, addWalletCredit } from "./tools/wallet";
import { listBlocks, createBlock, deleteBlock } from "./tools/blocks";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "site-aulas",
  title: "Site - Aulas",
  version: "0.1.0",
  instructions: "Ferramentas do Site - Aulas para consultar e administrar alunos, professores, aulas, cobranças e bloqueios. Peça confirmação antes de criar, alterar ou excluir dados.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    listStudents, listTeachers, listLessons, createLesson, updateLesson, deleteLesson,
    getWalletBalance, addWalletCredit, listBlocks, createBlock, deleteBlock,
  ],
});
