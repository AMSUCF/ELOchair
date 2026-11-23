import type { assignmentsEn } from "./assignments.en";

/** Machine-drafted; to be reviewed by the ELO 2027 team. */
export const assignmentsEs: Record<keyof typeof assignmentsEn, string> = {
  manageAssignmentsLink: "Asignaciones",

  reviewersTitle: "Quienes revisan",
  reviewersDoes_before:
    "Quien asignes aquí podrá leer esta propuesta cuando el congreso esté en revisión, {how}.",
  reviewersDoes_now: "Quien asignes aquí podrá leer esta propuesta desde ese momento, {how}.",
  reviewersHow_double: "de forma anónima: sin los nombres de las personas autoras",
  reviewersHow_single: "con los nombres y las instituciones de las personas autoras",
  reviewersHow_open: "con los nombres, las instituciones y las biografías de las personas autoras",
  reviewersMail_before:
    "Se le avisa por correo cuando lo esté, con la frecuencia que haya elegido. No se envía ningún correo cuando quitas a alguien.",
  reviewersMail_now:
    "Se le avisa por correo, con la frecuencia que haya elegido. No se envía ningún correo cuando quitas a alguien.",
  reviewersMail_after: "No se envía ningún correo: el congreso ya no está en revisión.",
  reviewersReviewsIntro:
    "Una revisión aparece aquí cuando quien la escribió la envía, con su nombre. A las personas autoras nunca se les dice quién revisó.",
  reviewersCount: "Personas asignadas para revisarla: {n} de {needed}.",
  reviewersAsksOne: "Comité: {committee}. Pide 1 persona que revise cada propuesta.",
  reviewersAsksMany: "Comité: {committee}. Pide {needed} personas que revisen cada propuesta.",
  reviewersNone: "Nadie tiene asignada esta propuesta.",
  reviewersAssignedOn: "Se le asignó el {date}",
  reviewersRemove: "Quitar de esta propuesta",
  reviewersRemoveFor: "Quitar de esta propuesta: {name}",
  reviewersAskRemove: "¿Quitar a {name} de esta propuesta?",
  reviewersRemoveDoes:
    "{name} ya no podrá leer esta propuesta, y dejará de contar entre las que tiene asignadas. No se le avisa por correo.",
  reviewersRemoveAgain: "Puedes volver a asignársela más adelante.",
  reviewersRemoveDraft: "Si empezó una revisión y no la envió, ese borrador se descarta.",
  reviewersReviewNone: "Todavía no ha enviado ninguna revisión.",
  reviewersReviewSent: "Revisión enviada el {date}.",
  reviewersReviewChanged: "Revisión enviada el {date}; último cambio el {changed}.",
  reviewersKept:
    "No se le puede quitar esta propuesta: su revisión se envió, y una revisión enviada forma parte del expediente de la propuesta.",
  reviewersBlockedSent:
    "Ya no revisa esta propuesta, y no cuenta entre quienes la revisan: ahora forma parte de ella, tiene un conflicto de interés con ella, o ya no revisa en este comité. Su revisión se envió antes, y sigue formando parte del expediente de la propuesta.",
  reviewersRemoveSent:
    "No se quitó: {name} envió su revisión entretanto, y una revisión enviada se queda con la propuesta. La lista se volvió a cargar.",
  reviewersReviewOf: "Revisión de {name}",
  reviewersScore: "{score} de {max}",
  reviewersNoScore: "Sin puntuación",
  reviewersRecommendation: "Recomendación",
  reviewersNoRecommendation: "Ninguna",
  reviewersComments: "Comentarios para las personas autoras",
  reviewersChairNote: "Nota solo para la presidencia",
  reviewersChairNoteNone: "Ninguna.",
  reviewersOtherTitle: "Revisiones de personas que ya no la tienen asignada",
  reviewersOtherIntro:
    "Estas revisiones las enviaron personas que ya no tienen asignada esta propuesta. Siguen formando parte de su expediente.",
  reviewersDeclinedTitle: "Dijeron que no podían revisarla",
  reviewersDeclinedOn: "Lo dijo el {date}.",
  reviewersDeclined_conflict:
    "Un conflicto de interés, o sabe de quién es el trabajo. Esta propuesta no se le volverá a ofrecer.",
  reviewersDeclined_expertise: "Queda fuera de lo que puede valorar.",
  reviewersDeclined_time: "No tiene tiempo.",
  reviewersDeclinedNote: "Su nota para la presidencia:",
  reviewersBlocked:
    "Ya no puede revisar esta propuesta, y no cuenta entre quienes la revisan: ahora forma parte de ella, tiene un conflicto de interés con ella, o ya no revisa en este comité. Quítale la propuesta.",
  reviewersRemoved: "{name} ya no revisa esta propuesta. No se envió ningún correo.",
  reviewersRemoveGone:
    "No se quitó nada: {name} ya no revisaba esta propuesta. La lista se volvió a cargar.",
  reviewersAssignTitle: "Asignar a alguien para revisarla",
  reviewersAssignIntro:
    "Estas son las personas de este comité que pueden revisar esta propuesta. No aparecen quienes forman parte de ella ni quienes tienen un conflicto de interés. De cada una se muestra cuántas propuestas tiene asignadas, junto al máximo que dijo que aceptaría; no se cuentan tus propias propuestas ni aquellas con las que tienes un conflicto.",
  reviewersTakes_call_not_closed:
    "Todavía no se puede asignar a nadie: la convocatoria no ha cerrado. Se podrá asignar cuando pase su fecha de cierre, o cuando el congreso esté en revisión.",
  reviewersTakes_not_under_consideration:
    "Esta propuesta ya no admite nuevas asignaciones: fue retirada, o ya tiene una decisión registrada. Todavía puedes quitar a quien la tiene asignada.",
  reviewersNoCandidates:
    "Nadie de este comité puede revisar esta propuesta. La presidencia invita a quienes revisan en la página Personas.",
  reviewersFind: "Buscar por nombre o dirección de correo",
  reviewersFindNone: "Nadie coincide con lo que escribiste.",
  reviewersLanguages: "Revisa en: {languages}",
  reviewersLoad: "Propuestas asignadas: {n}",
  reviewersLoadOf: "Propuestas asignadas: {n} de {max}",
  reviewersFull: "Ya tiene el número de propuestas que dijo que aceptaría.",
  reviewersAssign: "Asignar",
  reviewersAssignFor: "Asignar esta propuesta a {name}",
  reviewersAskFull: "¿Asignársela a {name} de todos modos?",
  reviewersFullDoes:
    "{name} dijo que aceptaría como máximo {max} propuestas, y tiene {n}. Ese número es lo que ofreció, no un límite: puedes asignársela igualmente.",
  reviewersDoAssign: "Sí, asignar",
  reviewersAssigned: "{name} ya revisa esta propuesta.",
  reviewersNowFull:
    "Aún sin asignar: {name} ya tiene el número de propuestas que dijo que aceptaría. Lee los números y confirma.",
  reviewersNotOffered:
    "Sin asignar: ya no se puede asignar esta propuesta a {name}. La lista se volvió a cargar.",
  reviewersAlready: "{name} ya revisa esta propuesta. La lista se volvió a cargar.",
  reviewersNotTaking:
    "Sin asignar: esta propuesta no admite asignaciones en este momento. La lista se volvió a cargar.",
  reviewersNoAccess:
    "No se cambió nada: solo quien preside el congreso y gestiona esta propuesta puede cambiar quién la revisa.",
  reviewersLoadFailed:
    "No se pudo cargar quién revisa esta propuesta. Recarga la página para intentarlo de nuevo.",

  assignmentsTitle: "Asignaciones",
  assignmentsNoAccess:
    "Solo quienes presiden este congreso pueden ver quién revisa sus propuestas.",
  assignmentsIntro:
    "Todas las propuestas a las que se puede asignar a alguien para revisarlas, bajo el comité que las revisa. Primero aparecen las que aún necesitan a alguien, y después las que aún esperan revisiones. Para asignar o quitar a una persona, o para leer las revisiones enviadas, abre la propuesta. Nada se asigna automáticamente.",
  assignmentsCallOpen:
    "La convocatoria aún no ha cerrado, así que todavía no se puede asignar a nadie. Se muestran las propuestas enviadas hasta ahora.",
  assignmentsExcludedOne: "No aparece 1 propuesta: es tuya, o tienes un conflicto con ella.",
  assignmentsExcludedMany:
    "No aparecen {n} propuestas: son tuyas, o tienes un conflicto con ellas.",
  assignmentsCommittees: "Comités",
  assignmentsProposalsNone: "Ninguna propuesta de este comité admite asignaciones.",
  assignmentsProposalsOne: "1 propuesta.",
  assignmentsProposalsMany: "{n} propuestas.",
  assignmentsShortNone: "A ninguna le falta nadie.",
  assignmentsShortOne: "A 1 aún le falta alguien.",
  assignmentsShortMany: "A {n} aún les falta alguien.",
  assignmentsAsksOne: "Este comité pide 1 persona que revise cada propuesta.",
  assignmentsAsksMany: "Este comité pide {needed} personas que revisen cada propuesta.",
  assignmentsReviewers: "La revisan: {n} de {needed}",
  assignmentsSent: "Revisiones enviadas: {n}",
  assignmentsWaitingOne:
    "1 tiene a quienes la revisan y menos revisiones enviadas de las que pide el comité. Aparece a continuación.",
  assignmentsWaitingMany:
    "{n} tienen a quienes las revisan y menos revisiones enviadas de las que pide el comité. Aparecen a continuación.",
  assignmentsNeedsOne: "Falta 1",
  assignmentsNeedsMany: "Faltan {n}",
  assignmentsComplete: "Completa",
  assignmentsNoReviewer: "Nadie todavía",
};
