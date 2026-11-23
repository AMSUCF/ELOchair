import type { decisionsEn } from "./decisions.en";

/** Machine-drafted; to be reviewed by the ELO 2027 team. */
export const decisionsEs: Record<keyof typeof decisionsEn, string> = {
  manageDecisionsLink: "Decisiones",

  decisionTitle: "Decisión",
  decisionDoes:
    "Registrar aquí una decisión no avisa a nadie. Las personas autoras se enteran cuando la presidencia envía las decisiones, en la página Decisiones. Hasta entonces puedes cambiarla o retirarla.",
  decisionReviews: "Revisiones enviadas: {sent} de {asked}.",
  decisionReviewsBelow: "Las revisiones están más abajo, en «Quienes revisan».",
  decisionRecs: "Recomendaciones: {list}.",
  decisionRecsNone: "No se dio ninguna recomendación.",
  decisionRec_accept: "{n} aceptar",
  decisionRec_unsure: "{n} con dudas",
  decisionRec_reject: "{n} rechazar",
  decisionChoose: "Decisión para esta propuesta",
  decisionChoice_accepted: "Aceptar",
  decisionChoice_waitlisted: "Poner en lista de espera",
  decisionChoice_rejected: "Rechazar",
  decisionRecord: "Registrar esta decisión",
  decisionChange: "Cambiar la decisión",
  decisionTakeBack: "Retirar la decisión",
  decisionNone: "No hay ninguna decisión registrada para esta propuesta.",
  decisionRecorded: "Registrada y aún sin enviar: {outcome}.",
  decisionOutcome_accepted: "aceptar",
  decisionOutcome_waitlisted: "lista de espera",
  decisionOutcome_rejected: "rechazar",
  decisionSendWhere: "Se envía con las demás, en la página Decisiones.",
  decisionSendLater:
    "Se podrá enviar cuando el congreso esté en la fase «{deciding}», en la página Decisiones.",
  decisionTold: "A las personas autoras se les comunicó el {date}: «{status}».",
  decisionFinal: "Aquí eso es definitivo: no se puede registrar otra decisión para esta propuesta.",
  decisionWaitlistNext:
    "Puedes registrar la decisión que pone fin a la lista de espera, aceptar o rechazar. Se envía igual que la primera.",
  decisionTakes_not_in_review:
    "Todavía no se puede registrar ninguna decisión: el congreso no está en revisión.",
  decisionTakes_not_under_consideration:
    "No se puede registrar ninguna decisión: esta propuesta fue retirada.",
  decisionWillNotBeSent:
    "La decisión que se registró antes para ella no se enviará. Puedes retirarla.",
  decisionChooseFirst: "Elige primero una de las decisiones.",
  decisionSaidRecorded: "Registrada: {outcome}. No se avisó a nadie.",
  decisionSaidTakenBack: "La decisión se retiró. No se avisó a nadie.",
  decisionNotNow:
    "No se registró nada: esta propuesta no admite una decisión en este momento. Aquí se muestra como está ahora.",
  decisionGone:
    "No se retiró nada: ya no había ninguna decisión pendiente de envío para esta propuesta. Aquí se muestra como está ahora.",
  decisionNoAccess:
    "No se cambió nada: solo quien preside el congreso y gestiona esta propuesta puede registrar su decisión.",
  decisionLoadFailed:
    "No se pudo cargar la decisión de esta propuesta. Recarga la página para intentarlo de nuevo.",
  decisionToPage: "Todas las decisiones",

  decisionsTitle: "Decisiones",
  decisionsNoAccess: "Solo quienes presiden este congreso pueden ver sus decisiones.",
  decisionsIntro:
    "Todas las propuestas que aún esperan una decisión, bajo el comité que las revisa. Primero aparecen las que aún no tienen ninguna. Para registrar una decisión, abre la propuesta: sus revisiones están en la misma página. Registrarla no avisa a nadie. Una propuesta a la que ya se comunicó «aceptada» o «no aceptada» deja de aparecer aquí: la encuentras en «Gestionar envíos», por su estado.",
  decisionsNotYet:
    "Todavía no se puede registrar ninguna decisión: el congreso no está en revisión.",
  decisionsExcludedOne: "No aparece 1 propuesta: es tuya, o tienes un conflicto con ella.",
  decisionsExcludedMany: "No aparecen {n} propuestas: son tuyas, o tienes un conflicto con ellas.",
  decisionsProposalsNone: "Ninguna propuesta de este comité espera una decisión.",
  decisionsProposalsOne: "1 propuesta espera una decisión.",
  decisionsProposalsMany: "{n} propuestas esperan una decisión.",
  decisionsUndecidedNone: "Ninguna está sin decisión.",
  decisionsUndecidedOne: "1 aún no tiene decisión.",
  decisionsUndecidedMany: "{n} aún no tienen decisión.",
  decisionsNoneYet: "Sin decisión todavía",
  decisionsRecorded: "Registrada: {outcome}",
  decisionsNotSent: "Aún sin enviar.",
  decisionsWaitlisted: "En lista de espera",
  decisionsWaitlistedTold: "Ya se comunicó a las personas autoras.",
  decisionsReviews: "Revisiones enviadas: {sent} de {asked}",
  decisionsNoReviews: "No se envió ninguna revisión.",

  sendTitle: "Enviar las decisiones",
  sendDoes:
    "Enviarlas avisa a las personas autoras. Sale cada decisión registrada y aún sin enviar, de todo el congreso: la propuesta recibe su nuevo estado, y quien la creó y quienes confirmaron su coautoría reciben un correo con el resultado y los comentarios que quienes revisaron escribieron para las personas autoras.",
  sendWaiting:
    "Pendientes de envío: {accepted} aceptadas, {waitlisted} para la lista de espera, {rejected} no aceptadas.",
  sendNothing: "No hay ninguna decisión pendiente de envío.",
  sendNotYet:
    "Todavía no se pueden enviar las decisiones: el congreso está en la fase «{phase}». Se podrán enviar cuando esté en «{deciding}», cuando las revisiones ya no se puedan cambiar.",
  sendOpen: "Enviar las decisiones",
  sendAsk: "¿Enviar estas decisiones?",
  sendWill_accepted: "Propuestas a las que se comunicará «aceptada»: {n}",
  sendWill_waitlisted: "Propuestas a las que se comunicará «en lista de espera»: {n}",
  sendWill_rejected: "Propuestas a las que se comunicará «no aceptada»: {n}",
  sendWill_people: "Personas que recibirán un correo: {n}",
  sendWill_undecided: "Propuestas aún sin decisión, a las que no se comunicará nada: {n}",
  sendWill_dropped:
    "Decisiones que no se enviarán, porque la propuesta fue retirada o volvió a borrador: {n}",
  sendCounts:
    "Estos números cuentan todas las decisiones registradas en el congreso, también las de propuestas que no se te muestran porque son tuyas o tienes un conflicto con ellas.",
  sendFinal:
    "Un «aceptada» o un «no aceptada» ya enviado es definitivo: después no se puede cambiar aquí. A una propuesta en lista de espera se le puede dar más adelante una nueva decisión.",
  sendPreviews:
    "Estos son los correos, con un título y unos comentarios inventados. Cada persona recibe el suyo en su idioma; este es el texto en {language}.",
  sendPreview_accepted: "El correo para «aceptada»",
  sendPreview_waitlisted: "El correo para «en lista de espera»",
  sendPreview_rejected: "El correo para «no aceptada»",
  sendDo: "Sí, enviarlas",
  sendDone:
    "Las decisiones se enviaron. Aceptadas: {accepted}. En lista de espera: {waitlisted}. No aceptadas: {rejected}. Personas a las que se escribió: {people}.",
  sendDoneDropped: "No enviadas, porque la propuesta fue retirada o volvió a borrador: {n}.",
  sendStale:
    "No se envió nada: lo que está pendiente ya no es lo que mostraba esta confirmación. Ahora muestra lo que está pendiente. Léela de nuevo y envía.",
  sendStaleNothing:
    "Ahora no se envió nada: ya no hay ninguna decisión pendiente de envío. La página muestra lo que hay ahora.",
  sendNotDeciding:
    "No se envió nada: el congreso no está en una fase en la que se envían decisiones. La página lo muestra como está ahora.",
  sendNoAccess:
    "No se envió nada: solo quienes presiden este congreso pueden enviar sus decisiones.",
  sendUnconfirmed:
    "El servidor no confirmó que las decisiones se enviaran. Recarga la página para ver qué sigue pendiente antes de intentarlo de nuevo.",

  authorDecisionTitle: "Decisión",
  authorDecision_accepted: "Esta propuesta ha sido aceptada.",
  authorDecision_waitlisted:
    "Esta propuesta está en lista de espera. Por ahora no está aceptada, y todavía puede estarlo: recibirás un correo cuando la presidencia decida.",
  authorDecision_rejected: "Esta propuesta no ha sido aceptada.",
  authorDecisionSent: "La presidencia envió esta decisión el {date}.",
  authorCommentsTitle: "Comentarios de quienes revisaron la propuesta",
  authorCommentsIntro:
    "Quienes revisaron la propuesta escribieron estos comentarios para las personas autoras. No se dice quiénes son.",
  editDecided: "Se envió una decisión sobre esta propuesta: ya no se puede editar.",
};
