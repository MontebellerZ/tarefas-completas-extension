# 📊 Métricas do Usuário Azure

Extensão para o **Google Chrome** e o **Microsoft Edge** que transforma o acompanhamento do seu time no **Azure DevOps** em algo muito mais fácil e visual. Em vez de abrir várias abas e fazer cálculos manuais, tudo fica acessível num clique direto pela barra do navegador.

---

## 🚀 O que ela faz

Com ela você acompanha, em tempo real, o andamento das sprints, as horas lançadas, as mudanças recentes nos itens de trabalho e os problemas críticos que precisam de atenção — tudo com suporte a múltiplos perfis de visualização adaptados para diferentes papéis no time.

---

## ✅ Pré-requisitos

- Google Chrome **ou** Microsoft Edge instalado
- Acesso ao [Azure DevOps](https://dev.azure.com) da sua organização
- Um **Personal Access Token (PAT)** com permissão de leitura em Work Items, Iterations e Teams

---

## 🔧 Instalação

1. Faça o download ou clone este repositório

**No Google Chrome:**

2. Acesse `chrome://extensions`
3. Ative o **Modo do desenvolvedor** (canto superior direito)
4. Clique em **Carregar sem compactação** e selecione a pasta do projeto

**No Microsoft Edge:**

2. Acesse `edge://extensions`
3. Ative o **Modo do desenvolvedor** (menu lateral esquerdo)
4. Clique em **Carregar sem compactação** e selecione a pasta do projeto

---

O ícone da extensão aparecerá na barra do navegador após carregar.

---

## ⚙️ Configuração inicial

1. Clique no ícone da extensão e acesse as **configurações** (ícone de engrenagem)
2. Escolha o **perfil** desejado: **Analista**, **Testes** ou **Gerência**
3. Adicione um token PAT com nome e valor
4. Selecione a **organização**, o **projeto** e o **time** correspondentes
5. Configure o **mapeamento de status**: arraste os chips de status para as regiões corretas (Andamento, Validando, Finalizadas)
6. Salve as configurações

---

## 🖥️ Como usar

Após configurar, clique no ícone da extensão. A tela principal exibirá automaticamente as métricas da sprint atual. Você pode:

- **Trocar de sprint** pelo seletor no topo
- **Atualizar os dados** pelo botão de refresh
- **Clicar em qualquer métrica** para ver a lista detalhada dos itens daquele status
- **Acessar alterações recentes** ou **análises críticas** pelos botões da tela principal (perfis Analista e Gerência)
- Filtrar por analista específico (perfil Gerência)

---

## 👤 Perfis de visualização

A extensão possui três perfis com layouts e dados adaptados para cada papel:

### 🔵 Analista
Foco no desempenho individual. Mostra as métricas pessoais da sprint, as horas lançadas, a média diária com feedback visual por emoji e os itens recentes ou com pendências críticas. Permite executar a análise crítica de um item com @mention do responsável diretamente pela extensão.

### 🟢 Testes
Foco no acompanhamento de releases e QA. Exibe os itens pendentes e liberados por dia em um gráfico de barras, sem controles irrelevantes para o fluxo de testes.

### 🟠 Gerência
Visão completa do time. Além das métricas consolidadas, mostra o breakdown de horas por analista com gráfico de barras horizontal e permite filtrar os dados por membro do time. Possibilita gerar um comentário no card do Azure DevOps para lembrar o analista de realizar a análise crítica.

---

## 📋 Funcionalidades

A tabela abaixo lista todas as funcionalidades da extensão e os perfis que têm acesso a cada uma delas.

> ✅ = disponível &nbsp;&nbsp; ❌ = não disponível

| Funcionalidade | Analista | Testes | Gerência |
|---|:---:|:---:|:---:|
| Métricas do sprint por status | ✅ | ✅ | ✅ |
| Total de tarefas iniciadas na sprint | ✅ | ✅ | ✅ |
| Total de horas lançadas na sprint | ✅ | ❌ | ✅ |
| Média diária de horas lançadas | ✅ | ❌ | ✅ |
| Indicador de capacidade configurada | ✅ | ❌ | ✅ |
| Feedback visual com emoji (baseado na média diária) | ✅ | ❌ | ❌ |
| Seletor de sprint (atual e anteriores) | ✅ | ✅ | ✅ |
| Toggle "Incluir dia atual" no cálculo de média | ✅ | ❌ | ✅ |
| Clicar em métrica para ver lista de itens | ✅ | ✅ | ✅ |
| Listagem de alterações recentes desde o último dia útil | ✅ | ❌ | ✅ |
| Listagem de análises críticas pendentes (bugs + tarefas extrapoladas) | ✅ | ❌ | ✅ |
| Executar análise crítica com @mention do responsável | ✅ | ❌ | ❌ |
| Gerar comentário no card para lembrar analista de fazer análise | ❌ | ❌ | ✅ |
| Gráfico de releases por dia (itens liberados) | ❌ | ✅ | ❌ |
| Breakdown de horas lançadas por analista | ❌ | ❌ | ✅ |
| Gráfico de barras de horas por analista | ❌ | ❌ | ✅ |
| Filtro por analista específico | ❌ | ❌ | ✅ |
| Filtro de usuário na listagem de alterações recentes | ❌ | ❌ | ✅ |
| Ver detalhes de um item (tipo, estado, responsável, descrição) | ✅ | ✅ | ✅ |
| Abrir item diretamente no Azure DevOps | ✅ | ✅ | ✅ |
| Paginação de listagens (10 / 20 / 40 itens por página) | ✅ | ✅ | ✅ |
| Gerenciar tokens PAT (adicionar, excluir, selecionar) | ✅ | ✅ | ✅ |
| Múltiplos tokens com configurações independentes | ✅ | ✅ | ✅ |
| Configurar organização, projeto e time por token | ✅ | ✅ | ✅ |
| Mapeamento dinâmico de status por projeto e perfil | ✅ | ✅ | ✅ |
| Arrastar e soltar chips de status entre regiões | ✅ | ✅ | ✅ |
| Personalizar cor de cada status individualmente | ✅ | ✅ | ✅ |
| Alternância de perfil com persistência | ✅ | ✅ | ✅ |
| Cache automático com TTL por tipo de dado | ✅ | ✅ | ✅ |
| Suporte a tipos de item: Task e Bug | ✅ | ✅ | ✅ |
| Detecção de bugs pendentes de análise (últimas 3 sprints) | ✅ | ❌ | ✅ |
| Detecção de tarefas com horas extrapoladas (últimas 3 sprints) | ✅ | ❌ | ✅ |
