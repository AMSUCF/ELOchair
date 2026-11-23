import type { emailsEn } from "./emails.en";

/** Machine-drafted; to be reviewed by the ELO 2027 team. */
export const emailsPt: Record<keyof typeof emailsEn, string> = {
  emailsTitle: "Emails sobre a revisão",
  emailsAssigned: "Quando lhe forem atribuídas propostas",
  emailsEach: "Um email por cada uma",
  emailsDaily: "Um resumo por dia",
  emailsNone: "Nenhum email",
  emailsRemind: "Lembrar-me {days} dias antes da entrega das revisões",
  emailsRemindOne: "Lembrar-me um dia antes da entrega das revisões",
  emailsChair: "Como membro da presidência: avisos sobre a revisão",
  emailsChairHint:
    "Quando alguém não pode rever uma proposta, e quando uma proposta tem todas as revisões. Um resumo é um email por cada uma das duas coisas.",
  emailsAlways:
    "Os convites, os emails para entrar e as decisões sobre as suas próprias propostas são sempre enviados: sem eles não poderia participar.",
  emailsSave: "Guardar",
  emailsSaveFor: "Guardar as escolhas de email para {conference}",
  emailsSaved: "As suas escolhas de email para {conference} estão guardadas.",
  emailsSaveFailed: "Não foi possível guardar as suas escolhas. Tente novamente.",
  emailsLoadFailed: "Não foi possível carregar as suas escolhas de email. Recarregue a página.",
};
