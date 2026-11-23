import type { emailsEn } from "./emails.en";

/** Machine-drafted; to be reviewed by the ELO 2027 team. */
export const emailsEs: Record<keyof typeof emailsEn, string> = {
  emailsTitle: "Correos sobre la revisión",
  emailsAssigned: "Cuando te asignen propuestas",
  emailsEach: "Un correo por cada una",
  emailsDaily: "Un resumen al día",
  emailsNone: "Ningún correo",
  emailsRemind: "Recordármelo {days} días antes de la entrega de las revisiones",
  emailsRemindOne: "Recordármelo un día antes de la entrega de las revisiones",
  emailsChair: "Como parte de la presidencia: avisos sobre la revisión",
  emailsChairHint:
    "Cuando alguien no puede revisar una propuesta, y cuando una propuesta tiene todas sus revisiones. Un resumen es un correo por cada una de las dos cosas.",
  emailsAlways:
    "Las invitaciones, los correos para entrar y las decisiones sobre tus propias propuestas se envían siempre: sin ellos no podrías participar.",
  emailsSave: "Guardar",
  emailsSaveFor: "Guardar las preferencias de correo para {conference}",
  emailsSaved: "Tus preferencias de correo para {conference} están guardadas.",
  emailsSaveFailed: "No se pudieron guardar tus preferencias. Inténtalo de nuevo.",
  emailsLoadFailed: "No se pudieron cargar tus preferencias de correo. Vuelve a cargar la página.",
};
