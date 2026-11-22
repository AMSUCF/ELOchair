import type { peopleEn } from "./people.en";

/** Machine-drafted; to be reviewed by Portuguese and Brazilian ELO members. */
export const peoplePt: Record<keyof typeof peopleEn, string> = {
  managePeopleLink: "Pessoas",
  peopleTitle: "Pessoas",
  peopleNoAccess: "Só quem preside a este congresso pode ver e alterar quem tem um papel nele.",
  peopleIntro:
    "Esta página mostra quem tem um papel neste congresso e os convites que ninguém aceitou. Uma pessoa recebe um papel ao aceitar um convite enviado a partir daqui. Pode voltar a retirar um papel.",
  peopleNoName: "Ainda sem nome",
  peopleYou: "É a sua conta",
  peopleInviteTitle: "Convidar alguém",
  peopleInviteIntro:
    "A pessoa recebe um email com um link. Nada muda até abrir o link e aceitar: nesse momento o endereço que escreveu recebe o papel, seja quem for que tenha aberto o link. O link funciona durante {days} dias. Convida-se um endereço de cada vez.",
  peopleInviteEmail: "Endereço de email",
  peopleInviteName: "Nome (opcional)",
  peopleInviteNameHint:
    "Só quem preside vê este nome, nesta página. Não é posto no email, e a pessoa indica o seu próprio nome ao aceitar.",
  peopleInviteRole: "Papel",
  peopleInviteRole_reviewer: "Revisão",
  peopleInviteRoleDoes_reviewer:
    "Vê apenas as propostas que a presidência lhe atribui, e escreve uma revisão de cada uma.",
  peopleInviteRole_chair: "Presidência",
  peopleInviteRoleDoes_chair:
    "Pode fazer tudo o que a presidência pode: ver todas as propostas e todas as pessoas que nelas constam, alterar a configuração do congresso, convidar e retirar pessoas, e passar o congresso de uma fase para a seguinte.",
  peopleInvitePools: "Grupos de revisão",
  peopleInvitePoolsHint:
    "Escolha pelo menos um. A esta pessoa poderão ser atribuídas propostas dos formatos que estes grupos reveem.",
  peopleInviteLang: "Idioma do email",
  peopleInviteSend: "Enviar o convite",
  peopleInviteLimits:
    "Pode enviar {perInviter} convites por dia, e a um mesmo endereço podem ser enviados {perRecipient} por dia.",
  peopleEmailInvalid: "Introduza um único endereço de email válido.",
  peopleNameInvalid:
    "Use uma única linha de letras ou algarismos, no máximo {max} caracteres, sem caracteres de formatação ocultos.",
  peoplePoolsRequired: "Escolha pelo menos um grupo de revisão.",
  peopleInvited: "O convite foi enviado para {email}.",
  peopleAlreadyInvited:
    "Já há um convite pendente para este endereço e este papel. Pode voltar a enviá-lo a partir da lista de convites.",
  peopleAlreadyHasRole: "Este endereço já tem esse papel neste congresso.",
  peopleInviteLimited:
    "Não foi enviado: hoje saíram demasiados convites. Pode enviar {perInviter} por dia, e a um mesmo endereço podem ser enviados {perRecipient} por dia. Tente amanhã.",
  peopleChairsTitle: "Presidência",
  peopleChairsIntro:
    "Quem preside dirige o congresso: vê todas as propostas, altera a configuração e gere esta página. Não pode retirar o seu próprio papel, para que o congresso tenha sempre quem o presida.",
  peopleReviewersTitle: "Quem revê",
  peopleReviewersIntro:
    "Quem revê aparece em cada grupo de revisão a que pertence, com o número de propostas que lhe estão atribuídas. Não são contadas as suas próprias propostas nem aquelas com que tem um conflito.",
  peoplePoolEmpty: "Ainda ninguém revê neste grupo.",
  peoplePoolGone: "Sem um grupo de revisão atual",
  peopleAssignedNone: "Nenhuma proposta atribuída",
  peopleAssignedOne: "1 proposta atribuída",
  peopleAssignedMany: "{n} propostas atribuídas",
  peopleOffers: "Aceita até {max}. Revê em: {languages}.",
  peopleTrackChairsTitle: "Coordenação de eixo",
  peopleTrackChairsIntro:
    "A coordenação de eixo não faz parte desta versão da aplicação. Estas pessoas receberam o papel anteriormente. Pode retirá-lo; não é possível convidar ninguém para ele.",
  peopleTracks: "Eixos: {tracks}",
  peopleAllTracks: "Todos os eixos",
  peopleInvitationsTitle: "Convites",
  peopleInvitationsIntro:
    "Convites que aguardam resposta, que foram recusados ou que expiraram. Cada um é mostrado tal como o escreveu. Não é enviado nenhum email quando alguém responde: é nesta lista que o vê. «Enviar de novo» envia um novo email com um novo link, e o link do email anterior deixa de funcionar.",
  peopleInvitationsNone: "Não há nenhum convite pendente, recusado ou expirado.",
  peopleInvitationRole_reviewer: "Convite para rever: {pools}",
  peopleInvitationRole_chair: "Convite para presidir",
  peopleInvState_waiting: "A aguardar resposta",
  peopleInvState_declined: "Recusado",
  peopleInvState_expired: "Expirado",
  peopleInvSent: "Enviado a {date}",
  peopleInvExpires: "O link funciona até {date}",
  peopleInvDeclined: "Recusado a {date}",
  peopleInvExpired: "O link deixou de funcionar a {date}",
  peopleResend: "Enviar de novo",
  peopleResendFor: "Enviar de novo o convite para {email}",
  peopleCancel: "Cancelar o convite",
  peopleCancelFor: "Cancelar o convite para {email}",
  peopleDismiss: "Retirar desta lista",
  peopleDismissFor: "Retirar desta lista o convite para {email}",
  peopleResent: "Foi enviado um novo email para {email}. O link do email anterior já não funciona.",
  peopleResendLimited:
    "Não foi enviado. Um convite pode ser enviado de novo uma vez por hora, e aplicam-se os limites diários: {perInviter} seus, {perRecipient} para um mesmo endereço.",
  peoplePoolsGone:
    "Não foi enviado: os grupos de revisão deste convite já não fazem parte do congresso, pelo que o seu link não dá nada. Cancele-o e convide a pessoa de novo.",
  peopleInvitationChanged:
    "Nada foi feito: este convite tinha mudado entretanto. A lista foi carregada de novo.",
  peopleAskCancel: "Cancelar o convite para {email}?",
  peopleCancelDoes:
    "O link do email deixa de funcionar e o convite sai desta lista. Ninguém é avisado.",
  peopleDoCancel: "Sim, cancelar",
  peopleAskDismiss: "Retirar desta lista o convite para {email}?",
  peopleDismissDoes: "Nada mais muda e ninguém é avisado. Pode voltar a convidar este endereço.",
  peopleDoDismiss: "Sim, retirar",
  peopleGoBack: "Não, voltar",
  peopleCancelled: "O convite para {email} foi cancelado. O seu link já não funciona.",
  peopleDismissed: "O convite para {email} foi retirado da lista.",
  peopleRemove: "Retirar",
  peopleRemoveFor_chair: "Retirar {name} da presidência",
  peopleRemoveFor_reviewer: "Retirar {name} da revisão",
  peopleRemoveFor_track_chair: "Retirar {name} da coordenação de eixo",
  peopleAskRemove_chair: "Retirar {name} da presidência?",
  peopleAskRemove_reviewer: "Retirar {name} da revisão?",
  peopleAskRemove_track_chair: "Retirar {name} da coordenação de eixo?",
  peopleRemoveDoes_chair:
    "{name} deixará de poder ver as propostas como presidência, alterar a configuração, convidar ou retirar pessoas e alterar a fase do congresso. Não é avisado/a por email. Os convites que enviou ficam como estão: pode cancelar qualquer um na lista abaixo. Para que volte a presidir, convide-o/a de novo.",
  peopleRemoveDoes_reviewer:
    "{name} deixará de rever neste congresso, em todos os grupos de revisão, e deixará de ver as propostas que lhe estavam atribuídas. Não é avisado/a por email. Para que volte a rever, convide-o/a de novo.",
  peopleRemoveDoes_track_chair:
    "{name} deixará de gerir as propostas dos seus eixos. Não é avisado/a por email. Nesta versão da aplicação não é possível convidar ninguém para este papel.",
  peopleRemoveAssignedNone: "Não lhe está atribuída nenhuma das propostas que gere.",
  peopleRemoveAssignedOne:
    "Está-lhe atribuída 1 proposta das que gere, que perderá esta pessoa como revisora.",
  peopleRemoveAssignedMany:
    "Estão-lhe atribuídas {n} propostas das que gere, que perderão esta pessoa como revisora.",
  peopleDoRemove: "Sim, retirar",
  peopleRemoved_chair: "{name} já não preside a este congresso.",
  peopleRemoved_reviewer: "{name} já não revê neste congresso.",
  peopleRemoved_track_chair: "{name} já não coordena nenhum eixo deste congresso.",
  peopleRemoveStale:
    "Nada foi retirado: o número de propostas atribuídas a esta pessoa mudou. Leia o novo número e confirme de novo.",
  peopleRemoveGone:
    "Nada foi retirado: esta pessoa já não tem esse papel. A lista foi carregada de novo.",
  peopleUnconfirmed: "O servidor não confirmou. Tente novamente.",
  roleInvTitle: "Convite para um papel",
  roleInvIntro_reviewer: "Quem preside a {conference} convida-o/a a rever propostas.",
  roleInvIntro_chair: "Quem preside a {conference} convida-o/a a juntar-se à presidência.",
  roleInvConference: "Congresso",
  roleInvRole: "Papel",
  roleInvCommittees: "Comissões",
  roleInvFor: "Convite para",
  roleInvMeans_reviewer:
    "Se aceitar: a presidência atribui-lhe propostas; lê-as e escreve uma breve revisão de cada uma.",
  roleInvMeans_chair:
    "Se aceitar: poderá ver todas as propostas e todas as pessoas que nelas constam, alterar a configuração do congresso, convidar pessoas e passar o congresso de uma fase para a seguinte.",
  roleInvBound:
    "Este convite é para {email}. Se aceitar, esse endereço recebe o papel, seja quem for que abra este link. Aceitar não inicia sessão.",
  roleInvExpires: "Pode responder até {date}.",
  roleInvLanguages: "Idiomas em que pode rever",
  roleInvLanguagesHint: "Escolha pelo menos um.",
  roleInvLanguagesRequired: "Escolha pelo menos um idioma para aceitar.",
  roleInvLoad: "O máximo de propostas que está disponível para rever",
  roleInvLoadHint:
    "Um número inteiro de {min} a {max}. A presidência vê-o quando atribui propostas.",
  roleInvLoadInvalid: "Introduza um número inteiro de {min} a {max}.",
  roleInvYourName: "O seu nome",
  roleInvNameHelp: "O seu próprio nome, tal como a presidência o verá.",
  roleInvNameRequired: "Introduza o seu nome para aceitar.",
  roleInvAccept: "Aceitar",
  roleInvDecline: "Recusar",
  roleInvDeclineNote:
    "Recusar não exige mais nada. A presidência verá que recusou; não é enviado nenhum email.",
  roleInvAccepted_reviewer:
    "Obrigado: {email} já revê para {conference}. Pode entrar com esse endereço quando quiser.",
  roleInvAccepted_chair:
    "Obrigado: {email} já preside a {conference}. Entre com esse endereço para gerir o congresso.",
  roleInvDeclined: "Recusou. Não foi atribuído nenhum papel, e a presidência verá a sua resposta.",
  roleInvInvalid:
    "Este link de convite já não funciona: expirou, já foi respondido ou foi cancelado. Se recebeu um email mais recente, use o link desse email. Caso contrário, peça a quem preside ao congresso que o/a convide de novo.",
  roleInvSignIn: "Entrar como {email}",
};
