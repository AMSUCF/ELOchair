import type { settingsEn } from "./settings.en";

/** Machine-drafted; to be reviewed by the ELO 2027 team. */
export const settingsPt: Record<keyof typeof settingsEn, string> = {
  manageSettingsLink: "Configuração do congresso",
  settingsTitle: "Configuração do congresso",
  settingsNoAccess: "Só quem preside a este congresso pode alterar a sua configuração.",
  settingsIntro:
    "Altere aqui os dados, as datas, os limites e os textos do congresso, a forma como as propostas são revistas, a redação dos emails que a aplicação envia e os acordos que as pessoas aceitam. Revê cada alteração antes de a guardar, e cada gravação fica registada.",
  settingsScopeNote:
    "Os formatos, os campos, os idiomas, os grupos de revisão, os critérios e os acordos são acrescentados ou retirados importando uma configuração no servidor, e não aqui.",
  settingsBackToManage: "Voltar às submissões",
  settingsSectionConference: "O congresso",
  settingsSectionDeadlines: "Prazos",
  settingsSectionRules: "Regras",
  settingsSectionFormats: "Formatos",
  settingsSectionReview: "Revisão",
  settingsSectionEmails: "Emails",
  settingsSectionAgreements: "Acordos",
  settingsSectionOther: "Formatos que não se submetem aqui",
  settingsSectionWays: "Formas de participar",
  settingsWaysIntro:
    "A página inicial e a página do congresso mostram-nas em «Formas de participar», cada uma com uma ligação para os seus formatos. Para acrescentar ou retirar uma, ou passar um formato para outra, é preciso importar uma configuração.",
  settingsWayFormats: "Leva a estes formatos: {formats}.",
  settingsSectionTracks: "Linhas temáticas",
  settingsSectionTopics: "Tópicos",
  settingsField: "Campo: {name}",
  settingsPoolFormats: "Este grupo revê estes formatos: {formats}.",
  settingsPoolNoFormats: "Este grupo não revê nenhum formato.",
  settingsPoolOwnMode_double:
    "A revisão de {format} é sempre anónima, seja qual for a escolha abaixo.",
  settingsPoolOwnMode_single:
    "Em {format}, quem revê vê sempre os nomes e as instituições das pessoas autoras, seja qual for a escolha abaixo.",
  settingsPoolOwnMode_open:
    "Em {format}, quem revê vê sempre os nomes, as instituições e as biografias das pessoas autoras, seja qual for a escolha abaixo.",
  settingsCriterion: "Critério: {name}",
  settingsLabel_title: "Título",
  settingsLabel_theme: "Tema",
  settingsLabel_distinction: "O que distingue esta edição",
  settingsLabel_invitation: "Convite",
  settingsDistinctionHint:
    "Opcional. Uma linha que aparece junto das datas e do local, na página inicial e no início da página do congresso.",
  settingsInvitationHint:
    "Opcional. Um parágrafo breve que diz que trabalhos a chamada acolhe. A página inicial e a página do congresso começam com ele, no idioma de quem lê se o tiver escrito nesse idioma e, se não, no idioma principal do congresso.",
  settingsLabel_formatsIntro: "Introdução aos formatos",
  settingsFormatsIntroHint:
    "Opcional. Uma ou duas frases que aparecem na página do congresso, acima dos seus formatos de submissão, no idioma de quem lê se as tiver escrito nesse idioma e, se não, no idioma principal do congresso.",
  settingsLabel_host: "Instituição anfitriã",
  settingsLabel_location: "Local",
  settingsLabel_modality: "Como se participa",
  settingsLabel_contactEmail: "Email de contacto",
  settingsLabel_website: "Site do congresso",
  settingsLabel_dates_start: "Primeiro dia do congresso",
  settingsLabel_dates_end: "Último dia do congresso",
  settingsLabel_placeholder: "Indicar na página do congresso que é provisória",
  settingsLabel_rules_presenterCap_max: "Máximo de papéis principais e de apresentação por pessoa",
  settingsLabel_rules_bio_maxWords: "Máximo de palavras de uma biografia",
  settingsLabel_rules_reviewReminderDays:
    "Lembrete a quem revê: dias antes da entrega das revisões",
  settingsReminderDaysHint:
    "Opcional. Se ficar vazio, são {days} dias. Esses dias antes do dia de entrega das revisões, a partir das {hour} no fuso horário do congresso, cada pessoa que revê e ainda tem revisões por enviar recebe um email, salvo se o tiver desativado. Não é enviado nenhum lembrete enquanto não houver um dia fixado. Se alterar o dia depois, essas pessoas voltam a ser lembradas antes do novo, salvo se o lembrete desse dia já tiver sido enviado.",
  settingsLabel_type_name: "Nome",
  settingsLabel_type_description: "Descrição",
  settingsLabel_type_abstract_label: "Como se chama o resumo",
  settingsLabel_type_abstract_minWords: "Mínimo de palavras do resumo",
  settingsLabel_type_abstract_maxWords: "Máximo de palavras do resumo",
  settingsLabel_type_durationMinutes: "Minutos no programa",
  settingsLabel_type_team_min: "Mínimo de pessoas",
  settingsLabel_type_team_max: "Máximo de pessoas",
  settingsLabel_field_label: "Etiqueta",
  settingsLabel_field_help: "Texto de ajuda",
  settingsLabel_field_required: "Este campo é obrigatório",
  settingsLabel_field_maxWords: "Máximo de palavras",
  settingsLabel_field_min: "Número mais pequeno",
  settingsLabel_field_max: "Número maior",
  settingsLabel_field_integer: "Só números inteiros",
  settingsLabel_pool_name: "Nome",
  settingsLabel_pool_blindMode: "Como quem revê vê as pessoas autoras",
  settingsLabel_pool_reviewsPerSubmission: "Revisões por proposta",
  settingsLabel_pool_guidelines: "Orientações para quem revê",
  settingsLabel_criterion_label: "Etiqueta",
  settingsLabel_criterion_description: "Descrição",
  settingsCriterionDescriptionHint:
    "Opcional. O que este critério pergunta, ou o que significam a sua pontuação mais baixa e a mais alta. Quem revê lê isto por baixo do nome do critério no formulário de revisão.",
  settingsFormTitle: "O formulário de revisão",
  settingsFormIntro:
    "Por baixo das pontuações, o formulário de revisão desta comissão tem comentários para as pessoas autoras, uma nota apenas para a presidência e uma recomendação geral. Os seus nomes são os da aplicação. O que se escreve por baixo de cada um, os limites dos comentários, e se o formulário tem a nota e a recomendação, é a presidência que decide.",
  settingsLabel_form_comments_description:
    "Comentários para as pessoas autoras: o que se escreve por baixo do campo",
  settingsLabel_form_comments_minWords: "Comentários para as pessoas autoras: mínimo de palavras",
  settingsLabel_form_comments_maxWords: "Comentários para as pessoas autoras: máximo de palavras",
  settingsLabel_form_chairNote_enabled: "O formulário tem uma nota apenas para a presidência",
  settingsLabel_form_chairNote_description:
    "Nota apenas para a presidência: o que se escreve por baixo do campo",
  settingsLabel_form_recommendation_enabled:
    "O formulário pede uma recomendação geral: aceitar, com dúvidas ou rejeitar",
  settingsLabel_form_recommendation_description:
    "Recomendação: o que se escreve por baixo do seu nome",
  settingsFormDescriptionHint:
    "Opcional. Se ficar vazio, quem revê lê a frase padrão: «{standard}»",
  settingsFormDescriptionHintNone: "Opcional. Se ficar vazio, nada é escrito aí.",
  settingsReviewsDueHint:
    "Opcional. Quem revê vê este dia na sua lista. Não bloqueia nada: as revisões podem ser enviadas e alteradas enquanto o congresso estiver em revisão. Para não fixar nenhum dia, deixe a data vazia.",
  settingsDeadlineNone: "Não há nenhum dia fixado.",
  settingsLabel_criterion_min: "Pontuação mais baixa",
  settingsLabel_criterion_max: "Pontuação mais alta",
  settingsBlind_double:
    "Anónima: quem revê não vê quem são as pessoas autoras, nem as respostas marcadas como identificativas (por exemplo, uma ligação para a obra)",
  settingsBlind_single: "Quem revê vê os nomes e as instituições das pessoas autoras",
  settingsBlind_open: "Quem revê vê os nomes, as instituições e as biografias das pessoas autoras",
  settingsBlindHint:
    "Uma revisão anónima continua anónima depois de uma proposta ter sido atribuída a alguém para a rever, mesmo que essa pessoa seja retirada depois: a partir daí, já não pode ser alterada para mostrar as pessoas autoras.",
  settingsGuidelinesHint:
    "Opcional. Quem revê neste grupo vê este texto por cima de cada proposta que lhe é atribuída, no seu idioma se o tiver escrito nesse idioma e, se não, no idioma principal do congresso. As quebras de linha são mantidas.",
  settingsEmailsIntro:
    "A aplicação envia estes emails às pessoas de uma proposta, às pessoas que a presidência convida para rever ou para presidir, e a quem revê e a quem preside enquanto as propostas são revistas. Pode alterar a sua redação em inglês, espanhol e português. Cada caixa mostra o texto que é enviado: o texto padrão, até o alterar.",
  settingsEmailsNote:
    "Estão cá os três idiomas, sejam quais forem os do congresso, porque cada pessoa recebe o email no seu idioma: alguém pode ser convidado em português para um congresso que decorre em inglês e espanhol. Um idioma que não tenha alterado mantém o texto padrão. Estes textos não são privados: tal como o resto desta configuração, podem ser lidos por qualquer pessoa que possa ver o congresso. O email para entrar é igual para toda a gente e não pode ser alterado aqui.",
  settingsEmail_invitation: "Convite para uma proposta",
  settingsEmail_submission_received: "Recibo de uma proposta submetida",
  settingsEmail_submission_withdrawn: "Aviso de que uma proposta foi retirada",
  settingsEmail_invitation_withdrawn: "Aviso a quem tinha um convite para uma proposta retirada",
  settingsEmail_invitation_answered: "Resposta a um convite, para quem criou a proposta",
  settingsEmail_draft_deleted: "Aviso a quem tinha um convite para um rascunho eliminado",
  settingsEmail_reviewer_invitation: "Convite para rever",
  settingsEmail_chair_invitation: "Convite para presidir",
  settingsEmail_new_assignments: "Novas atribuições, para quem revê",
  settingsEmail_review_reminder: "Lembrete antes da entrega das revisões, para quem revê",
  settingsEmail_reviewer_declined: "Alguém não pode rever uma proposta, para a presidência",
  settingsEmail_reviews_complete: "Uma proposta tem todas as revisões, para a presidência",
  settingsEmailWhen_invitation:
    "É enviado a uma pessoa quando quem criou uma proposta a inclui nela, e outra vez se lhe voltar a enviar o convite. Essa pessoa ainda não aceitou nada.",
  settingsEmailWhen_submission_received:
    "É enviado a quem criou a proposta e a cada pessoa confirmada nela quando a proposta é submetida.",
  settingsEmailWhen_submission_withdrawn:
    "É enviado a quem criou a proposta, a cada pessoa confirmada nela e ao email de contacto do congresso quando uma proposta submetida é retirada.",
  settingsEmailWhen_invitation_withdrawn:
    "É enviado a quem tinha um convite para uma proposta e não tinha respondido, quando quem a criou a retira. Não pode nomear a proposta: essas pessoas não aceitaram nada.",
  settingsEmailWhen_invitation_answered:
    "É enviado a quem criou uma proposta quando uma pessoa convidada confirma ou recusa, ou quando alguém que participava sai.",
  settingsEmailWhen_draft_deleted:
    "É enviado a quem tinha um convite para um rascunho e não tinha respondido, quando quem o criou o elimina. Não pode nomear a proposta: essas pessoas não aceitaram nada.",
  settingsEmailWhen_reviewer_invitation:
    "É enviado a uma pessoa quando alguém da presidência a convida, na página Pessoas, para rever, e outra vez se o convite lhe for enviado de novo. Essa pessoa ainda não aceitou nada, por isso o email não nomeia ninguém: nem quem convida, nem o nome que essa pessoa escreveu para ela.",
  settingsEmailWhen_chair_invitation:
    "É enviado a uma pessoa quando alguém da presidência a convida, na página Pessoas, para presidir, e outra vez se o convite lhe for enviado de novo. Essa pessoa ainda não aceitou nada, por isso o email não nomeia ninguém: nem quem convida, nem o nome que essa pessoa escreveu para ela.",
  settingsEmailWhen_new_assignments:
    "É enviado a quem revê quando alguém da presidência lhe atribui propostas enquanto o congresso está em revisão, e pelas propostas atribuídas antes, quando estiver: um email por cada uma, um resumo por dia (a partir das {hour} no fuso horário do congresso) ou nenhum, conforme essa pessoa tiver escolhido em «A sua conta». Diz quantas propostas e nunca quais: não nomeia nenhuma proposta nem nenhuma pessoa autora.",
  settingsEmailWhen_review_reminder:
    "É enviado a cada pessoa que revê e tem revisões por enviar, a partir das {hour} no fuso horário do congresso, alguns dias antes do dia de entrega das revisões: {days} dias, salvo se fixar outro número entre os prazos. É enviado uma vez pelo dia que fixar. Não é enviado enquanto não houver um dia fixado, nem a quem tiver desativado os lembretes em «A sua conta».",
  settingsEmailWhen_reviewer_declined:
    "É enviado a quem preside ao congresso quando alguém diz que não pode rever uma proposta e a devolve: um email por cada uma, um resumo por dia (a partir das {hour} no fuso horário do congresso) ou nenhum, conforme cada pessoa da presidência tiver escolhido em «A sua conta». Não nomeia nenhuma proposta nem quem revê: quem a devolveu está na página da proposta. Ninguém da presidência recebe um sobre a sua própria proposta nem sobre uma com a qual tem um conflito.",
  settingsEmailWhen_reviews_complete:
    "É enviado a quem preside ao congresso quando uma proposta tem tantas revisões enviadas quantas a sua comissão pede: um email por cada uma, um resumo por dia (a partir das {hour} no fuso horário do congresso) ou nenhum, conforme cada pessoa da presidência tiver escolhido em «A sua conta». Não nomeia nenhuma proposta. Ninguém da presidência recebe um sobre a sua própria proposta nem sobre uma com a qual tem um conflito.",
  settingsEmailPlaceholders:
    "Pode pôr estas palavras, com as suas chavetas, no assunto e no texto. Cada uma é substituída quando o email é enviado:",
  settingsEmailPlaceholder_conference: "o título do congresso",
  settingsEmailPlaceholder_format: "o formato da proposta",
  settingsEmailPlaceholder_title: "o título da proposta",
  settingsEmailPlaceholder_deadline:
    "a data e a hora em que a chamada fecha, no fuso horário do congresso",
  settingsEmailPlaceholder_link: "a ligação para a proposta",
  settingsEmailPlaceholder_invitationLink:
    "a ligação onde a pessoa vê a proposta e confirma ou recusa",
  settingsEmailPlaceholder_roleInvitationLink:
    "o link onde a pessoa lê o convite e o aceita ou recusa",
  settingsEmailPlaceholder_committees:
    "os nomes dos grupos de revisão para os quais a pessoa é convidada, separados por vírgulas",
  settingsEmailPlaceholder_owner: "o nome de quem criou a proposta",
  settingsEmailPlaceholder_role: "o papel da pessoa na proposta",
  settingsEmailPlaceholder_person:
    "a pessoa que respondeu: o seu nome, ou o seu endereço, como o escreveu quem criou a proposta",
  settingsEmailPlaceholder_answer: "o que essa pessoa fez",
  settingsEmailPlaceholder_count: "de quantas trata o email",
  settingsEmailPlaceholder_count_new_assignments:
    "quantas propostas acabam de ser atribuídas a quem revê",
  settingsEmailPlaceholder_count_review_reminder: "quantas revisões quem revê ainda não enviou",
  settingsEmailPlaceholder_count_reviewer_declined: "quantas propostas foram devolvidas",
  settingsEmailPlaceholder_count_reviews_complete: "quantas propostas já têm todas as revisões",
  settingsEmailPlaceholder_due:
    "uma frase que diz quando são entregues as revisões, ou que a presidência não fixou um dia",
  settingsEmailPlaceholder_reason:
    "porque é que essa pessoa não a pode rever; num resumo, cada motivo que foi dado",
  settingsEmailPlaceholder_choices:
    "o link para as escolhas da pessoa sobre estes emails, em «A sua conta»",
  settingsEmailPlaceholder_reviewsLink: "o link para a lista de quem revê, «As minhas revisões»",
  settingsEmailPlaceholder_assignmentsLink: "o link para a página de atribuições do congresso",
  settingsEmailWords: "{language}: {words}",
  settingsEmailRequired: "O texto tem de a conter.",
  settingsEmailBodyOnly: "Não pode ficar no assunto.",
  settingsEmailRequiredBodyOnly: "O texto tem de a conter, e não pode ficar no assunto.",
  settingsEmailNameRule:
    "Tem de ser uma palavra à parte: só lhe podem tocar parênteses, aspas e a pontuação que fecha uma frase.",
  settingsLabel_message_subject: "Assunto",
  settingsLabel_message_body: "Texto",
  settingsEmailIsStandard: "Este é o texto padrão.",
  settingsEmailChanged: "Este não é o texto padrão.",
  settingsEmailUseStandard: "Usar o texto padrão",
  settingsEmailUseStandardFor: "Usar o texto padrão: {email}, {language}",
  settingsEmailUseStandardConfirm:
    "Substituir o que escreveu pelo texto padrão? Perde-se o que escreveu nestas duas caixas e ainda não guardou.",
  settingsEmailPreview: "O email tal como seria enviado, com nomes e títulos inventados:",
  settingsEmailSample_owner: "Ana Exemplo",
  settingsEmailSample_person: "Bruno Amostra",
  settingsEmailSample_title: "Um título inventado",
  settingsStandardText: "o texto padrão",
  settingsAgreementsIntro:
    "As pessoas aceitam-nos quando submetem uma proposta ou confirmam um convite. A aplicação regista que versão de cada acordo cada pessoa aceitou.",
  settingsAgreementHint:
    "Se alterar o que este acordo diz (o título, o texto ou a ligação), dê-lhe uma versão nova. Com uma versão nova, todas as pessoas que submetam uma proposta ou confirmem um convite a partir daí aceitam a nova. O que já foi aceite continua registado com a versão anterior. Não é enviado nenhum email, e as propostas já submetidas não são afetadas.",
  settingsLabel_agreement_title: "Título",
  settingsLabel_agreement_text: "Texto",
  settingsLabel_agreement_url: "Ligação",
  settingsLabel_agreement_version: "Versão",
  settingsAgreementTextHint:
    "Opcional se o acordo tiver uma ligação. As pessoas leem-no por baixo do título quando aceitam, no seu idioma se o tiver escrito nesse idioma e, se não, no idioma principal do congresso. As quebras de linha são mantidas.",
  settingsAgreementUrlHint:
    "Opcional se o acordo tiver um texto. Uma página que se pode abrir para ler o acordo. Começa por https://",
  settingsAgreementVersionHint:
    "Dá nome ao que as pessoas aceitam. Altere-a sempre que o título, o texto ou a ligação mudarem. Serve qualquer valor diferente da versão guardada: uma data como 2026-12, ou um número.",
  settingsQuotedTitle: "«{title}»",
  settingsWarnNewVersion:
    "Versão nova de {agreements}. Todas as pessoas que submetam uma proposta ou confirmem um convite a partir de agora aceitam a versão nova. O que já foi aceite continua registado com a anterior. Não é enviado nenhum email, e as propostas já submetidas não são afetadas. Quem tiver agora mesmo uma proposta ou um convite aberto tem de voltar a carregar a página antes de poder aceitar.",
  settingsLabel_other_name: "Nome",
  settingsLabel_other_description: "Descrição",
  settingsLabel_group_name: "Nome",
  settingsLabel_group_summary: "O que inclui",
  settingsLabel_track_name: "Nome",
  settingsLabel_topic_label: "Nome",
  settingsInLanguage: "{label} ({language})",
  settingsOptionalHint: "Opcional. Deixe vazio se não houver.",
  settingsNoMinimumHint: "Deixe vazio se não houver mínimo: o resumo só tem de existir.",
  settingsDeadlineDate: "Data",
  settingsDeadlineTime: "Hora",
  settingsDeadlineOffset: "Diferença para UTC",
  settingsDeadlineOffsetHint:
    "A diferença diz em que relógio é essa hora: -05:00 para Bogotá, -12:00 para «qualquer lugar do mundo». É guardada tal como a escreve.",
  settingsDeadlineIncomplete: "Ainda falta parte da data, da hora ou da diferença.",
  settingsReview: "Rever as alterações",
  settingsNothingChanged: "Nada foi alterado.",
  settingsUnsaved: "Valores alterados e ainda não guardados: {n}.",
  settingsReviewTitle: "Reveja as suas alterações",
  settingsReviewIntro: "Nada é guardado até carregar em «Guardar as alterações».",
  settingsChangeFromTo: "de «{before}» para «{after}»",
  settingsInstant: "{when} ({tz}), guardado como {stored}",
  settingsEmpty: "vazio",
  settingsYes: "sim",
  settingsNo: "não",
  settingsSave: "Guardar as alterações",
  settingsSaved: "Configuração guardada.",
  settingsSavedMore:
    "Configuração guardada. O que alterou enquanto era guardada continua no formulário, ainda por guardar.",
  settingsNotSaved: "Estas alterações não foram guardadas. Reveja outra vez as suas alterações.",
  settingsFixFirst: "Corrija o seguinte antes de guardar estas alterações:",
  settingsBlocked:
    "Estas alterações não podem ser guardadas. Propostas submetidas que deixariam de ser válidas: {count}.",
  settingsBlockedHelp:
    "O trabalho submetido tem de continuar válido. Escolha valores que todas as propostas submetidas cumpram, ou peça antes a quem as submeteu que as altere.",
  settingsBlockedReason: "{label}: {n}",
  settingsBlockedOpen: "Proposta {n}",
  settingsBlockedHidden:
    "Destas, {n} são suas ou tem um conflito com elas; outra pessoa da presidência pode abri-las.",
  settingsWarnDrafts:
    "Rascunhos que teriam um problema novo a resolver antes de poderem ser submetidos: {n}.",
  settingsWarnCloses:
    "Isto fecha a chamada assim que guardar: ninguém poderá iniciar, editar ou submeter uma proposta, nem confirmar um convite para uma.",
  settingsWarnOpens: "Isto abre a chamada assim que guardar.",
  settingsWarnPast: "«{deadline}» ficaria no passado.",
  settingsStale:
    "Outra pessoa alterou esta configuração desde que a abriu. Volte a carregá-la para continuar; o que escreveu continua no formulário.",
  settingsReload: "Voltar a carregar a configuração",
  settingsReloaded: "A configuração foi carregada de novo. Reveja outra vez as suas alterações.",
  issue_settings_required: "Isto é obrigatório.",
  issue_settings_default_language_required: "Escreva isto no idioma principal do congresso.",
  issue_settings_whole_number: "Escreva um número inteiro.",
  issue_settings_number_required: "Escreva um número.",
  issue_settings_too_small: "Escreva {min} ou mais.",
  issue_settings_too_big: "Escreva {max} ou menos.",
  issue_settings_email: "Escreva um endereço de email.",
  issue_settings_url: "Escreva um endereço web que comece por https://",
  issue_settings_date: "Escreva uma data.",
  issue_settings_datetime: "Escreva uma data, uma hora e uma diferença como -05:00.",
  issue_settings_min_over_max: "Não pode ser maior do que o valor máximo ao lado.",
  issue_settings_min_not_below_max: "Tem de ser menor do que a pontuação mais alta ao lado.",
  issue_settings_reviewers_assigned:
    "Já foram atribuídas pessoas para rever propostas que aqui são revistas de forma anónima. A elas e às pessoas autoras foi dito que a revisão é anónima, por isso não é possível mostrar agora quem são as pessoas autoras.",
  issue_settings_no_whole_number:
    "Não há nenhum número inteiro entre este valor e o máximo ao lado, por isso ninguém poderia responder.",
  issue_settings_deadline_order: "Não pode ser anterior ao prazo acima.",
  issue_settings_reviews_due_order:
    "As revisões são entregues depois do encerramento das submissões e antes do envio das decisões.",
  issue_settings_reviews_below_scale:
    "Revisões já enviadas com uma pontuação mais baixa do que esta: {n}. Uma revisão enviada continua válida, por isso a pontuação mais baixa não pode ficar acima de uma já dada.",
  issue_settings_reviews_above_scale:
    "Revisões já enviadas com uma pontuação mais alta do que esta: {n}. Uma revisão enviada continua válida, por isso a pontuação mais alta não pode ficar abaixo de uma já dada.",
  issue_settings_reviews_have_scores:
    "Revisões já enviadas que pontuam um critério que isto retiraria: {n}. Uma revisão enviada continua válida.",
  issue_settings_reviews_too_short:
    "Revisões já enviadas cujos comentários têm menos palavras do que estas: {n}. Uma revisão enviada continua válida.",
  issue_settings_reviews_too_long:
    "Revisões já enviadas cujos comentários têm mais palavras do que estas: {n}. Uma revisão enviada continua válida.",
  issue_settings_reviews_have_note:
    "Revisões já enviadas que têm uma nota para a presidência: {n}. A nota não pode ser retirada do formulário enquanto uma revisão enviada tiver uma.",
  issue_settings_reviews_have_recommendation:
    "Revisões já enviadas que dão uma recomendação: {n}. Não pode ser retirada do formulário enquanto uma revisão enviada tiver uma.",
  issue_settings_reviews_sent:
    "Já foram enviadas revisões de propostas neste formato: {n}. Responderam ao formulário da comissão que o revê agora.",
  issue_settings_reviews_hidden:
    "Foi submetida a esta comissão uma proposta sua, ou uma com que tem um conflito, e o congresso já esteve em revisão. Se essa proposta tem revisões, e o que dizem, não lhe cabe saber, por isso também não lhe cabe restringir o formulário em que são escritas. Pode fazer esta alteração uma pessoa da presidência que não tenha uma proposta sua perante esta comissão nem um conflito com alguma. Se não houver nenhuma, convide uma na página Pessoas.",
  issue_settings_dates_order: "O último dia não pode ser anterior ao primeiro.",
  issue_settings_final_before_conference:
    "Os materiais finais têm de ser entregues antes de o congresso começar.",
  issue_settings_message_empty: "Escreva o texto, ou escolha «Usar o texto padrão».",
  issue_settings_message_not_one_line: "Um assunto é uma só linha. Retire as quebras de linha.",
  issue_settings_message_too_long: "É demasiado longo. Use {max} caracteres ou menos.",
  issue_settings_message_unknown_placeholder:
    "Este email não tem nada para pôr no lugar de {names}. Use apenas as palavras entre chavetas da lista acima, ou retire as chavetas.",
  issue_settings_message_not_in_subject: "O assunto não pode conter {names}. Só o texto.",
  issue_settings_message_missing_placeholder: "O texto tem de conter {names}.",
  issue_settings_message_link_touched:
    "Ponha um espaço ou uma quebra de linha antes e depois de {names}. O que tocar na ligação passaria a fazer parte do seu endereço.",
  issue_settings_agreement_version_required:
    "Alterou o que este acordo diz. As pessoas aceitaram o texto anterior com esta versão, por isso escreva uma versão nova.",
  issue_settings_agreement_needs_text_or_link: "Um acordo precisa de um texto ou de uma ligação.",
  issue_settings_too_long: "É demasiado longo. Use {max} caracteres ou menos.",
  issue_settings_message_name_touched:
    "{names} representa um nome que uma pessoa escreveu, por isso tem de ser uma palavra à parte. Ponha um espaço antes e depois. Só lhe podem tocar parênteses, aspas e a pontuação que fecha uma frase: qualquer outra coisa poderia transformar o nome em parte de uma ligação ou de um endereço.",
  issue_settings_message_invisible:
    "Este texto tem caracteres invisíveis, que podem esconder ou reordenar palavras. Escreva-o de novo, ou cole-o como texto simples.",
  issue_settings_invalid: "Verifique este valor.",
};
