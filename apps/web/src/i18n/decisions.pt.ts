import type { decisionsEn } from "./decisions.en";

/** Machine-drafted; to be reviewed by the ELO 2027 team. */
export const decisionsPt: Record<keyof typeof decisionsEn, string> = {
  manageDecisionsLink: "Decisões",

  decisionTitle: "Decisão",
  decisionDoes:
    "Registar aqui uma decisão não avisa ninguém. As pessoas autoras são informadas quando a presidência envia as decisões, na página Decisões. Até lá pode alterá-la ou retirá-la.",
  decisionReviews: "Revisões enviadas: {sent} de {asked}.",
  decisionReviewsBelow: "As revisões estão mais abaixo, em «Quem revê».",
  decisionRecs: "Recomendações: {list}.",
  decisionRecsNone: "Não foi dada nenhuma recomendação.",
  decisionRec_accept: "{n} aceitar",
  decisionRec_unsure: "{n} com dúvidas",
  decisionRec_reject: "{n} rejeitar",
  decisionChoose: "Decisão para esta proposta",
  decisionChoice_accepted: "Aceitar",
  decisionChoice_waitlisted: "Colocar em lista de espera",
  decisionChoice_rejected: "Rejeitar",
  decisionRecord: "Registar esta decisão",
  decisionChange: "Alterar a decisão",
  decisionTakeBack: "Retirar a decisão",
  decisionNone: "Não há nenhuma decisão registada para esta proposta.",
  decisionRecorded: "Registada e ainda por enviar: {outcome}.",
  decisionOutcome_accepted: "aceitar",
  decisionOutcome_waitlisted: "lista de espera",
  decisionOutcome_rejected: "rejeitar",
  decisionSendWhere: "É enviada com as outras, na página Decisões.",
  decisionSendLater:
    "Poderá ser enviada quando o congresso estiver na fase «{deciding}», na página Decisões.",
  decisionTold: "As pessoas autoras foram informadas em {date}: «{status}».",
  decisionFinal:
    "Aqui isso é definitivo: não é possível registar outra decisão para esta proposta.",
  decisionWaitlistNext:
    "Pode registar a decisão que põe fim à lista de espera, aceitar ou rejeitar. É enviada como a primeira.",
  decisionTakes_not_in_review:
    "Ainda não é possível registar nenhuma decisão: o congresso não está em revisão.",
  decisionTakes_not_under_consideration:
    "Não é possível registar nenhuma decisão: esta proposta foi retirada.",
  decisionWillNotBeSent:
    "A decisão que foi registada antes para ela não será enviada. Pode retirá-la.",
  decisionChooseFirst: "Escolha primeiro uma das decisões.",
  decisionSaidRecorded: "Registada: {outcome}. Ninguém foi avisado.",
  decisionSaidTakenBack: "A decisão foi retirada. Ninguém foi avisado.",
  decisionNotNow:
    "Nada foi registado: esta proposta não admite uma decisão neste momento. Aqui é mostrada como está agora.",
  decisionGone:
    "Nada foi retirado: já não havia nenhuma decisão por enviar para esta proposta. Aqui é mostrada como está agora.",
  decisionNoAccess:
    "Nada foi alterado: só quem preside ao congresso e gere esta proposta pode registar a sua decisão.",
  decisionLoadFailed:
    "Não foi possível carregar a decisão desta proposta. Recarregue a página para tentar de novo.",
  decisionToPage: "Todas as decisões",

  decisionsTitle: "Decisões",
  decisionsNoAccess: "Só quem preside a este congresso pode ver as suas decisões.",
  decisionsIntro:
    "Todas as propostas que ainda esperam uma decisão, sob a comissão que as revê. Primeiro aparecem as que ainda não têm nenhuma. Para registar uma decisão, abra a proposta: as suas revisões estão na mesma página. Registá-la não avisa ninguém. Uma proposta a que já foi comunicado «aceite» ou «não aceite» deixa de aparecer aqui: encontra-a em «Gerir submissões», pelo seu estado.",
  decisionsNotYet:
    "Ainda não é possível registar nenhuma decisão: o congresso não está em revisão.",
  decisionsExcludedOne: "Não aparece 1 proposta: é sua, ou tem um conflito com ela.",
  decisionsExcludedMany: "Não aparecem {n} propostas: são suas, ou tem um conflito com elas.",
  decisionsProposalsNone: "Nenhuma proposta desta comissão espera uma decisão.",
  decisionsProposalsOne: "1 proposta espera uma decisão.",
  decisionsProposalsMany: "{n} propostas esperam uma decisão.",
  decisionsUndecidedNone: "Nenhuma está sem decisão.",
  decisionsUndecidedOne: "1 ainda não tem decisão.",
  decisionsUndecidedMany: "{n} ainda não têm decisão.",
  decisionsNoneYet: "Ainda sem decisão",
  decisionsRecorded: "Registada: {outcome}",
  decisionsNotSent: "Ainda por enviar.",
  decisionsWaitlisted: "Em lista de espera",
  decisionsWaitlistedTold: "As pessoas autoras já foram informadas.",
  decisionsReviews: "Revisões enviadas: {sent} de {asked}",
  decisionsNoReviews: "Não foi enviada nenhuma revisão.",

  sendTitle: "Enviar as decisões",
  sendDoes:
    "Enviá-las informa as pessoas autoras. Sai cada decisão registada e ainda por enviar, de todo o congresso: a proposta recebe o seu novo estado, e quem a criou e quem confirmou a coautoria recebem um email com o resultado e os comentários que quem a reviu escreveu para as pessoas autoras.",
  sendWaiting:
    "Por enviar: {accepted} aceites, {waitlisted} para a lista de espera, {rejected} não aceites.",
  sendNothing: "Não há nenhuma decisão por enviar.",
  sendNotYet:
    "Ainda não é possível enviar as decisões: o congresso está na fase «{phase}». Poderão ser enviadas quando estiver em «{deciding}», quando as revisões já não puderem ser alteradas.",
  sendOpen: "Enviar as decisões",
  sendAsk: "Enviar estas decisões?",
  sendWill_accepted: "Propostas a que será comunicado «aceite»: {n}",
  sendWill_waitlisted: "Propostas a que será comunicado «em lista de espera»: {n}",
  sendWill_rejected: "Propostas a que será comunicado «não aceite»: {n}",
  sendWill_people: "Pessoas que receberão um email: {n}",
  sendWill_undecided: "Propostas ainda sem decisão, a que nada será comunicado: {n}",
  sendWill_dropped:
    "Decisões que não serão enviadas, porque a proposta foi retirada ou voltou a rascunho: {n}",
  sendCounts:
    "Estes números contam todas as decisões registadas no congresso, também as de propostas que não lhe são mostradas por serem suas ou por ter um conflito com elas.",
  sendFinal:
    "Um «aceite» ou um «não aceite» já enviado é definitivo: depois não pode ser alterado aqui. A uma proposta em lista de espera pode ser dada mais tarde uma nova decisão.",
  sendPreviews:
    "Estes são os emails, com um título e comentários inventados. Cada pessoa recebe o seu no seu idioma; este é o texto em {language}.",
  sendPreview_accepted: "O email para «aceite»",
  sendPreview_waitlisted: "O email para «em lista de espera»",
  sendPreview_rejected: "O email para «não aceite»",
  sendDo: "Sim, enviar",
  sendDone:
    "As decisões foram enviadas. Aceites: {accepted}. Em lista de espera: {waitlisted}. Não aceites: {rejected}. Pessoas a quem se escreveu: {people}.",
  sendDoneDropped: "Não enviadas, porque a proposta foi retirada ou voltou a rascunho: {n}.",
  sendStale:
    "Nada foi enviado: o que está por enviar já não é o que esta confirmação mostrava. Agora mostra o que está por enviar. Leia-a de novo e envie.",
  sendStaleNothing:
    "Agora nada foi enviado: já não há nenhuma decisão por enviar. A página mostra o que há agora.",
  sendNotDeciding:
    "Nada foi enviado: o congresso não está numa fase em que as decisões são enviadas. A página mostra-o como está agora.",
  sendNoAccess: "Nada foi enviado: só quem preside a este congresso pode enviar as suas decisões.",
  sendUnconfirmed:
    "O servidor não confirmou que as decisões foram enviadas. Recarregue a página para ver o que continua por enviar antes de tentar de novo.",

  authorDecisionTitle: "Decisão",
  authorDecision_accepted: "Esta proposta foi aceite.",
  authorDecision_waitlisted:
    "Esta proposta está em lista de espera. Por agora não está aceite, e ainda pode vir a estar: receberá um email quando a presidência decidir.",
  authorDecision_rejected: "Esta proposta não foi aceite.",
  authorDecisionSent: "A presidência enviou esta decisão em {date}.",
  authorCommentsTitle: "Comentários de quem reviu a proposta",
  authorCommentsIntro:
    "Quem reviu a proposta escreveu estes comentários para as pessoas autoras. Não é dito quem são.",
  editDecided: "Foi enviada uma decisão sobre esta proposta: já não pode ser editada.",
};
