# Pulse Assessment - Architecture & Logic Diagrams

Diagramas em **Mermaid** cobrindo a logica do app v2.5.5. Visualizam no GitHub, GitLab, VS Code (preview), Obsidian, ou qualquer renderer Markdown.

Para exportar como imagem: `npx @mermaid-js/mermaid-cli -i ARCHITECTURE-DIAGRAM.md -o diagram.png`.

---

## 1. Visao geral - fluxo do usuario

Do clique em "Run Assessment" ao radar final.

```mermaid
flowchart TD
    A([User opens Pulse]) --> B{Has saved<br/>snapshot?}
    B -->|Yes| C[Show last snapshot<br/>+ radar]
    B -->|No| D[Idle state<br/>capability picker]
    C --> E[User clicks Run]
    D --> E
    E --> F[useCoverageData.start]
    F --> G[Detect Scale Tier]
    G --> H[Build DQL queries<br/>scaleQuery for each criterion]
    H --> I{Cache hit?}
    I -->|Yes| J[Reuse cached result<br/>0 GB scanned, $0]
    I -->|No| K[Execute DQL<br/>via SDK queryExecutionClient]
    K --> L[Record perf<br/>bytes, ms, records]
    J --> M[Compute criterion<br/>numerator / denominator x 100]
    L --> M
    M --> N[Compare vs thresholds<br/>pass = 1, fail = 0]
    N --> O[Aggregate per capability]
    O --> P[Compute Coverage score<br/>pass / total x 100]
    O --> Q[Compute Utilization score<br/>weighted by tier]
    P --> R[Render radar + cards]
    Q --> R
    R --> S[Save snapshot to<br/>Document Store]
    R --> T[DPS cost badge<br/>USD per GB scanned]

    style F fill:#3B82F6,color:#fff
    style I fill:#10B981,color:#fff
    style M fill:#8B5CF6,color:#fff
    style P fill:#F59E0B,color:#fff
    style Q fill:#EC4899,color:#fff
    style T fill:#06B6D4,color:#fff
```

---

## 2. Camadas da aplicacao

Como o codigo se organiza por responsabilidade.

```mermaid
flowchart LR
    subgraph UI["Presentation"]
        direction TB
        APP[App.tsx<br/>routes + ErrorBoundary]
        PAGES[pages/<br/>CoverageAssessment<br/>ComparisonPage]
        COMP[components/<br/>TechRadar - canvas<br/>CapabilityCards<br/>DpsCostBadge<br/>ScaleTierBanner]
    end

    subgraph HOOKS["Hooks - state + side effects"]
        direction TB
        UCD[useCoverageData<br/>orchestrates queries]
        UST[useScaleTier<br/>auto-detects host count]
        UDM[useDevMode<br/>SE gating ?dev=1]
        UAH[useAssessmentHistory<br/>Document Store CRUD]
    end

    subgraph LOGIC["Domain logic"]
        direction TB
        QRY[queries.ts<br/>~94 criteria + thresholds]
        TIERS[criterionTiers.ts<br/>tier classification]
        ST[scale-tier.ts<br/>tier decision rules]
        UTIL[utils/colors.ts<br/>SCORE_BANDS]
    end

    subgraph PERF["Performance"]
        direction TB
        CACHE[queryCache.ts<br/>24h Doc Store cache]
        REPORT[buildReport.ts<br/>perf JSON export]
        TYPES[types.ts<br/>PerfReport schema]
    end

    subgraph SDK["Dynatrace SDKs"]
        direction TB
        QEC[queryExecutionClient<br/>DQL -> Grail]
        DOC[client-document<br/>persistence]
    end

    UI --> HOOKS
    HOOKS --> LOGIC
    HOOKS --> PERF
    HOOKS --> SDK
    PERF --> SDK

    style UI fill:#3B82F615
    style HOOKS fill:#8B5CF615
    style LOGIC fill:#10B98115
    style PERF fill:#F59E0B15
    style SDK fill:#EC489915
```

---

## 3. Como cada criterio vira um numero

A operacao basica que se repete 94 vezes.

```mermaid
flowchart TD
    A[Criterion def<br/>id, label, query, queryB,<br/>thresholds, tier] --> B{Has queryB<br/>or denominatorConstant?}

    B -->|queryB| C[Execute query A<br/>via DQL]
    B -->|queryB| D[Execute query B<br/>via DQL]
    B -->|constant| C2[Execute query A]
    B -->|constant| E[denominator =<br/>code-level constant]
    B -->|no| F[Execute query A<br/>result IS the %]

    C --> G[valueA = result]
    D --> H[denom = result]
    C2 --> G2[valueA = result]
    E --> H2[denom = constant]
    F --> I[value = result]

    G --> J{denom > 0?}
    H --> J
    G2 --> J2{denom > 0?}
    H2 --> J2

    J -->|Yes| K[value = valueA / denom x 100<br/>capped at 100]
    J -->|No| L[Smart skip C3<br/>value = 0, skipped flag]
    J2 -->|Yes| K2[value = valueA / denom x 100]
    J2 -->|No| L

    K --> M[Compare vs thresholds<br/>e.g. ≥90 ≥50 ≥1]
    K2 --> M
    I --> M
    L --> N[points = 0, error = false]

    M --> O{Threshold met?}
    O -->|Yes| P[points = 1<br/>passed]
    O -->|No| Q[points = 0<br/>not met]

    P --> R[CriterionResult]
    Q --> R
    N --> R

    style A fill:#3B82F6,color:#fff
    style M fill:#8B5CF6,color:#fff
    style P fill:#10B981,color:#fff
    style Q fill:#EF4444,color:#fff
    style L fill:#F59E0B,color:#fff
```

**Exemplo real (i1 - Host CPU coverage):**

```
query  = timeseries val=avg(dt.host.cpu.usage), by:{dt.entity.host}
         | dedup dt.entity.host | summarize c=count()
queryB = fetch dt.entity.host | summarize count()

valueA = 87 (hosts com metrica de CPU)
denom  = 100 (total de hosts)
value  = 87 / 100 x 100 = 87%

thresholds = [{min: 90}, {min: 50}, {min: 1}]
87 >= 50 (passou threshold "medio") -> points = 1
```

---

## 4. Coverage vs Utilization - dois caminhos de agregacao

Mesmos 94 criterios, duas formulas diferentes.

```mermaid
flowchart TD
    A[Capability com<br/>N criterios] --> B[Cada criterio:<br/>points = 0 ou 1]

    B --> C[Classifica por tier<br/>via CRITERION_TIERS]
    C --> D[Foundation<br/>~3-4 criterios]
    C --> E[Best Practice<br/>~4-5 criterios]
    C --> F[Excellence<br/>~2-3 criterios]

    B -.-> G[COVERAGE SCORE]
    G --> H[passed = sum points]
    H --> I[score = passed / N x 100]
    I --> J[Renderiza no RADAR]

    D --> K[fPct = passed/total]
    E --> L[bPct = passed/total]
    F --> M[ePct = passed/total]

    K --> N{fPct ≥ 0.8?}
    N -->|Yes| O[effB = bPct]
    N -->|No| P[effB = 0]

    O --> Q{effB ≥ 0.6?}
    P --> Q
    Q -->|Yes| R[effE = ePct]
    Q -->|No| S[effE = 0]

    R --> T[utilizationScore =<br/>fPct x 60 +<br/>effB x 25 +<br/>effE x 15]
    S --> T

    T --> U[Utilization Band<br/>≥80 Excellent<br/>≥60 Good<br/>≥40 Moderate<br/>≥20 Low<br/>&lt;20 N/A]
    T --> V[Utilization Level<br/>L0/L1/L2/L3]

    K --> V
    L --> V
    M --> V

    V --> W[Renderiza nos CARDS]
    U --> W

    style G fill:#3B82F6,color:#fff
    style T fill:#EC4899,color:#fff
    style N fill:#F59E0B,color:#fff
    style Q fill:#F59E0B,color:#fff
    style J fill:#10B981,color:#fff
    style W fill:#10B981,color:#fff
```

**Regra progressiva** (chave da formula): Best Practice so conta se Foundation >= 80%. Excellence so conta se Best Practice >= 60%. Isso evita que cliente "pule passos" e tenha utilization inflada por criterios avancados sem ter o basico.

---

## 5. Decisao de Scale Tier (auto-detect)

Como o app decide rodar queries leves ou caras.

```mermaid
flowchart TD
    A[useScaleTier hook<br/>inicia no boot] --> B[Query rapida:<br/>fetch dt.entity.host<br/>summarize count]
    B --> C[hostCount conhecido]

    C --> D{Manual override<br/>via URL ?tier=?}
    D -->|Yes| E[tier = override<br/>autoTier = false]
    D -->|No| F{hostCount < 1000?}

    F -->|Yes| G[tier = exact<br/>autoTier = true]
    F -->|No| H{hostCount < 10000?}
    H -->|Yes| I[tier = large<br/>autoTier = true]
    H -->|No| J[tier = xlarge<br/>autoTier = true]

    E --> K[scaleQuery applies tier]
    G --> K
    I --> K
    J --> K

    K --> L{tier == exact?}
    L -->|Yes| M[Query unchanged<br/>full window, no scanLimit]

    K --> N{tier == large?}
    N -->|Yes| O[Add scanLimitGBytes: 500<br/>Narrow window where applicable]

    K --> P{tier == xlarge?}
    P -->|Yes| Q[Add scanLimitGBytes: 100<br/>Narrow window aggressively<br/>Show ≈ prefix in UI]

    M --> R[Execute DQL]
    O --> R
    Q --> R

    R --> S[Render ScaleTierBanner<br/>shows tier + host count<br/>warning if sampling active]

    style A fill:#3B82F6,color:#fff
    style F fill:#F59E0B,color:#fff
    style H fill:#F59E0B,color:#fff
    style J fill:#EF4444,color:#fff
    style S fill:#06B6D4,color:#fff
```

**Por que importa**: rodar o assessment inteiro contra um tenant de 80k hosts em modo `exact` escanearia ~10 TB e custaria ~$100 por execucao. xLarge tier cai para ~$20-30 com sampling estatistico (ainda preciso suficiente para o score).

---

## 6. Cache de queries (24h)

Por que rodar de novo se nada mudou no Grail?

```mermaid
flowchart TD
    A[executeAllUnique<br/>recebe 94 queries] --> B[Para cada query]
    B --> C[hash = FNV-32 do DQL]
    C --> D[cacheKey =<br/>tier:hash:windowHours]

    D --> E{Tem em<br/>memoria?}
    E -->|Yes| F[Return cached]
    E -->|No| G{Tem no<br/>Document Store?}

    G -->|Yes| H[Load + cache memoria<br/>cacheHit++]
    G -->|No| I[Execute DQL<br/>cacheMiss++]

    H --> J[ageMs < 24h?]
    J -->|Yes| K[Use cached<br/>scannedBytes = 0]
    J -->|No| I

    I --> L[Result obtido]
    L --> M[Store em memoria]
    L --> N[Enqueue persist]

    F --> O[Aggregate result]
    K --> O
    M --> O

    N -.-> P[Apos run termina:<br/>persistentCache.flush]
    P --> Q[Batch write ao<br/>Document Store]

    O --> R[Score computation]

    style E fill:#10B981,color:#fff
    style G fill:#10B981,color:#fff
    style I fill:#EF4444,color:#fff
    style K fill:#10B981,color:#fff
```

**Numeros reais (v2.5.5, reference tenant, medidos em `dt.system.events`)**:
- Cold run **antes** do Economy Mode: ~370 GB scanned, ~$3.70
- Cold run **com** Economy Mode: ~41 GB scanned, ~$0.41
- Warm run (cache 24h): 0 GB scanned, $0
- Score: identico entre cold e warm; com Economy Mode os valores viram
  estimativas proximas (razoes +-1,5 pp, contagens distintas ~6% menores)

---

## 7. Estrutura de dados das 9 capabilities

Hierarquia completa do dominio.

```mermaid
flowchart TD
    A[CAPABILITIES array<br/>9 capabilities] --> B1[1. Infrastructure<br/>22 criteria<br/>color #3B82F6]
    A --> B2[2. Application Obs<br/>13 criteria<br/>color #8B5CF6]
    A --> B3[3. Digital Experience<br/>11 criteria<br/>color #EC4899]
    A --> B4[4. Log Analytics<br/>8 criteria<br/>color #F59E0B]
    A --> B5[5. App Security<br/>5 criteria<br/>color #EF4444]
    A --> B6[6. Threat Obs<br/>4 criteria<br/>color #F97316]
    A --> B7[7. AI Observability<br/>9 criteria<br/>color #06B6D4]
    A --> B8[8. Business Obs<br/>4 criteria<br/>color #10B981]
    A --> B9[9. Software Delivery<br/>5 criteria<br/>color #6366F1]

    B1 --> C[Cada criterio]
    B2 --> C
    B3 --> C
    B7 --> C

    C --> D[id: a1, i12, ...]
    C --> E[label: human-readable]
    C --> F[description: tooltip]
    C --> G[query: DQL numerator]
    C --> H[queryB ou denominatorConstant]
    C --> I[thresholds array]
    C --> J[tier: foundation/<br/>bestPractice/excellence]

    style A fill:#1B3A8A,color:#fff
    style C fill:#8B5CF6,color:#fff
```

**Total**: ~94 criterios, mas executa apenas as **queries unicas** (dedup por hash) - tipicamente ~70 queries efetivas porque muitos criterios reusam o mesmo denominador.

---

## 8. Persistencia e historico

Onde os dados vivem.

```mermaid
flowchart LR
    subgraph CLIENT[Browser - React App]
        S[useState<br/>resultado atual]
        H[useAssessmentHistory<br/>snapshots]
        QC[QueryCache<br/>memoria]
    end

    subgraph DT[Dynatrace platform]
        DS[Document Store<br/>app-scoped]
        GRAIL[Grail<br/>logs/spans/metrics/<br/>events/entities]
    end

    QC <--->|hit/miss| DS
    H <--->|load/save| DS
    S -->|run starts| Q[DQL exec]
    Q -->|fetch from| GRAIL
    Q -->|results| S
    S -->|user saves| H

    DS -.contains.-> QC_CACHE[Cache entries<br/>name: cache:tier:hash<br/>24h TTL]
    DS -.contains.-> SNAPSHOTS[Snapshots<br/>name: snapshot:&lt;ts&gt;<br/>full result + scores]

    style GRAIL fill:#EC4899,color:#fff
    style DS fill:#3B82F6,color:#fff
    style CLIENT fill:#10B98115
    style DT fill:#F59E0B15
```

**Scopes necessarios** (em `app.config.json`):
- `storage:*:read` - acesso a Grail (logs, spans, events, metrics, entities, bizevents, buckets, system)
- `document:documents:read/write/delete` - cache e snapshots

---

## 9. Producao vs SE/Dev (gating)

O que cliente ve vs SE.

```mermaid
flowchart TD
    A[App loads] --> B[useDevMode hook]
    B --> C{?dev=1<br/>ou<br/>localStorage.cca.dev?}

    C -->|Yes| D[isDev = true<br/>SE Mode]
    C -->|No| E[isDev = false<br/>Customer Mode]

    D --> F[Mostra TUDO:]
    F --> F1[Radar + cards]
    F --> F2[ScaleTierBanner]
    F --> F3[DPS cost badge]
    F --> F4[Download Perf JSON]
    F --> F5[Force Refresh button]
    F --> F6[Export PDF report]

    E --> G[Mostra customer-friendly:]
    G --> G1[Radar + cards]
    G --> G2[ScaleTierBanner]
    G --> G3[DPS cost badge]
    G --> G6[Export PDF report]
    G -.X.-> G4[NO Perf JSON]
    G -.X.-> G5[NO Force Refresh]

    style D fill:#F59E0B,color:#fff
    style E fill:#10B981,color:#fff
    style F4 fill:#EF4444,color:#fff
    style F5 fill:#EF4444,color:#fff
```

---

## 10. Resumo - o fluxo em uma frase

```mermaid
flowchart LR
    A[~94 criteria DQL] --> B[Scale Tier<br/>auto-sample]
    B --> C[Cache 24h<br/>doc store]
    C --> D[Execute on Grail]
    D --> E[ratio = A/B x 100]
    E --> F[pass / fail vs threshold]
    F --> G[Coverage avg]
    F --> H[Utilization tier-weighted]
    G --> I[Radar UI]
    H --> I

    style A fill:#3B82F6,color:#fff
    style B fill:#F59E0B,color:#fff
    style C fill:#10B981,color:#fff
    style D fill:#EC4899,color:#fff
    style I fill:#8B5CF6,color:#fff
```

> **Em uma linha:** *94 razoes DQL contra o proprio tenant, sampled por tier, cacheadas 24h, comparadas a thresholds hardcoded, agregadas como media (coverage) ou ponderacao progressiva (utilization).*

---

## Como visualizar / exportar

1. **GitHub / GitLab** - abre nativo, ja renderiza
2. **VS Code** - extensao "Markdown Preview Mermaid Support" (id: `bierner.markdown-mermaid`)
3. **Obsidian** - nativo, copia o MD para o vault
4. **Exportar PNG/SVG**:
   ```bash
   npm i -g @mermaid-js/mermaid-cli
   mmdc -i docs/ARCHITECTURE-DIAGRAM.md -o docs/diagrams/ -e png
   ```
5. **Online** - cole em https://mermaid.live para editar interativamente

Versao: v2.5.5 | Atualize quando mudar regras de Scale Tier / Economy Mode, formula de utilization, ou estrutura de capabilities.
