import type { settingsEn } from "./settings.en";

/** Machine-drafted; to be reviewed by the ELO 2027 team. */
export const settingsEs: Record<keyof typeof settingsEn, string> = {
  manageSettingsLink: "Configuración del congreso",
  settingsTitle: "Configuración del congreso",
  settingsNoAccess: "Solo quienes presiden este congreso pueden cambiar su configuración.",
  settingsIntro:
    "Cambia aquí los datos, las fechas, los límites y los textos del congreso, cómo se revisan las propuestas, la redacción de los correos que envía la aplicación y los acuerdos que aceptan las personas. Revisas cada cambio antes de guardarlo, y cada guardado queda registrado.",
  settingsScopeNote:
    "Los formatos, los campos, los idiomas, los grupos de revisión, los criterios y los acuerdos se añaden o se quitan importando una configuración en el servidor, no aquí.",
  settingsBackToManage: "Volver a los envíos",
  settingsSectionConference: "El congreso",
  settingsSectionDeadlines: "Plazos",
  settingsSectionRules: "Reglas",
  settingsSectionFormats: "Formatos",
  settingsSectionReview: "Revisión",
  settingsSectionEmails: "Correos",
  settingsSectionAgreements: "Acuerdos",
  settingsSectionOther: "Formatos que no se envían aquí",
  settingsSectionWays: "Formas de participar",
  settingsWaysIntro:
    "La página de inicio y la página del congreso las muestran bajo «Formas de participar», cada una con un enlace a sus formatos. Para añadir o quitar una, o pasar un formato a otra, hay que importar una configuración.",
  settingsWayFormats: "Lleva a estos formatos: {formats}.",
  settingsSectionTracks: "Líneas temáticas",
  settingsSectionTopics: "Temas",
  settingsField: "Campo: {name}",
  settingsPoolFormats: "Este grupo revisa estos formatos: {formats}.",
  settingsPoolNoFormats: "Este grupo no revisa ningún formato.",
  settingsPoolOwnMode_double:
    "La revisión de {format} es siempre anónima, se elija lo que se elija abajo.",
  settingsPoolOwnMode_single:
    "En {format}, quienes revisan ven siempre los nombres y las instituciones de las personas autoras, se elija lo que se elija abajo.",
  settingsPoolOwnMode_open:
    "En {format}, quienes revisan ven siempre los nombres, las instituciones y las biografías de las personas autoras, se elija lo que se elija abajo.",
  settingsCriterion: "Criterio: {name}",
  settingsLabel_title: "Título",
  settingsLabel_theme: "Tema",
  settingsLabel_distinction: "Lo que distingue a esta edición",
  settingsLabel_invitation: "Invitación",
  settingsDistinctionHint:
    "Opcional. Una línea que se muestra junto a las fechas y el lugar, en la página de inicio y al comienzo de la página del congreso.",
  settingsInvitationHint:
    "Opcional. Un párrafo breve que dice qué trabajos acoge la convocatoria. La página de inicio y la página del congreso empiezan con él, en el idioma de quien lee si lo has escrito en él y, si no, en el idioma principal del congreso.",
  settingsLabel_host: "Institución anfitriona",
  settingsLabel_location: "Lugar",
  settingsLabel_modality: "Cómo se participa",
  settingsLabel_contactEmail: "Correo de contacto",
  settingsLabel_website: "Sitio web del congreso",
  settingsLabel_dates_start: "Primer día del congreso",
  settingsLabel_dates_end: "Último día del congreso",
  settingsLabel_placeholder: "Indicar en la página del congreso que es provisional",
  settingsLabel_rules_presenterCap_max: "Máximo de roles principales y de presentación por persona",
  settingsLabel_rules_bio_maxWords: "Máximo de palabras de una biografía",
  settingsLabel_type_name: "Nombre",
  settingsLabel_type_description: "Descripción",
  settingsLabel_type_abstract_label: "Cómo se llama el resumen",
  settingsLabel_type_abstract_minWords: "Mínimo de palabras del resumen",
  settingsLabel_type_abstract_maxWords: "Máximo de palabras del resumen",
  settingsLabel_type_durationMinutes: "Minutos en el programa",
  settingsLabel_type_team_min: "Mínimo de personas",
  settingsLabel_type_team_max: "Máximo de personas",
  settingsLabel_field_label: "Etiqueta",
  settingsLabel_field_help: "Texto de ayuda",
  settingsLabel_field_required: "Este campo es obligatorio",
  settingsLabel_field_maxWords: "Máximo de palabras",
  settingsLabel_field_min: "Número más pequeño",
  settingsLabel_field_max: "Número más grande",
  settingsLabel_field_integer: "Solo números enteros",
  settingsLabel_pool_name: "Nombre",
  settingsLabel_pool_blindMode: "Cómo ven quienes revisan a las personas autoras",
  settingsLabel_pool_reviewsPerSubmission: "Revisiones por propuesta",
  settingsLabel_pool_guidelines: "Pautas para quienes revisan",
  settingsLabel_criterion_label: "Etiqueta",
  settingsLabel_criterion_description: "Descripción",
  settingsCriterionDescriptionHint:
    "Opcional. Qué pregunta este criterio, o qué significan su puntuación más baja y la más alta. Quienes revisan lo leen debajo del nombre del criterio en el formulario de revisión.",
  settingsFormTitle: "El formulario de revisión",
  settingsFormIntro:
    "Debajo de las puntuaciones, el formulario de revisión de este comité tiene comentarios para las personas autoras, una nota solo para la presidencia y una recomendación general. Sus nombres son los de la aplicación. Lo que se escribe debajo de cada uno, los límites de los comentarios, y si el formulario tiene la nota y la recomendación, los decides tú.",
  settingsLabel_form_comments_description:
    "Comentarios para las personas autoras: lo que se escribe debajo del campo",
  settingsLabel_form_comments_minWords: "Comentarios para las personas autoras: mínimo de palabras",
  settingsLabel_form_comments_maxWords: "Comentarios para las personas autoras: máximo de palabras",
  settingsLabel_form_chairNote_enabled: "El formulario tiene una nota solo para la presidencia",
  settingsLabel_form_chairNote_description:
    "Nota solo para la presidencia: lo que se escribe debajo del campo",
  settingsLabel_form_recommendation_enabled:
    "El formulario pide una recomendación general: aceptar, con dudas o rechazar",
  settingsLabel_form_recommendation_description:
    "Recomendación: lo que se escribe debajo de su nombre",
  settingsFormDescriptionHint:
    "Opcional. Si lo dejas vacío, quienes revisan leen la frase estándar: «{standard}»",
  settingsFormDescriptionHintNone: "Opcional. Si lo dejas vacío, ahí no se escribe nada.",
  settingsReviewsDueHint:
    "Opcional. Quienes revisan ven este día en su lista. No bloquea nada: las revisiones se pueden enviar y cambiar mientras el congreso esté en revisión. Para no fijar ningún día, deja la fecha vacía.",
  settingsDeadlineNone: "No hay ningún día fijado.",
  settingsLabel_criterion_min: "Puntuación más baja",
  settingsLabel_criterion_max: "Puntuación más alta",
  settingsBlind_double:
    "Anónima: quienes revisan no ven quiénes son las personas autoras, ni las respuestas marcadas como identificativas (por ejemplo, un enlace a la obra)",
  settingsBlind_single:
    "Quienes revisan ven los nombres y las instituciones de las personas autoras",
  settingsBlind_open:
    "Quienes revisan ven los nombres, las instituciones y las biografías de las personas autoras",
  settingsBlindHint:
    "Una revisión anónima sigue siendo anónima una vez que se ha asignado a alguien para revisar, aunque después se le quite: a partir de entonces ya no se puede cambiar para mostrar a las personas autoras.",
  settingsGuidelinesHint:
    "Opcional. Quienes revisan en este grupo ven este texto encima de cada propuesta que se les asigna, en su idioma si lo has escrito en él y, si no, en el idioma principal del congreso. Los saltos de línea se conservan.",
  settingsEmailsIntro:
    "La aplicación envía estos correos a las personas de una propuesta, y a las personas a quienes la presidencia invita a revisar o a presidir. Puedes cambiar su redacción en inglés, español y portugués. Cada cuadro muestra el texto que se envía: el texto estándar, hasta que lo cambies.",
  settingsEmailsNote:
    "Están los tres idiomas, tenga el congreso los que tenga, porque cada persona recibe el correo en su idioma: se puede invitar a alguien en portugués a un congreso que se celebra en inglés y español. Un idioma que no hayas cambiado conserva el texto estándar. Estos textos no son privados: como el resto de esta configuración, puede leerlos cualquiera que pueda ver el congreso. El correo para entrar es igual para todo el mundo y no se puede cambiar aquí.",
  settingsEmail_invitation: "Invitación a una propuesta",
  settingsEmail_submission_received: "Acuse de recibo de una propuesta enviada",
  settingsEmail_submission_withdrawn: "Aviso de que se retiró una propuesta",
  settingsEmail_invitation_withdrawn:
    "Aviso a quienes tenían una invitación a una propuesta retirada",
  settingsEmail_invitation_answered: "Respuesta a una invitación, para quien creó la propuesta",
  settingsEmail_draft_deleted: "Aviso a quienes tenían una invitación a un borrador eliminado",
  settingsEmail_reviewer_invitation: "Invitación para revisar",
  settingsEmail_chair_invitation: "Invitación para presidir",
  settingsEmailWhen_invitation:
    "Se envía a una persona cuando quien creó una propuesta la incluye en ella, y otra vez si le vuelve a enviar la invitación. Esa persona todavía no ha aceptado nada.",
  settingsEmailWhen_submission_received:
    "Se envía a quien creó la propuesta y a cada persona confirmada en ella cuando la propuesta se envía.",
  settingsEmailWhen_submission_withdrawn:
    "Se envía a quien creó la propuesta, a cada persona confirmada en ella y al correo de contacto del congreso cuando se retira una propuesta enviada.",
  settingsEmailWhen_invitation_withdrawn:
    "Se envía a quienes tenían una invitación a una propuesta y no habían respondido, cuando quien la creó la retira. No puede nombrar la propuesta: esas personas no han aceptado nada.",
  settingsEmailWhen_invitation_answered:
    "Se envía a quien creó una propuesta cuando una persona invitada confirma o rechaza, o cuando alguien que participaba la deja.",
  settingsEmailWhen_draft_deleted:
    "Se envía a quienes tenían una invitación a un borrador y no habían respondido, cuando quien lo creó lo elimina. No puede nombrar la propuesta: esas personas no han aceptado nada.",
  settingsEmailWhen_reviewer_invitation:
    "Se envía a una persona cuando alguien de la presidencia la invita, en la página Personas, a revisar, y otra vez si se le vuelve a enviar la invitación. Esa persona todavía no ha aceptado nada, así que el correo no nombra a nadie: ni a quien invita ni el nombre que esa persona escribió para ella.",
  settingsEmailWhen_chair_invitation:
    "Se envía a una persona cuando alguien de la presidencia la invita, en la página Personas, a presidir, y otra vez si se le vuelve a enviar la invitación. Esa persona todavía no ha aceptado nada, así que el correo no nombra a nadie: ni a quien invita ni el nombre que esa persona escribió para ella.",
  settingsEmailPlaceholders:
    "Puedes poner estas palabras, con sus llaves, en el asunto y en el texto. Cada una se sustituye cuando se envía el correo:",
  settingsEmailPlaceholder_conference: "el título del congreso",
  settingsEmailPlaceholder_format: "el formato de la propuesta",
  settingsEmailPlaceholder_title: "el título de la propuesta",
  settingsEmailPlaceholder_deadline:
    "la fecha y la hora en que cierra la convocatoria, en la zona horaria del congreso",
  settingsEmailPlaceholder_link: "el enlace a la propuesta",
  settingsEmailPlaceholder_invitationLink:
    "el enlace donde la persona ve la propuesta y confirma o rechaza",
  settingsEmailPlaceholder_roleInvitationLink:
    "el enlace donde la persona lee la invitación y la acepta o la rechaza",
  settingsEmailPlaceholder_committees:
    "los nombres de los grupos de revisión a los que se invita a la persona, separados por comas",
  settingsEmailPlaceholder_owner: "el nombre de quien creó la propuesta",
  settingsEmailPlaceholder_role: "el rol de la persona en la propuesta",
  settingsEmailPlaceholder_person:
    "la persona que respondió: su nombre, o su dirección, como lo escribió quien creó la propuesta",
  settingsEmailPlaceholder_answer: "lo que hizo esa persona",
  settingsEmailWords: "{language}: {words}",
  settingsEmailRequired: "El texto debe contenerla.",
  settingsEmailBodyOnly: "No puede ir en el asunto.",
  settingsEmailRequiredBodyOnly: "El texto debe contenerla, y no puede ir en el asunto.",
  settingsEmailNameRule:
    "Tiene que ser una palabra aparte: solo pueden tocarla paréntesis, comillas y la puntuación que cierra una frase.",
  settingsLabel_message_subject: "Asunto",
  settingsLabel_message_body: "Texto",
  settingsEmailIsStandard: "Este es el texto estándar.",
  settingsEmailChanged: "Este no es el texto estándar.",
  settingsEmailUseStandard: "Usar el texto estándar",
  settingsEmailUseStandardFor: "Usar el texto estándar: {email}, {language}",
  settingsEmailUseStandardConfirm:
    "¿Sustituir lo que escribiste por el texto estándar? Se perderá lo que escribiste en estos dos cuadros y no has guardado.",
  settingsEmailPreview: "El correo tal como se enviaría, con nombres y títulos inventados:",
  settingsEmailSample_owner: "Ana Ejemplo",
  settingsEmailSample_person: "Bruno Muestra",
  settingsEmailSample_title: "Un título inventado",
  settingsStandardText: "el texto estándar",
  settingsAgreementsIntro:
    "Las personas los aceptan cuando envían una propuesta o confirman una invitación. La aplicación registra qué versión de cada acuerdo aceptó cada persona.",
  settingsAgreementHint:
    "Si cambias lo que dice este acuerdo (su título, su texto o su enlace), dale una versión nueva. Con una versión nueva, todas las personas que envíen una propuesta o confirmen una invitación a partir de entonces aceptan la nueva. Lo que ya se aceptó sigue registrado con la versión anterior. No se envía ningún correo, y las propuestas ya enviadas no se ven afectadas.",
  settingsLabel_agreement_title: "Título",
  settingsLabel_agreement_text: "Texto",
  settingsLabel_agreement_url: "Enlace",
  settingsLabel_agreement_version: "Versión",
  settingsAgreementTextHint:
    "Opcional si el acuerdo tiene un enlace. Las personas lo leen debajo del título cuando aceptan, en su idioma si lo has escrito en él y, si no, en el idioma principal del congreso. Los saltos de línea se conservan.",
  settingsAgreementUrlHint:
    "Opcional si el acuerdo tiene un texto. Una página que se puede abrir para leer el acuerdo. Empieza por https://",
  settingsAgreementVersionHint:
    "Da nombre a lo que se acepta. Cámbiala cada vez que cambie el título, el texto o el enlace. Sirve cualquier valor distinto de la versión guardada: una fecha como 2026-12, o un número.",
  settingsQuotedTitle: "«{title}»",
  settingsWarnNewVersion:
    "Versión nueva de {agreements}. Todas las personas que envíen una propuesta o confirmen una invitación a partir de ahora aceptan la versión nueva. Lo que ya se aceptó sigue registrado con la anterior. No se envía ningún correo, y las propuestas ya enviadas no se ven afectadas. Quien tenga abierta ahora mismo una propuesta o una invitación tiene que volver a cargar la página antes de poder aceptar.",
  settingsLabel_other_name: "Nombre",
  settingsLabel_other_description: "Descripción",
  settingsLabel_group_name: "Nombre",
  settingsLabel_group_summary: "Qué incluye",
  settingsLabel_track_name: "Nombre",
  settingsLabel_topic_label: "Nombre",
  settingsInLanguage: "{label} ({language})",
  settingsOptionalHint: "Opcional. Déjalo vacío si no hay.",
  settingsNoMinimumHint: "Déjalo vacío si no hay mínimo: el resumen solo tiene que estar.",
  settingsDeadlineDate: "Fecha",
  settingsDeadlineTime: "Hora",
  settingsDeadlineOffset: "Diferencia con UTC",
  settingsDeadlineOffsetHint:
    "La diferencia dice en qué reloj es esa hora: -05:00 para Bogotá, -12:00 para «cualquier lugar del mundo». Se guarda tal como la escribes.",
  settingsDeadlineIncomplete: "Aún falta parte de la fecha, la hora o la diferencia.",
  settingsReview: "Revisar los cambios",
  settingsNothingChanged: "No se ha cambiado nada.",
  settingsUnsaved: "Valores cambiados y aún sin guardar: {n}.",
  settingsReviewTitle: "Revisa tus cambios",
  settingsReviewIntro: "No se guarda nada hasta que pulses «Guardar los cambios».",
  settingsChangeFromTo: "de «{before}» a «{after}»",
  settingsInstant: "{when} ({tz}), guardado como {stored}",
  settingsEmpty: "vacío",
  settingsYes: "sí",
  settingsNo: "no",
  settingsSave: "Guardar los cambios",
  settingsSaved: "Configuración guardada.",
  settingsSavedMore:
    "Configuración guardada. Lo que cambiaste mientras se guardaba sigue en el formulario, aún sin guardar.",
  settingsNotSaved: "Estos cambios no se guardaron. Revisa de nuevo tus cambios.",
  settingsFixFirst: "Corrige lo siguiente antes de guardar estos cambios:",
  settingsBlocked:
    "Estos cambios no se pueden guardar. Propuestas enviadas que dejarían de ser válidas: {count}.",
  settingsBlockedHelp:
    "El trabajo enviado debe seguir siendo válido. Elige valores que cumplan todas las propuestas enviadas, o pide antes a sus responsables que las cambien.",
  settingsBlockedReason: "{label}: {n}",
  settingsBlockedOpen: "Propuesta {n}",
  settingsBlockedHidden:
    "De ellas, {n} son tuyas o tienes un conflicto con ellas; otra persona de la presidencia puede abrirlas.",
  settingsWarnDrafts:
    "Borradores que tendrían un problema nuevo por resolver antes de poder enviarse: {n}.",
  settingsWarnCloses:
    "Esto cierra la convocatoria en cuanto guardes: nadie podrá iniciar, editar ni enviar una propuesta, ni confirmar una invitación a una.",
  settingsWarnOpens: "Esto abre la convocatoria en cuanto guardes.",
  settingsWarnPast: "«{deadline}» quedaría en el pasado.",
  settingsStale:
    "Otra persona ha cambiado esta configuración desde que la abriste. Vuelve a cargarla para continuar; lo que escribiste sigue en el formulario.",
  settingsReload: "Volver a cargar la configuración",
  settingsReloaded: "La configuración se ha vuelto a cargar. Revisa de nuevo tus cambios.",
  issue_settings_required: "Esto es obligatorio.",
  issue_settings_default_language_required: "Escribe esto en el idioma principal del congreso.",
  issue_settings_whole_number: "Escribe un número entero.",
  issue_settings_number_required: "Escribe un número.",
  issue_settings_too_small: "Escribe {min} o más.",
  issue_settings_too_big: "Escribe {max} o menos.",
  issue_settings_email: "Escribe una dirección de correo.",
  issue_settings_url: "Escribe una dirección web que empiece por https://",
  issue_settings_date: "Escribe una fecha.",
  issue_settings_datetime: "Escribe una fecha, una hora y una diferencia como -05:00.",
  issue_settings_min_over_max: "No puede ser mayor que el valor máximo que tiene al lado.",
  issue_settings_min_not_below_max: "Debe ser menor que la puntuación más alta que tiene al lado.",
  issue_settings_reviewers_assigned:
    "Ya se ha asignado a personas para revisar propuestas que aquí se revisan de forma anónima. A ellas y a las personas autoras se les dijo que la revisión es anónima, así que ahora no se puede mostrar quiénes son las personas autoras.",
  issue_settings_no_whole_number:
    "No hay ningún número entero entre este valor y el máximo que tiene al lado, así que nadie podría responder.",
  issue_settings_deadline_order: "No puede ser anterior al plazo de arriba.",
  issue_settings_reviews_due_order:
    "Las revisiones se entregan después del cierre de envíos y antes del envío de decisiones.",
  issue_settings_reviews_below_scale:
    "Revisiones ya enviadas con una puntuación más baja que esta: {n}. Una revisión enviada sigue siendo válida, así que la puntuación más baja no puede quedar por encima de una ya dada.",
  issue_settings_reviews_above_scale:
    "Revisiones ya enviadas con una puntuación más alta que esta: {n}. Una revisión enviada sigue siendo válida, así que la puntuación más alta no puede quedar por debajo de una ya dada.",
  issue_settings_reviews_have_scores:
    "Revisiones ya enviadas que puntúan un criterio que esto quitaría: {n}. Una revisión enviada sigue siendo válida.",
  issue_settings_reviews_too_short:
    "Revisiones ya enviadas cuyos comentarios tienen menos palabras que estas: {n}. Una revisión enviada sigue siendo válida.",
  issue_settings_reviews_too_long:
    "Revisiones ya enviadas cuyos comentarios tienen más palabras que estas: {n}. Una revisión enviada sigue siendo válida.",
  issue_settings_reviews_have_note:
    "Revisiones ya enviadas que tienen una nota para la presidencia: {n}. La nota no se puede quitar del formulario mientras una revisión enviada tenga una.",
  issue_settings_reviews_have_recommendation:
    "Revisiones ya enviadas que dan una recomendación: {n}. No se puede quitar del formulario mientras una revisión enviada tenga una.",
  issue_settings_reviews_sent:
    "Ya se enviaron revisiones de propuestas en este formato: {n}. Respondieron al formulario del comité que lo revisa ahora.",
  issue_settings_reviews_hidden:
    "Este comité revisa una propuesta tuya, o una con la que tienes un conflicto, y el congreso está en revisión o ya la ha pasado. Si esa propuesta tiene revisiones, y lo que dicen, no te corresponde saberlo, así que tampoco te corresponde restringir el formulario en el que se escriben. Puede hacer este cambio una persona de la presidencia que no tenga una propuesta propia ante este comité ni un conflicto con alguna. Si no hay ninguna, invita a una en la página Personas.",
  issue_settings_dates_order: "El último día no puede ser anterior al primero.",
  issue_settings_final_before_conference:
    "Los materiales finales deben entregarse antes de que empiece el congreso.",
  issue_settings_message_empty: "Escribe el texto, o elige «Usar el texto estándar».",
  issue_settings_message_not_one_line: "Un asunto es una sola línea. Quita los saltos de línea.",
  issue_settings_message_too_long: "Es demasiado largo. Usa {max} caracteres o menos.",
  issue_settings_message_unknown_placeholder:
    "Este correo no tiene nada que poner en lugar de {names}. Usa solo las palabras entre llaves de la lista de arriba, o quita las llaves.",
  issue_settings_message_not_in_subject: "El asunto no puede contener {names}. Solo el texto.",
  issue_settings_message_missing_placeholder: "El texto debe contener {names}.",
  issue_settings_message_link_touched:
    "Pon un espacio o un salto de línea antes y después de {names}. Lo que toque el enlace pasaría a formar parte de su dirección.",
  issue_settings_agreement_version_required:
    "Has cambiado lo que dice este acuerdo. Las personas aceptaron el texto anterior con esta versión, así que escribe una versión nueva.",
  issue_settings_agreement_needs_text_or_link: "Un acuerdo necesita un texto o un enlace.",
  issue_settings_too_long: "Es demasiado largo. Usa {max} caracteres o menos.",
  issue_settings_message_name_touched:
    "{names} representa un nombre que escribió una persona, así que tiene que ser una palabra aparte. Pon un espacio antes y después. Solo pueden tocarla paréntesis, comillas y la puntuación que cierra una frase: cualquier otra cosa podría convertir el nombre en parte de un enlace o de una dirección.",
  issue_settings_message_invisible:
    "Este texto tiene caracteres invisibles, que pueden ocultar o reordenar palabras. Escríbelo de nuevo, o pégalo como texto sin formato.",
  issue_settings_invalid: "Revisa este valor.",
};
