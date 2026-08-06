# Pulse Assessment - Scoring Calculations (Coverage & Utilization)

Diagramas Mermaid detalhados explicando **exatamente como** Coverage e Utilization sao calculados, com exemplos numericos reais.

Source-of-truth do codigo:
- `ui/app/queries.ts` (linhas 284-286) - weights
- `ui/app/data/criterionTiers.ts` - classificacao por tier
- `ui/app/hooks/useCoverageData.ts` (linhas 706-766) - formula
- `ui/app/hooks/useCoverageData.ts` (linhas 852-870) - agregacao final

Versao: v2.5.5

---

## 1. Como um criterio vira 0 ou 1 (passo basico)

Cada um dos ~94 criterios passa pelo mesmo pipeline. O resultado e binario: **passou ou nao passou**.

```mermaid
flowchart TD
    A[Criterion definition<br/>id, query, queryB, thresholds] --> B[Execute DQL]
    B --> C{Has<br/>denominator?}

    C -->|queryB exists| D[Run queryB<br/>get denom]
    C -->|denominatorConstant| E[Use code-level constant]
    C -->|no denom| F[query result<br/>IS the percentage]

    D --> G{denom > 0?}
    E --> G

    G -->|Yes| H[value = numerator / denom x 100<br/>capped at 100]
    G -->|No| I[Smart-skip C3<br/>value = 0<br/>flagged as skipped]

    F --> J[value already a percentage]
    H --> J
    I --> J

    J --> K[Compare vs thresholds<br/>e.g. ≥90 ≥50 ≥1]
    K --> L{Meets ANY<br/>threshold?}

    L -->|Yes| M[points = 1<br/>PASSED]
    L -->|No| N[points = 0<br/>FAILED]

    M --> O[CriterionResult<br/>id, value, points, tier]
    N --> O

    style A fill:#3B82F6,color:#fff
    style K fill:#8B5CF6,color:#fff
    style M fill:#10B981,color:#fff
    style N fill:#EF4444,color:#fff
    style I fill:#F59E0B,color:#fff
```

**Exemplo concreto - criterio i1 (Host CPU coverage):**

```
numerator query = timeseries val=avg(dt.host.cpu.usage), by:{dt.entity.host}
                  | dedup | summarize c=count()
                  -> returns 87 (hosts com metrica de CPU)

denominator query = fetch dt.entity.host | summarize count()
                    -> returns 100 (total de hosts)

value = 87 / 100 x 100 = 87%

thresholds = [{min: 90}, {min: 50}, {min: 1}]
             87 >= 50  -> meets threshold "medio"
             -> points = 1 (PASSED)
```

---

## 2. Coverage Score (formula simples)

A **media de criterios que passaram**, sem peso. E o numero que aparece no radar.

```mermaid
flowchart TD
    A[Capability com N criterios<br/>cada um com points 0 ou 1] --> B[passed = sum points<br/>quantos passaram]

    B --> C[coverage =<br/>passed / N x 100]

    C --> D[Round para inteiro]
    D --> E[Capability.score 0-100]

    E --> F[Renderiza no RADAR<br/>com cor da banda<br/>N/A Low Moderate Good Excellent]

    style A fill:#3B82F6,color:#fff
    style C fill:#8B5CF6,color:#fff
    style E fill:#10B981,color:#fff
    style F fill:#F59E0B,color:#fff
```

**Exemplo - Infrastructure Observability (22 criterios):**

```
Suponha que 14 dos 22 criterios passaram threshold:

coverage = 14 / 22 x 100
         = 63.6%
         -> Math.round(63.6) = 64

banda: "Good" (60-80)
cor radar: #5EB1A9
```

---

## 3. Utilization Score (formula ponderada progressiva)

Mesmos criterios, mas **agrupa em 3 tiers** e aplica **pesos com gates progressivos**.

### 3.1 Tier classification

Cada criterio e classificado em um dos 3 tiers em `criterionTiers.ts`:

```mermaid
flowchart LR
    A[~94 criteria] --> B[CRITERION_TIERS map<br/>id -> tier]

    B --> F[Foundation<br/>~30% dos criteria<br/>essencial]
    B --> P[Best Practice<br/>~45% dos criteria<br/>adocao mais profunda]
    B --> E[Excellence<br/>~25% dos criteria<br/>uso avancado]

    F --> Fex["i1 Host CPU<br/>i2 Host memory<br/>a1 Service tracing<br/>d1 RUM action<br/>l1 Host logs"]
    P --> Pex["i3 Host disk<br/>a2 Service method<br/>d7 Synthetic HTTP<br/>l7 Error logs"]
    E --> Eex["i7 K8s cluster<br/>a4 OTel<br/>d11 Synthetic avail<br/>s5 OWASP"]

    style F fill:#3B82F6,color:#fff
    style P fill:#F59E0B,color:#fff
    style E fill:#EC4899,color:#fff
```

### 3.2 Calculo dos percentuais por tier

Para cada capability, conte quantos passaram em cada tier.

```mermaid
flowchart TD
    A[Criterion results<br/>com tier + points] --> B[Particiona por tier]

    B --> F1[Foundation criteria]
    B --> P1[Best Practice criteria]
    B --> E1[Excellence criteria]

    F1 --> F2[fTotal = count<br/>fPassed = passed count]
    P1 --> P2[pTotal = count<br/>pPassed = passed count]
    E1 --> E2[eTotal = count<br/>ePassed = passed count]

    F2 --> F3[fPct = fPassed / fTotal<br/>0.0 to 1.0]
    P2 --> P3[bPct = pPassed / pTotal<br/>0.0 to 1.0]
    E2 --> E3[ePct = ePassed / eTotal<br/>0.0 to 1.0]

    F3 --> G[Apply progressive gates]
    P3 --> G
    E3 --> G

    style F1 fill:#3B82F6,color:#fff
    style P1 fill:#F59E0B,color:#fff
    style E1 fill:#EC4899,color:#fff
    style G fill:#10B981,color:#fff
```

### 3.3 Gates progressivos (a magica)

Esta e a **regra-chave** que diferencia Utilization de uma simples media ponderada. BP e Excellence so contam se os anteriores estiverem solidos.

```mermaid
flowchart TD
    A[fPct, bPct, ePct] --> B{fPct >= 0.8?}

    B -->|Yes - foundation solida| C[effB = bPct<br/>BP CONTA]
    B -->|No - foundation fraca| D[effB = 0<br/>BP zerado]

    C --> E{effB >= 0.6?}
    D --> E

    E -->|Yes - BP solido| F[effE = ePct<br/>Excellence CONTA]
    E -->|No - BP fraco| G[effE = 0<br/>Excellence zerado]

    F --> H[utilizationScore =<br/>fPct x 60 +<br/>effB x 25 +<br/>effE x 15]
    G --> H

    H --> I[Round para inteiro 0-100]

    I --> J[Banda<br/>≥80 Excellent<br/>≥60 Good<br/>≥40 Moderate<br/>≥20 Low<br/>&lt;20 N/A]

    style B fill:#F59E0B,color:#fff
    style E fill:#F59E0B,color:#fff
    style D fill:#EF4444,color:#fff
    style G fill:#EF4444,color:#fff
    style H fill:#8B5CF6,color:#fff
    style J fill:#10B981,color:#fff
```

**Por que esses gates?** Porque um cliente pode acidentalmente passar em criterios Excellence (ex: tem OTel ativo) sem ter o basico (ex: nem todos os hosts com CPU). A formula sem gate inflaria a utilization. Os gates forcam:

- BP so importa se voce ja tem **80%+ do Foundation**
- Excellence so importa se voce ja tem **60%+ do BP** (que por sua vez exige Foundation forte)

### 3.4 Utilization Level (L0-L3) - rotulo discreto

Independente do utilizationScore, atribui um **nivel** discreto. Mais facil de comunicar.

```mermaid
flowchart TD
    A[fPct, bPct, ePct] --> B{fPct >= 0.5?}

    B -->|No| L0[L0 - Not Adopted<br/>Foundation &lt; 50%]
    B -->|Yes| C{fPct >= 1.0<br/>AND<br/>bPct >= 0.5?}

    C -->|No| L1[L1 - Foundation<br/>tem o basico mas falta profundidade]
    C -->|Yes| D{fPct == 1.0<br/>AND bPct == 1.0<br/>AND ePct >= 0.5?}

    D -->|No| L2[L2 - Operational<br/>base + parte do BP]
    D -->|Yes| L3[L3 - Optimized<br/>tudo + parte do Excellence]

    style L0 fill:#CD3C44,color:#fff
    style L1 fill:#DC671E,color:#fff
    style L2 fill:#EEA746,color:#fff
    style L3 fill:#36B37E,color:#fff
```

---

## 4. Exemplo numerico completo - Infrastructure capability

Vamos rodar uma capability inteira de ponta a ponta com numeros reais.

### Setup

**Infrastructure Observability** tem 22 criterios:
- **Foundation** (3): i1, i2, i4
- **Best Practice** (10): i3, i5, i6, i9, i11, i13, i14, i17, i19, i20, i21
- **Excellence** (8): i7, i8, i10, i12, i15, i16, i18, i22

Suponha estes resultados:
```
Foundation:    3/3  passed -> fPct = 1.00 (100%)
Best Practice: 6/11 passed -> bPct = 0.55 (55%)
Excellence:    3/8  passed -> ePct = 0.38 (38%)

Total passed: 12 / 22
```

### Coverage Score

```mermaid
flowchart LR
    A[12 passed<br/>22 total] --> B[coverage =<br/>12 / 22 x 100]
    B --> C[= 54.5%]
    C --> D[Math.round -> 55]
    D --> E[Banda: Moderate<br/>40-60]

    style A fill:#3B82F6,color:#fff
    style C fill:#8B5CF6,color:#fff
    style E fill:#EEA746,color:#fff
```

**Coverage = 55** (banda Moderate, cor amarela)

### Utilization Score

```mermaid
flowchart TD
    A[fPct = 1.00<br/>bPct = 0.55<br/>ePct = 0.38] --> B{fPct >= 0.8?<br/>1.00 >= 0.8 SIM}

    B -->|Yes| C[effB = 0.55<br/>BP conta]

    C --> D{effB >= 0.6?<br/>0.55 >= 0.6 NAO}

    D -->|No| E[effE = 0<br/>Excellence zerado!]

    E --> F[utilizationScore =<br/>1.00 x 60 + 0.55 x 25 + 0 x 15<br/>= 60 + 13.75 + 0<br/>= 73.75]

    F --> G[Math.round -> 74]
    G --> H[Banda: Good<br/>60-80]

    style A fill:#3B82F6,color:#fff
    style E fill:#EF4444,color:#fff
    style F fill:#8B5CF6,color:#fff
    style H fill:#5EB1A9,color:#fff
```

**Utilization = 74** (banda Good, mesmo com Excellence 38% - porque o gate cortou).

### Utilization Level

```mermaid
flowchart LR
    A[fPct = 1.00<br/>bPct = 0.55<br/>ePct = 0.38] --> B{fPct >= 0.5?<br/>SIM}
    B --> C{fPct == 1.0<br/>AND bPct >= 0.5?<br/>1.00 == 1.0 e 0.55 >= 0.5 SIM}
    C --> D{fPct == 1.0<br/>AND bPct == 1.0<br/>AND ePct >= 0.5?<br/>bPct == 1.0 FALSE}
    D --> L2[L2 - Operational]

    style A fill:#3B82F6,color:#fff
    style L2 fill:#EEA746,color:#fff
```

**Nivel = L2 Operational**

### Resumo do exemplo

| Metrica | Valor | Significado |
|---|---|---|
| Total criterios | 22 | tudo que esta sendo medido |
| Passaram | 12 | metade-ish |
| **Coverage** | **55** | "55% dos itens passou" |
| **Utilization** | **74** | "base solida, BP a meio caminho, Excellence ignorado" |
| **Level** | **L2 Operational** | "tem o basico + alguma profundidade" |

Note como **Coverage 55 < Utilization 74**: o cliente tem Foundation 100%, e a formula de Utilization premia isso. Coverage trata todos os criterios como iguais.

---

## 5. Coverage vs Utilization - lado a lado

Quando os dois numeros divergem, o por que.

```mermaid
flowchart TB
    subgraph SAME[Mesmos 22 criterios da Infrastructure]
        A[12 / 22 passed<br/>Foundation 3/3<br/>BP 6/11<br/>Excellence 3/8]
    end

    SAME --> COV[Coverage path]
    SAME --> MAT[Utilization path]

    subgraph COV[COVERAGE]
        C1[Conta tudo igual]
        C2[12 / 22 x 100]
        C3[= 55<br/>banda Moderate]
    end

    subgraph MAT[UTILIZATION]
        M1[Foundation x 60% peso]
        M2[BP x 25% peso<br/>se F >= 80%]
        M3[Excellence x 15% peso<br/>se BP >= 60%]
        M4[60 + 13.75 + 0]
        M5[= 74<br/>banda Good]
    end

    style A fill:#3B82F6,color:#fff
    style C3 fill:#EEA746,color:#fff
    style M5 fill:#5EB1A9,color:#fff
```

**Cenarios em que os dois numeros divergem mais:**

```mermaid
flowchart TD
    A[Distribuicao do<br/>cliente] --> B{Padrao?}

    B -->|Foundation forte<br/>Excellence ignorado| C["Coverage MEDIO<br/>Utilization ALTO<br/><br/>Mensagem: <br/>basico solido, falta avancar"]

    B -->|Excellence alto<br/>Foundation fraco| D["Coverage MEDIO<br/>Utilization BAIXO<br/><br/>Mensagem:<br/>tem coisas avancadas<br/>mas o basico nao esta solido"]

    B -->|Tudo proporcional| E["Coverage = Utilization<br/><br/>Mensagem:<br/>adocao uniforme"]

    B -->|Tudo 100%| F["Coverage 100<br/>Utilization 100<br/><br/>Mensagem:<br/>L3 Optimized"]

    style C fill:#5EB1A9,color:#fff
    style D fill:#EF4444,color:#fff
    style E fill:#EEA746,color:#fff
    style F fill:#36B37E,color:#fff
```

---

## 6. Total Score - agregando as 9 capabilities

O numero unico que aparece no header.

```mermaid
flowchart TD
    A[9 capabilities<br/>cada uma com<br/>coverage + utilization] --> B[Excluir capabilities<br/>que o usuario desmarcou]

    B --> C[Aplicar consolidation factor<br/>opcional - default 100%]

    C --> D{Consolidation < 100<br/>para alguma capability?}

    D -->|Yes| E[adjScore =<br/>rawScore x factor / 100]
    D -->|No| F[score = rawScore]

    E --> G[Coverage medio<br/>sum scores / count]
    F --> G

    C --> H[Utilization medio<br/>sum maturityScores / count]

    G --> I[totalScore<br/>shown in header]
    H --> J[overallMaturityLevel<br/>used for export]

    style A fill:#3B82F6,color:#fff
    style E fill:#F59E0B,color:#fff
    style I fill:#10B981,color:#fff
    style J fill:#EC4899,color:#fff
```

**Consolidation factor** e um ajuste manual por capability (0-100%) que o SE pode setar quando sabe que algumas capabilities nao se aplicam ao cliente (ex: cliente sem K8s -> Infrastructure deveria pesar menos). Default e 100% (sem ajuste).

---

## 7. O que muda o score (e o que nao muda)

Resumo do que afeta cada metrica.

```mermaid
flowchart LR
    subgraph IN[Inputs do usuario]
        T[Capabilities<br/>desmarcadas]
        C[Consolidation<br/>factors]
    end

    subgraph DATA[Vem do tenant]
        DQL[Resultados DQL]
        HOSTS[Host count<br/>via Scale Tier]
    end

    subgraph CALC[Calculo]
        TH[Thresholds<br/>hardcoded]
        TIER[Tier classification<br/>hardcoded]
        W[Weights 60/25/15<br/>hardcoded]
    end

    subgraph OUT[Outputs]
        COV[Coverage]
        MAT[Utilization]
        LVL[Level L0-L3]
    end

    DQL --> COV
    DQL --> MAT
    DQL --> LVL
    TH --> COV
    TH --> MAT
    TH --> LVL
    TIER --> MAT
    TIER --> LVL
    W --> MAT
    T --> COV
    T --> MAT
    C --> COV
    C --> MAT
    HOSTS -.affects.-> DQL

    style COV fill:#3B82F6,color:#fff
    style MAT fill:#EC4899,color:#fff
    style LVL fill:#10B981,color:#fff
```

| O que muda Coverage e Utilization | O que NAO muda |
|---|---|
| Dados reais do Grail (DQL results) | Tema dark/light |
| Scale Tier (large/xlarge faz sampling) | Cache hit/miss (resultado e igual) |
| Capabilities desmarcadas | Versao do app (mesmas formulas em 2.5.x) |
| Consolidation factor (so afeta adjusted) | Tempo de execucao |
| Thresholds (se alguem editar queries.ts) | DPS scanned bytes |
| Tier classification (se alguem editar criterionTiers.ts) | |

---

## 8. TLDR visual

Os dois caminhos em uma imagem.

```mermaid
flowchart LR
    A[~94 criteria<br/>each: passed or failed] --> B[Per capability]

    B --> C["Coverage<br/>simple average<br/>passed/total x 100"]
    B --> D["Utilization<br/>tier-weighted<br/>F x 60% + BP x 25% + E x 15%<br/>(gated progressive)"]

    C --> E[Total Coverage<br/>avg of 9 capabilities]
    D --> F[Total Utilization<br/>avg of 9 capabilities]

    E --> G[Header score<br/>radar bands]
    F --> H[Capability cards<br/>L0-L3 badge]

    style A fill:#3B82F6,color:#fff
    style C fill:#5EB1A9,color:#fff
    style D fill:#EC4899,color:#fff
    style G fill:#10B981,color:#fff
    style H fill:#EEA746,color:#fff
```

> **Em uma frase:** *Coverage e media simples; Utilization e media ponderada que so libera tiers avancados quando os anteriores estao solidos.*

---

## Como exportar como PNG

```bash
npm i -g @mermaid-js/mermaid-cli   # uma vez
cd docs
mmdc -i SCORING-CALCULATIONS.md -o diagrams-scoring/ -e png -w 1600 -b white
```

Ou regenerar exatamente o mesmo set:

```bash
python3 /tmp/extract_diagrams.py     # adapt source filename to this MD
cd docs/diagrams-scoring
for f in *.mmd; do
  /tmp/node_modules/.bin/mmdc -i "$f" -o "${f%.mmd}.png" \
    -c /tmp/mermaid-config.json -b white -w 1600
done
```
