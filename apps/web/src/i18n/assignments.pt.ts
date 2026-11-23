import type { assignmentsEn } from "./assignments.en";

/** Machine-drafted; to be reviewed by the ELO 2027 team. */
export const assignmentsPt: Record<keyof typeof assignmentsEn, string> = {
  manageAssignmentsLink: "Atribuições",

  reviewersTitle: "Quem revê",
  reviewersDoes_before:
    "Quem atribuir aqui poderá ler esta proposta quando o congresso estiver em revisão, {how}.",
  reviewersDoes_now: "Quem atribuir aqui poderá ler esta proposta a partir desse momento, {how}.",
  reviewersHow_double: "de forma anónima: sem os nomes das pessoas autoras",
  reviewersHow_single: "com os nomes e as instituições das pessoas autoras",
  reviewersHow_open: "com os nomes, as instituições e as biografias das pessoas autoras",
  reviewersNoMail: "Não é enviado nenhum email quando atribui ou retira alguém.",
  reviewersReviewsIntro:
    "Uma revisão aparece aqui quando quem a escreveu a envia, com o seu nome. Às pessoas autoras nunca é dito quem reviu.",
  reviewersCount: "Pessoas atribuídas para a rever: {n} de {needed}.",
  reviewersAsksOne: "Comissão: {committee}. Pede 1 pessoa que reveja cada proposta.",
  reviewersAsksMany: "Comissão: {committee}. Pede {needed} pessoas que revejam cada proposta.",
  reviewersNone: "Esta proposta não está atribuída a ninguém.",
  reviewersAssignedOn: "Atribuída em {date}",
  reviewersRemove: "Retirar desta proposta",
  reviewersRemoveFor: "Retirar desta proposta: {name}",
  reviewersAskRemove: "Retirar {name} desta proposta?",
  reviewersRemoveDoes:
    "{name} deixará de poder ler esta proposta, e ela deixará de contar entre as que lhe estão atribuídas. Não é avisado/a por email.",
  reviewersRemoveAgain: "Pode voltar a atribuir-lha mais tarde.",
  reviewersRemoveDraft: "Se começou uma revisão e não a enviou, esse rascunho é descartado.",
  reviewersReviewNone: "Ainda não enviou nenhuma revisão.",
  reviewersReviewSent: "Revisão enviada em {date}.",
  reviewersReviewChanged: "Revisão enviada em {date}; última alteração em {changed}.",
  reviewersKept:
    "Não é possível retirar-lhe esta proposta: a sua revisão foi enviada, e uma revisão enviada faz parte do processo da proposta.",
  reviewersBlockedSent:
    "Já não revê esta proposta, e não conta entre quem a revê: passou a fazer parte dela, tem um conflito de interesses com ela, ou já não revê nesta comissão. A sua revisão foi enviada antes disso, e continua a fazer parte do processo da proposta.",
  reviewersRemoveSent:
    "Não foi retirada: {name} enviou entretanto a sua revisão, e uma revisão enviada fica com a proposta. A lista foi carregada de novo.",
  reviewersReviewOf: "Revisão de {name}",
  reviewersScore: "{score} de {max}",
  reviewersNoScore: "Sem pontuação",
  reviewersRecommendation: "Recomendação",
  reviewersNoRecommendation: "Nenhuma",
  reviewersComments: "Comentários para as pessoas autoras",
  reviewersChairNote: "Nota apenas para a presidência",
  reviewersChairNoteNone: "Nenhuma.",
  reviewersOtherTitle: "Revisões de pessoas a quem já não está atribuída",
  reviewersOtherIntro:
    "Estas revisões foram enviadas por pessoas a quem esta proposta já não está atribuída. Continuam a fazer parte do seu processo.",
  reviewersDeclinedTitle: "Disseram que não a podiam rever",
  reviewersDeclinedOn: "Disse-o em {date}.",
  reviewersDeclined_conflict:
    "Um conflito de interesses, ou sabe de quem é o trabalho. Esta proposta não lhe voltará a ser proposta.",
  reviewersDeclined_expertise: "Está fora do que consegue avaliar.",
  reviewersDeclined_time: "Não tem tempo.",
  reviewersDeclinedNote: "A sua nota para a presidência:",
  reviewersBlocked:
    "Já não pode rever esta proposta, e não conta entre quem a revê: passou a fazer parte dela, tem um conflito de interesses com ela, ou já não revê nesta comissão. Retire-lhe a proposta.",
  reviewersRemoved: "{name} já não revê esta proposta. Não foi enviado nenhum email.",
  reviewersRemoveGone:
    "Nada foi retirado: {name} já não revia esta proposta. A lista foi carregada de novo.",
  reviewersAssignTitle: "Atribuir a alguém para a rever",
  reviewersAssignIntro:
    "Estas são as pessoas desta comissão que podem rever esta proposta. Não aparecem as que fazem parte dela nem as que têm um conflito de interesses. De cada uma é mostrado quantas propostas lhe estão atribuídas, ao lado do máximo que disse aceitar; não são contadas as suas próprias propostas nem aquelas com que tem um conflito.",
  reviewersTakes_call_not_closed:
    "Ainda não é possível atribuir ninguém: a chamada não fechou. Será possível quando passar a data de encerramento, ou quando o congresso estiver em revisão.",
  reviewersTakes_not_under_consideration:
    "Esta proposta já não admite novas atribuições: foi retirada, ou já tem uma decisão registada. Ainda pode retirar quem a tem atribuída.",
  reviewersNoCandidates:
    "Ninguém desta comissão pode rever esta proposta. A presidência convida quem revê na página Pessoas.",
  reviewersFind: "Procurar por nome ou endereço de email",
  reviewersFindNone: "Ninguém corresponde ao que escreveu.",
  reviewersLanguages: "Revê em: {languages}",
  reviewersLoad: "Propostas atribuídas: {n}",
  reviewersLoadOf: "Propostas atribuídas: {n} de {max}",
  reviewersFull: "Já tem o número de propostas que disse aceitar.",
  reviewersAssign: "Atribuir",
  reviewersAssignFor: "Atribuir esta proposta a {name}",
  reviewersAskFull: "Atribuir a {name} mesmo assim?",
  reviewersFullDoes:
    "{name} disse que aceitaria no máximo {max} propostas, e tem {n}. Esse número é o que ofereceu, não um limite: pode atribuir-lha na mesma.",
  reviewersDoAssign: "Sim, atribuir",
  reviewersAssigned: "{name} já revê esta proposta. Não foi enviado nenhum email.",
  reviewersNowFull:
    "Ainda por atribuir: {name} já tem o número de propostas que disse aceitar. Leia os números e confirme.",
  reviewersNotOffered:
    "Não atribuída: já não é possível atribuir esta proposta a {name}. A lista foi carregada de novo.",
  reviewersAlready: "{name} já revê esta proposta. A lista foi carregada de novo.",
  reviewersNotTaking:
    "Não atribuída: esta proposta não admite atribuições neste momento. A lista foi carregada de novo.",
  reviewersNoAccess:
    "Nada foi alterado: só quem preside ao congresso e gere esta proposta pode alterar quem a revê.",
  reviewersLoadFailed:
    "Não foi possível carregar quem revê esta proposta. Recarregue a página para tentar de novo.",

  assignmentsTitle: "Atribuições",
  assignmentsNoAccess: "Só quem preside a este congresso pode ver quem revê as suas propostas.",
  assignmentsIntro:
    "Todas as propostas que podem ser atribuídas a alguém para as rever, sob a comissão que as revê. Primeiro aparecem as que ainda precisam de alguém, e depois as que ainda esperam revisões. Para atribuir ou retirar uma pessoa, ou para ler as revisões enviadas, abra a proposta. Nada é atribuído automaticamente, e não é enviado nenhum email.",
  assignmentsCallOpen:
    "A chamada ainda não fechou, por isso ainda não é possível atribuir ninguém. São mostradas as propostas submetidas até agora.",
  assignmentsExcludedOne: "Não aparece 1 proposta: é sua, ou tem um conflito com ela.",
  assignmentsExcludedMany: "Não aparecem {n} propostas: são suas, ou tem um conflito com elas.",
  assignmentsCommittees: "Comissões",
  assignmentsProposalsNone: "Nenhuma proposta desta comissão admite atribuições.",
  assignmentsProposalsOne: "1 proposta.",
  assignmentsProposalsMany: "{n} propostas.",
  assignmentsShortNone: "A nenhuma falta alguém.",
  assignmentsShortOne: "A 1 ainda falta alguém.",
  assignmentsShortMany: "A {n} ainda falta alguém.",
  assignmentsAsksOne: "Esta comissão pede 1 pessoa que reveja cada proposta.",
  assignmentsAsksMany: "Esta comissão pede {needed} pessoas que revejam cada proposta.",
  assignmentsReviewers: "Reveem-na: {n} de {needed}",
  assignmentsSent: "Revisões enviadas: {n}",
  assignmentsWaitingOne:
    "1 tem quem a reveja e menos revisões enviadas do que a comissão pede. Aparece a seguir.",
  assignmentsWaitingMany:
    "{n} têm quem as reveja e menos revisões enviadas do que a comissão pede. Aparecem a seguir.",
  assignmentsNeedsOne: "Falta 1",
  assignmentsNeedsMany: "Faltam {n}",
  assignmentsComplete: "Completa",
  assignmentsNoReviewer: "Ainda ninguém",
};
