import type { peopleEn } from "./people.en";

/** Machine-drafted; to be reviewed by the ELO 2027 team. */
export const peopleEs: Record<keyof typeof peopleEn, string> = {
  managePeopleLink: "Personas",
  peopleTitle: "Personas",
  peopleNoAccess:
    "Solo quienes presiden este congreso pueden ver y cambiar quién tiene un rol en él.",
  peopleIntro:
    "Esta página muestra quién tiene un rol en este congreso y las invitaciones que nadie ha aceptado. Una persona recibe un rol al aceptar una invitación enviada desde aquí. Puedes volver a quitar un rol.",
  peopleNoName: "Aún sin nombre",
  peopleYou: "Tú",
  peopleInviteTitle: "Invitar a alguien",
  peopleInviteIntro:
    "La persona recibe un correo con un enlace. Nada cambia hasta que abre el enlace y acepta: entonces la dirección que escribiste recibe el rol, sea quien sea quien abrió el enlace. El enlace funciona durante {days} días. Se invita una dirección cada vez.",
  peopleInviteEmail: "Dirección de correo",
  peopleInviteName: "Nombre (opcional)",
  peopleInviteNameHint:
    "Solo quienes presiden ven este nombre, en esta página. No se pone en el correo, y la persona da su propio nombre al aceptar.",
  peopleInviteRole: "Rol",
  peopleInviteRole_reviewer: "Revisión",
  peopleInviteRoleDoes_reviewer:
    "Ve solo las propuestas que la presidencia le asigna, y escribe una revisión de cada una.",
  peopleInviteRole_chair: "Presidencia",
  peopleInviteRoleDoes_chair:
    "Puede hacer todo lo que tú puedes: ver todas las propuestas y a todas las personas que figuran en ellas, cambiar la configuración del congreso, invitar y quitar personas, y pasar el congreso de una fase a la siguiente.",
  peopleInvitePools: "Grupos de revisión",
  peopleInvitePoolsHint:
    "Elige al menos uno. A esta persona se le podrán asignar propuestas de los formatos que revisan estos grupos.",
  peopleInviteLang: "Idioma del correo",
  peopleInviteSend: "Enviar la invitación",
  peopleInviteLimits:
    "Puedes enviar {perInviter} invitaciones al día, y a una misma dirección se le pueden enviar {perRecipient} al día.",
  peopleEmailInvalid: "Escribe una sola dirección de correo válida.",
  peopleNameInvalid:
    "Usa una sola línea de letras o números, como máximo {max} caracteres, sin caracteres de formato ocultos.",
  peoplePoolsRequired: "Elige al menos un grupo de revisión.",
  peopleInvited: "La invitación se envió a {email}.",
  peopleAlreadyInvited:
    "Ya hay una invitación pendiente a esta dirección para este rol. Puedes volver a enviarla desde la lista de invitaciones.",
  peopleAlreadyHasRole: "Esta dirección ya tiene ese rol en este congreso.",
  peopleInviteLimited:
    "No se envió: hoy han salido demasiadas invitaciones. Puedes enviar {perInviter} al día, y a una misma dirección se le pueden enviar {perRecipient} al día. Inténtalo mañana.",
  peopleChairsTitle: "Presidencia",
  peopleChairsIntro:
    "Quienes presiden dirigen el congreso: ven todas las propuestas, cambian la configuración y gestionan esta página. No puedes quitarte tu propio rol, para que el congreso siempre tenga quien lo presida.",
  peopleReviewersTitle: "Quienes revisan",
  peopleReviewersIntro:
    "Quienes revisan aparecen en cada grupo de revisión al que pertenecen, con el número de propuestas que tienen asignadas. No se cuentan tus propias propuestas ni aquellas con las que tienes un conflicto.",
  peoplePoolEmpty: "Todavía nadie revisa en este grupo.",
  peoplePoolGone: "Sin un grupo de revisión actual",
  peopleAssignedNone: "Ninguna propuesta asignada",
  peopleAssignedOne: "1 propuesta asignada",
  peopleAssignedMany: "{n} propuestas asignadas",
  peopleOffers: "Acepta hasta {max}. Revisa en: {languages}.",
  peopleTrackChairsTitle: "Coordinación de eje",
  peopleTrackChairsIntro:
    "La coordinación de eje no forma parte de esta versión de la aplicación. Estas personas recibieron el rol antes. Puedes quitarlo; no se puede invitar a nadie a él.",
  peopleTracks: "Ejes: {tracks}",
  peopleAllTracks: "Todos los ejes",
  peopleInvitationsTitle: "Invitaciones",
  peopleInvitationsIntro:
    "Invitaciones que esperan respuesta, que se rechazaron o que caducaron. Cada una se muestra como la escribiste. No se envía ningún correo cuando alguien responde: lo ves en esta lista. «Volver a enviar» envía un correo nuevo con un enlace nuevo, y el enlace del correo anterior deja de funcionar.",
  peopleInvitationsNone: "No hay ninguna invitación pendiente, rechazada o caducada.",
  peopleInvitationRole_reviewer: "Invitación para revisar: {pools}",
  peopleInvitationRole_chair: "Invitación para presidir",
  peopleInvState_waiting: "Esperando respuesta",
  peopleInvState_declined: "Rechazada",
  peopleInvState_expired: "Caducada",
  peopleInvSent: "Enviada el {date}",
  peopleInvExpires: "El enlace funciona hasta el {date}",
  peopleInvDeclined: "Rechazada el {date}",
  peopleInvExpired: "El enlace dejó de funcionar el {date}",
  peopleResend: "Volver a enviar",
  peopleResendFor: "Volver a enviar la invitación a {email}",
  peopleCancel: "Cancelar la invitación",
  peopleCancelFor: "Cancelar la invitación a {email}",
  peopleDismiss: "Quitar de esta lista",
  peopleDismissFor: "Quitar de esta lista la invitación a {email}",
  peopleResent: "Se envió un correo nuevo a {email}. El enlace del correo anterior ya no funciona.",
  peopleResendLimited:
    "No se envió. Una invitación se puede volver a enviar una vez por hora, y se aplican los límites diarios: {perInviter} tuyas, {perRecipient} a una misma dirección.",
  peoplePoolsGone:
    "No se envió: los grupos de revisión de esta invitación ya no forman parte del congreso, así que su enlace no da nada. Cancélala y vuelve a invitar a la persona.",
  peopleInvitationChanged:
    "No se hizo nada: esta invitación había cambiado entretanto. La lista se volvió a cargar.",
  peopleAskCancel: "¿Cancelar la invitación a {email}?",
  peopleCancelDoes:
    "El enlace del correo deja de funcionar y la invitación sale de esta lista. No se avisa a nadie.",
  peopleDoCancel: "Sí, cancelarla",
  peopleAskDismiss: "¿Quitar de esta lista la invitación a {email}?",
  peopleDismissDoes:
    "No cambia nada más y no se avisa a nadie. Puedes volver a invitar a esta dirección.",
  peopleDoDismiss: "Sí, quitarla",
  peopleGoBack: "No, volver",
  peopleCancelled: "Se canceló la invitación a {email}. Su enlace ya no funciona.",
  peopleDismissed: "La invitación a {email} se quitó de la lista.",
  peopleRemove: "Quitar",
  peopleRemoveFor_chair: "Quitar a {name} de la presidencia",
  peopleRemoveFor_reviewer: "Quitar a {name} de la revisión",
  peopleRemoveFor_track_chair: "Quitar a {name} de la coordinación de eje",
  peopleAskRemove_chair: "¿Quitar a {name} de la presidencia?",
  peopleAskRemove_reviewer: "¿Quitar a {name} de la revisión?",
  peopleAskRemove_track_chair: "¿Quitar a {name} de la coordinación de eje?",
  peopleRemoveDoes_chair:
    "{name} ya no podrá ver las propuestas desde la presidencia, cambiar la configuración, invitar o quitar personas ni cambiar la fase del congreso. No se le avisa por correo. Las invitaciones que envió siguen como están: puedes cancelar cualquiera en la lista de abajo. Para que vuelva a presidir, envíale una nueva invitación.",
  peopleRemoveDoes_reviewer:
    "{name} dejará de revisar en este congreso, en todos los grupos de revisión, y ya no verá las propuestas que tenía asignadas. No se le avisa por correo. Para que vuelva a revisar, envíale una nueva invitación.",
  peopleRemoveDoes_track_chair:
    "{name} dejará de gestionar las propuestas de sus ejes. No se le avisa por correo. En esta versión de la aplicación no se puede invitar a nadie a este rol.",
  peopleRemoveAssignedNone: "No tiene asignada ninguna de las propuestas que gestionas.",
  peopleRemoveAssignedOne:
    "Tiene asignada 1 propuesta de las que gestionas, que perderá a esta persona como revisora.",
  peopleRemoveAssignedMany:
    "Tiene asignadas {n} propuestas de las que gestionas, que perderán a esta persona como revisora.",
  peopleDoRemove: "Sí, quitar",
  peopleRemoved_chair: "{name} ya no preside este congreso.",
  peopleRemoved_reviewer: "{name} ya no revisa en este congreso.",
  peopleRemoved_track_chair: "{name} ya no coordina ningún eje de este congreso.",
  peopleRemoveStale:
    "No se quitó nada: ha cambiado el número de propuestas asignadas a esta persona. Lee el número nuevo y confirma otra vez.",
  peopleRemoveGone:
    "No se quitó nada: esta persona ya no tiene ese rol. La lista se volvió a cargar.",
  peopleUnconfirmed: "El servidor no lo confirmó. Inténtalo de nuevo.",
  roleInvTitle: "Invitación a un rol",
  roleInvIntro_reviewer: "Quienes presiden {conference} te invitan a revisar propuestas.",
  roleInvIntro_chair: "Quienes presiden {conference} te invitan a sumarte a la presidencia.",
  roleInvConference: "Congreso",
  roleInvRole: "Rol",
  roleInvCommittees: "Comités",
  roleInvFor: "Invitación para",
  roleInvMeans_reviewer:
    "Si aceptas: la presidencia te asignará propuestas; las lees y escribes una breve revisión de cada una.",
  roleInvMeans_chair:
    "Si aceptas: podrás ver todas las propuestas y a todas las personas que figuran en ellas, cambiar la configuración del congreso, invitar a personas y pasar el congreso de una fase a la siguiente.",
  roleInvBound:
    "Esta invitación es para {email}. Si aceptas, esa dirección recibe el rol, sea quien sea quien abra este enlace. Aceptar no inicia sesión.",
  roleInvExpires: "Puedes responder hasta el {date}.",
  roleInvLanguages: "Idiomas en los que puedes revisar",
  roleInvLanguagesHint: "Elige al menos uno.",
  roleInvLanguagesRequired: "Elige al menos un idioma para aceptar.",
  roleInvLoad: "El máximo de propuestas que quieres revisar",
  roleInvLoadHint:
    "Un número entero de {min} a {max}. La presidencia lo ve cuando asigna propuestas.",
  roleInvLoadInvalid: "Escribe un número entero de {min} a {max}.",
  roleInvYourName: "Tu nombre",
  roleInvNameHelp: "Tu propio nombre, tal como lo verá la presidencia.",
  roleInvNameRequired: "Escribe tu nombre para aceptar.",
  roleInvAccept: "Aceptar",
  roleInvDecline: "Rechazar",
  roleInvDeclineNote:
    "Rechazar no requiere nada más. La presidencia verá que rechazaste; no se envía ningún correo.",
  roleInvAccepted_reviewer:
    "Gracias: {email} ya revisa para {conference}. Puedes entrar con esa dirección cuando quieras.",
  roleInvAccepted_chair:
    "Gracias: {email} ya preside {conference}. Entra con esa dirección para gestionar el congreso.",
  roleInvDeclined: "Has rechazado. No se dio ningún rol, y la presidencia verá tu respuesta.",
  roleInvInvalid:
    "Este enlace de invitación ya no funciona: caducó, ya se respondió o se canceló. Si te enviaron un correo más reciente, usa el enlace de ese correo. Si no, pide a quienes presiden el congreso que te inviten de nuevo.",
  roleInvSignIn: "Entrar como {email}",
};
