import type { reviewsEn } from "./reviews.en";

/** Machine-drafted; to be reviewed by the ELO 2027 team. */
export const reviewsEs: Record<keyof typeof reviewsEn, string> = {
  navMyReviews: "Mis revisiones",

  myReviewsTitle: "Mis revisiones",
  myReviewsNeedSignIn: "Entra para ver tus revisiones.",
  myReviewsNone:
    "Ahora mismo no tienes nada que revisar. Las propuestas aparecen aquí cuando un congreso para el que revisas está en revisión y su presidencia te ha asignado alguna.",
  myReviewsCommittees: "Revisas para: {committees}",
  myReviewsDue: "Las revisiones se entregan el {date}.",
  myReviewsDueNote: "Puedes enviar y cambiar tus revisiones mientras el congreso esté en revisión.",
  myReviewsClosed:
    "La revisión ha terminado en este congreso. Puedes leer tus revisiones; ya no se pueden cambiar.",
  myReviewsCountSent: "{sent} de {total} enviadas",
  myReviewsCountDraftOne: "1 borrador",
  myReviewsCountDraftMany: "{n} borradores",
  myReviewsCountNotStarted: "{n} sin empezar",
  myReviewsGuidelinesFor: "Pautas para quienes revisan: {committee}",
  myReviewsProposals: "Propuestas que tienes asignadas",
  myReviewsEmpty: "Todavía no tienes ninguna propuesta asignada en este congreso.",
  myReviewsOnlyYours:
    "Solo ves las propuestas que tienes asignadas. No se muestra quién más las revisa.",
  myReviewsLeft:
    "«{title}» ha salido de tu lista. La presidencia puede ver que no puedes revisarla, y puede dársela a otra persona.",
  reviewStatus_not_started: "Sin empezar",
  reviewStatus_draft: "Borrador",
  reviewStatus_sent: "Enviada",

  reviewNamesShown:
    "Este comité ve quiénes son las personas autoras; ellas nunca saben quién revisó su propuesta.",
  reviewFormTitle: "Tu revisión",
  reviewFormIntro:
    "La presidencia lee tu revisión y sabe que es tuya. Las personas autoras reciben tus comentarios para ellas, sin tu nombre y sin las puntuaciones.",
  reviewScoreLead: "Puntúa cada criterio. {min} es lo más bajo, {max} lo más alto.",
  reviewScoreLeadMixed:
    "Puntúa cada criterio. En cada escala, el número más pequeño es la puntuación más baja y el más grande la más alta.",
  reviewScale: "De {min} (lo más bajo) a {max} (lo más alto)",
  reviewScoreTyped: "Un número entero de {min} a {max}",
  reviewComments: "Comentarios para las personas autoras",
  reviewCommentsHelp:
    "Las personas autoras reciben esto con la decisión. Di qué es sólido, qué no queda claro y qué mejoraría la propuesta.",
  reviewChairNote: "Nota solo para la presidencia (opcional)",
  reviewChairNoteHelp: "Las personas autoras nunca ven esto.",
  reviewRecommendation: "Tu recomendación",
  recommendation_accept: "Aceptar",
  recommendation_unsure: "Con dudas",
  recommendation_reject: "Rechazar",
  reviewWords: "{count} palabras",
  reviewWordsBetween: "{count} palabras (entre {min} y {max})",
  reviewWordsMin: "{count} palabras (al menos {min})",
  reviewWordsMax: "{count} palabras (como máximo {max})",
  reviewSend: "Enviar la revisión",
  reviewSaveDraft: "Guardar borrador",
  reviewDraftSaved:
    "Borrador guardado. La presidencia ve tu revisión solo cuando la envías. Puedes cambiarla después de enviarla, mientras el congreso esté en revisión.",
  reviewSent:
    "Tu revisión se envió. La presidencia ya puede leerla. Puedes cambiarla mientras el congreso esté en revisión.",
  reviewChanged: "Se envió tu revisión con los cambios. La presidencia lee ahora esta versión.",
  reviewErrors: "Antes de enviar tu revisión, corrige lo siguiente:",
  reviewErrorsDraft: "El borrador no se pudo guardar tal como está:",
  reviewNothingToSave: "No hay nada nuevo que guardar.",
  reviewStale:
    "Esta revisión se guardó entretanto en otro lugar, en otra pestaña o en otro dispositivo. Lo que escribiste aquí sigue en el formulario: compruébalo y vuelve a guardarla o a enviarla.",
  reviewRestoredMoved:
    "Tus cambios sin guardar se restauraron desde este dispositivo. Después de que los hicieras, esta revisión se guardó en otro lugar, en otra pestaña o en otro dispositivo, y tus cambios sustituirían lo que se guardó allí. Compruébalos y guarda o envía, o descártalos.",
  reviewNotReviewing:
    "No se guardó: el congreso ya no está en revisión, así que las revisiones ya no se pueden cambiar.",
  reviewGone:
    "No se guardó: ya no tienes asignada esta propuesta. Lo que escribiste no se envió a nadie.",
  reviewAlreadySent:
    "No se guardó como borrador: esta revisión ya se había enviado. Vuelve a enviarla para cambiar lo que lee la presidencia.",
  reviewUnconfirmed: "El servidor no lo confirmó. Inténtalo de nuevo.",
  reviewDraftNotice:
    "Esto es un borrador. Solo tú puedes verlo: la presidencia ve tu revisión cuando la envías.",
  reviewSentOn:
    "Tu revisión se envió el {date}. Puedes cambiarla mientras el congreso esté en revisión.",
  reviewSentChangedOn:
    "Tu revisión se envió el {date} y se cambió por última vez el {changed}. Puedes cambiarla mientras el congreso esté en revisión.",
  reviewSentClosed:
    "Tu revisión se envió el {date}. La revisión ha terminado, así que ya no se puede cambiar.",
  reviewDraftClosed:
    "Este borrador no se envió. La revisión ha terminado, así que ya no se puede enviar, y la presidencia no lo ve.",
  reviewNotStartedClosed: "No revisaste esta propuesta. La revisión ha terminado.",
  reviewScoreOf: "{score} de {max}",
  reviewNoScore: "Sin puntuación",
  reviewNoRecommendation: "Ninguna",
  reviewNoComments: "Todavía no hay nada escrito.",
  reviewNoteHeading: "Nota solo para la presidencia",
  reviewNoteNone: "No escribiste ninguna.",
  reviewChange: "Cambiar mi revisión",
  reviewChanging:
    "Estás cambiando una revisión que ya se envió. La presidencia lee la versión enviada hasta que envíes esta.",
  reviewKeepSent: "Dejar la revisión como se envió",
  reviewBackToList: "Volver a mis revisiones",
  reviewCannot: "No puedo revisar esta propuesta",
  reviewCannotAfterSent:
    "Ya enviaste tu revisión de esta propuesta, así que sigue asignada a ti. Si ya no la sostienes, cámbiala, o escribe a la presidencia:",
  issue_not_on_form:
    "El formulario de revisión ya no tiene esto. Recarga la página para ver el formulario tal como está ahora.",

  cannotTitle: "No puedo revisar esta propuesta",
  cannotDoes:
    "La presidencia ve que no puedes revisarla, con tu motivo y tu nota, y puede dar la propuesta a otra persona. No se envía ningún correo. La propuesta sale de tu lista y ya no podrás abrirla.",
  cannotDoesChair:
    "La presidencia ve que no puedes revisarla, con tu motivo y tu nota, y puede dar la propuesta a otra persona. No se envía ningún correo. La propuesta sale de tu lista de revisiones. Podrás seguir abriéndola como parte de la presidencia, salvo que tu motivo sea un conflicto de interés: entonces ya no podrás abrirla.",
  cannotWhy: "¿Por qué?",
  cannotReason_conflict: "Tengo un conflicto de interés, o sé de quién es este trabajo",
  cannotReason_expertise: "Queda fuera de lo que puedo valorar",
  cannotReason_time: "No tengo tiempo",
  cannotConflictNote:
    "Tras un conflicto de interés, la propuesta no se te vuelve a asignar nunca. Tras cualquiera de los otros dos motivos, la presidencia podría asignártela de nuevo más adelante.",
  cannotNote: "Nota para la presidencia (opcional)",
  cannotTell: "Avisar a la presidencia",
  cannotCancel: "Cancelar",
  cannotErrors: "Antes de avisar a la presidencia, corrige lo siguiente:",
  issue_choose_reason: "Elige un motivo.",
  cannotDraftGoes: "El borrador que guardaste para esta propuesta se descarta.",
  cannotNotOffered:
    "Esto ya no es posible: tu revisión de esta propuesta se envió, o el congreso ya no está en revisión.",
  cannotGone: "No tienes asignada esta propuesta.",
};
