import type { reviewsEn } from "./reviews.en";

/** Machine-drafted; to be reviewed by the ELO 2027 team. */
export const reviewsPt: Record<keyof typeof reviewsEn, string> = {
  navMyReviews: "As minhas revisões",

  myReviewsTitle: "As minhas revisões",
  myReviewsNeedSignIn: "Inicie sessão para ver as suas revisões.",
  myReviewsNone:
    "De momento não tem nada para rever. As propostas aparecem aqui quando um congresso para o qual revê está em revisão e a presidência lhe atribuiu alguma.",
  myReviewsCommittees: "Revê para: {committees}",
  myReviewsDue: "As revisões devem ser entregues até {date}.",
  myReviewsDueNote:
    "Pode enviar e alterar as suas revisões enquanto o congresso estiver em revisão.",
  myReviewsClosed:
    "A revisão terminou neste congresso. Pode ler as suas revisões; já não podem ser alteradas.",
  myReviewsCountSent: "{sent} de {total} enviadas",
  myReviewsCountDraftOne: "1 rascunho",
  myReviewsCountDraftMany: "{n} rascunhos",
  myReviewsCountNotStarted: "{n} por começar",
  myReviewsGuidelinesFor: "Orientações para quem revê: {committee}",
  myReviewsProposals: "Propostas que lhe foram atribuídas",
  myReviewsEmpty: "Ainda não lhe foi atribuída nenhuma proposta neste congresso.",
  myReviewsOnlyYours:
    "Vê apenas as propostas que lhe foram atribuídas. Não é mostrado quem mais as revê.",
  myReviewsLeft:
    "«{title}» saiu da sua lista. A presidência pode ver que não a pode rever, e pode entregá-la a outra pessoa.",
  reviewStatus_not_started: "Por começar",
  reviewStatus_draft: "Rascunho",
  reviewStatus_sent: "Enviada",

  reviewNamesShown:
    "Esta comissão vê quem são as pessoas autoras; elas nunca ficam a saber quem reviu a sua proposta.",
  reviewFormTitle: "A sua revisão",
  reviewFormIntro:
    "A presidência lê a sua revisão e sabe que é sua. As pessoas autoras recebem os seus comentários para elas, sem o seu nome e sem as pontuações.",
  reviewScoreLead: "Pontue cada critério. {min} é o mais baixo, {max} o mais alto.",
  reviewScoreLeadMixed:
    "Pontue cada critério. Em cada escala, o número mais pequeno é a pontuação mais baixa e o maior a mais alta.",
  reviewScale: "De {min} (o mais baixo) a {max} (o mais alto)",
  reviewScoreTyped: "Um número inteiro de {min} a {max}",
  reviewComments: "Comentários para as pessoas autoras",
  reviewCommentsHelp:
    "As pessoas autoras recebem isto com a decisão. Diga o que é sólido, o que não está claro e o que melhoraria a proposta.",
  reviewChairNote: "Nota apenas para a presidência (opcional)",
  reviewChairNoteHelp: "As pessoas autoras nunca veem isto.",
  reviewRecommendation: "A sua recomendação",
  recommendation_accept: "Aceitar",
  recommendation_unsure: "Com dúvidas",
  recommendation_reject: "Rejeitar",
  reviewWords: "{count} palavras",
  reviewWordsBetween: "{count} palavras (entre {min} e {max})",
  reviewWordsMin: "{count} palavras (pelo menos {min})",
  reviewWordsMax: "{count} palavras (no máximo {max})",
  reviewSend: "Enviar a revisão",
  reviewSaveDraft: "Guardar rascunho",
  reviewDraftSaved:
    "Rascunho guardado. A presidência só vê a sua revisão depois de a enviar. Pode alterá-la depois de a enviar, enquanto o congresso estiver em revisão.",
  reviewSent:
    "A sua revisão foi enviada. A presidência já a pode ler. Pode alterá-la enquanto o congresso estiver em revisão.",
  reviewChanged: "A sua revisão alterada foi enviada. A presidência lê agora esta versão.",
  reviewErrors: "Antes de enviar a sua revisão, corrija o seguinte:",
  reviewErrorsDraft: "Não foi possível guardar o rascunho tal como está:",
  reviewNothingToSave: "Não há nada de novo para guardar.",
  reviewStale:
    "Esta revisão foi entretanto guardada noutro local, noutro separador ou noutro dispositivo. O que escreveu aqui continua no formulário: verifique-o e volte a guardá-la ou a enviá-la.",
  reviewRestoredMoved:
    "As suas alterações por guardar foram restauradas a partir deste dispositivo. Depois de as ter feito, esta revisão foi guardada noutro local, noutro separador ou noutro dispositivo, e as suas alterações substituiriam o que lá foi guardado. Verifique-as e guarde ou envie, ou descarte-as.",
  reviewNotReviewing:
    "Não foi guardada: o congresso já não está em revisão, por isso as revisões já não podem ser alteradas.",
  reviewGone:
    "Não foi guardada: esta proposta já não lhe está atribuída. O que escreveu não foi enviado a ninguém.",
  reviewAlreadySent:
    "Não foi guardada como rascunho: esta revisão já tinha sido enviada. Volte a enviá-la para alterar o que a presidência lê.",
  reviewUnconfirmed: "O servidor não confirmou. Tente de novo.",
  reviewDraftNotice:
    "Isto é um rascunho. Só o próprio o pode ver: a presidência vê a sua revisão depois de a enviar.",
  reviewSentOn:
    "A sua revisão foi enviada em {date}. Pode alterá-la enquanto o congresso estiver em revisão.",
  reviewSentChangedOn:
    "A sua revisão foi enviada em {date} e alterada pela última vez em {changed}. Pode alterá-la enquanto o congresso estiver em revisão.",
  reviewSentClosed:
    "A sua revisão foi enviada em {date}. A revisão terminou, por isso já não pode ser alterada.",
  reviewDraftClosed:
    "Este rascunho não foi enviado. A revisão terminou, por isso já não pode ser enviado, e a presidência não o vê.",
  reviewNotStartedClosed: "Não reviu esta proposta. A revisão terminou.",
  reviewScoreOf: "{score} de {max}",
  reviewNoScore: "Sem pontuação",
  reviewNoRecommendation: "Nenhuma",
  reviewNoComments: "Ainda não há nada escrito.",
  reviewNoteHeading: "Nota apenas para a presidência",
  reviewNoteNone: "Não escreveu nenhuma.",
  reviewChange: "Alterar a minha revisão",
  reviewChanging:
    "Está a alterar uma revisão que já foi enviada. A presidência lê a versão enviada até enviar esta.",
  reviewKeepSent: "Deixar a revisão como foi enviada",
  reviewBackToList: "Voltar às minhas revisões",
  reviewCannot: "Não posso rever esta proposta",
  reviewCannotAfterSent:
    "Já enviou a sua revisão desta proposta, por isso ela continua atribuída a si. Se já não a subscreve, altere-a, ou escreva à presidência:",
  issue_not_on_form:
    "O formulário de revisão já não tem isto. Recarregue a página para ver o formulário tal como está agora.",

  cannotTitle: "Não posso rever esta proposta",
  cannotDoes:
    "A presidência é avisada por email de que uma proposta foi devolvida. Na página da proposta vê quem a devolveu, com o seu motivo e a sua nota, e pode entregá-la a outra pessoa. A proposta sai da sua lista e já não a poderá abrir.",
  cannotDoesChair:
    "A presidência é avisada por email de que uma proposta foi devolvida. Na página da proposta vê quem a devolveu, com o seu motivo e a sua nota, e pode entregá-la a outra pessoa. A proposta sai da sua lista de revisões. Poderá continuar a abri-la como membro da presidência, salvo se o seu motivo for um conflito de interesses: nesse caso já não a poderá abrir.",
  cannotWhy: "Porquê?",
  cannotReason_conflict: "Tenho um conflito de interesses, ou sei de quem é este trabalho",
  cannotReason_expertise: "Está fora do que consigo avaliar",
  cannotReason_time: "Não tenho tempo",
  cannotConflictNote:
    "Depois de um conflito de interesses, a proposta nunca mais lhe é atribuída. Depois de qualquer dos outros dois motivos, a presidência poderá voltar a atribuí-la mais tarde.",
  cannotNote: "Nota para a presidência (opcional)",
  cannotTell: "Avisar a presidência",
  cannotCancel: "Cancelar",
  cannotErrors: "Antes de avisar a presidência, corrija o seguinte:",
  issue_choose_reason: "Escolha um motivo.",
  cannotDraftGoes: "O rascunho que guardou para esta proposta é descartado.",
  cannotNotOffered:
    "Isto já não é possível: a sua revisão desta proposta foi enviada, ou o congresso já não está em revisão.",
  cannotGone: "Esta proposta não lhe está atribuída.",
};
