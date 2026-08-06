# Pulse Assessment — Design System Reference (v2)

Catalogo completo de cores, componentes, layouts e padroes do Pulse Assessment
para replicar a mesma identidade em outros apps Dynatrace (dt-app).

Base: branch `feat/davis-insights`. Framework: **React + TypeScript + Strato 1.x**.

> v2 adiciona tudo que veio com a era Davis/Objectives: chat do Assist,
> intents nativos, radar SVG, graficos de barras/timeline, cards de
> objetivos, selects alimentados por fontes oficiais e badges de IA.
>
> **Nota de escopo (v2.5.5):** as telas de Objectives/Projects foram
> removidas do Pulse Assessment — junto com os hooks de Ownership teams,
> Segments e ownership discovery. Os padroes seguem documentados aqui de
> proposito: este arquivo e uma referencia de design para **outros** apps,
> e esses padroes continuam validos mesmo nao existindo mais neste repo.
> Onde um trecho descreve algo que so existiu na era Objectives, ele esta
> marcado com _(removido do Pulse — padrao mantido para reuso)_.

---

## 1. Stack e dependencias

```json
{
  "@dynatrace/strato-components":              "~1.18.0",
  "@dynatrace/strato-components-preview":      "~1.11.2",
  "@dynatrace/strato-design-tokens":           "^1.1.0",
  "@dynatrace/strato-icons":                   "(vem com o toolkit)",
  "@dynatrace-sdk/app-environment":            "getEnvironmentUrl()",
  "@dynatrace-sdk/client-query":               "DQL (queryExecute + poll)",
  "@dynatrace-sdk/client-document":            "Document Store (persistencia)",
  "@dynatrace-sdk/client-davis-copilot":       "Davis CoPilot (conversation skill)",
  "@dynatrace-sdk/navigation":                 "sendIntent (Assist nativo)",
  "@dynatrace-sdk/client-classic-environment-v2": "Settings API (Ownership teams)",
  "@dynatrace-sdk/client-filter-segment-management": "Segments da plataforma"
}
```

Regra de ouro: **componentes Strato + design tokens sempre**; hex hardcoded
apenas para canvas/SVG e cores de dominio (capabilities).

---

## 2. Tema (claro/escuro)

```tsx
import { useCurrentTheme } from "@dynatrace/strato-components/core";
const dk = useCurrentTheme() === "dark";
```

Componentes Strato adaptam sozinhos. Use `dk` somente para superficies
customizadas (canvas, SVG, rgba sutil):

```tsx
const borderSub = dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";
const trackBg   = dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";
const bgHover   = dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)";
```

---

## 3. Paleta — design tokens (preferidos)

```tsx
import Colors from "@dynatrace/strato-design-tokens/colors";

const text     = Colors.Text.Neutral.Default;     // texto principal
const textSec  = Colors.Text.Neutral.Subdued;     // secundario
const textTert = Colors.Text.Neutral.Disabled;    // metadados
const accent   = Colors.Text.Primary.Default;     // acoes/links (indigo)
const success  = Colors.Text.Success.Default;
const danger   = Colors.Text.Critical.Default;
const warning  = Colors.Charts.Status.Warning.Default;

const bg       = Colors.Background.Base.Default;      // fundo da pagina
const surface  = Colors.Background.Surface.Default;   // cards/header
const bgSubtle = Colors.Background.Container.Neutral.Subdued;
const border   = Colors.Border.Neutral.Default;
```

### Alpha-suffix trick (tints a partir de tokens/hex)

Concatene 2 digitos hex de alpha a uma cor para obter tint tema-safe:

```tsx
background: accent + "15"          // chip de destaque
background: capColor + (dk ? "22" : "15")   // chip por capability
border: `1px solid ${capColor}44`
```

---

## 4. Cores de dominio (hardcoded, centralizadas)

### 4.1 As 9 capabilities (fonte: `ui/app/queries.ts`)

```ts
const CAPABILITY_COLORS = {
  "Infrastructure Observability": "#3B82F6", // azul
  "Application Observability":    "#8B5CF6", // roxo
  "Digital Experience":           "#EC4899", // rosa
  "Log Analytics":                "#F59E0B", // ambar
  "Application Security":         "#EF4444", // vermelho
  "Threat Observability":         "#F97316", // laranja
  "AI Observability":             "#06B6D4", // ciano
  "Business Observability":       "#10B981", // verde
  "Software Delivery":            "#6366F1", // indigo
};
// lookup map (padrao usado nas paginas):
const CAP_COLOR: Record<string,string> =
  Object.fromEntries(CAPABILITIES.map(c => [c.name, c.color]));
```

### 4.2 Bandas de score (fonte: `ui/app/utils/colors.ts`)

| Banda | Faixa | Hex (canvas/SVG) | Token (JSX) |
|---|---|---|---|
| N/A | <20 | `#CD3C44` | `Charts.Status.Critical` |
| Low | 20-39 | `#DC671E` | `Charts.Categorical.Color14` |
| Moderate | 40-59 | `#EEA746` | `Charts.Status.Warning` |
| Good | 60-79 | `#5EB1A9` | `Charts.Categorical.Color07` |
| Excellent | ≥80 | `#36B37E` | `Charts.Status.Ideal` |

---

## 5. Tipografia

```tsx
import { Text, Strong, Heading, Code, ExternalLink }
  from "@dynatrace/strato-components/typography";
```

| px | Uso |
|---|---|
| 9-10 | badges/labels uppercase, footnotes de grafico |
| 11 | metadados, hints, legendas |
| 12 | texto secundario, labels de form |
| 13 | corpo (chat, planos, objetivos) |
| 14-16 | titulos de secao/pagina |

Padroes: `fontWeight: 600` enfase media, `700` títulos/uppercase;
`letterSpacing: 0.5` + `textTransform: "uppercase"` para labels de secao;
`lineHeight: 1.5-1.6` em paragrafos.

**Section label** (usado em todo lugar):
```tsx
<Text style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
  textTransform: "uppercase", color: textSec }}>Capabilities involved</Text>
```

---

## 6. Layout

```tsx
import { Page } from "@dynatrace/strato-components-preview/layouts";
import { Flex, Grid, Surface, Container } from "@dynatrace/strato-components/layouts";
```

- Esqueleto: `<Page><Page.Main>…</Page.Main></Page>` dentro de `<ErrorBoundary>`.
- Split sidebar: `Grid gridTemplateColumns="380px 1fr"` + `minHeight: 0` +
  `overflow: hidden` no Grid, `overflowY: "auto"` no filho.
- **Header sticky de pagina** (Objectives/AI pages) _(removido do Pulse — padrao mantido para reuso)_:

```tsx
<Flex flexDirection="row" alignItems="center" justifyContent="space-between"
  style={{ padding: "12px 24px", borderBottom: `1px solid ${border}`,
           background: surface, position: "sticky", top: 0, zIndex: 10 }}>
  <Flex gap={12} alignItems="center">
    <Button size="condensed" onClick={goBack}>← Back</Button>
    <Flex flexDirection="column">
      <Text style={{ fontSize: 16, fontWeight: 700 }}>Objectives</Text>
      <Text style={{ fontSize: 11, color: textTert }}>subtitle · Tenant X</Text>
    </Flex>
  </Flex>
  <Button variant="emphasized" color="primary">New objective</Button>
</Flex>
```

### Spacing — GOTCHA importante

`Flex gap` aceita **apenas** estes tokens:
`0 | 2 | 4 | 6 | 8 | 12 | 16 | 20 | 24 | 32 | 40 | 48 | 56 | 64`.
**`gap={10}` quebra o build.** Use 8 ou 12. Em `style={{}}` qualquer px vale.

---

## 7. Buttons — GOTCHAS do Strato 1.x

- `variant`: `"default" | "accent" | "emphasized"` — **NAO existe "minimal"**.
- CTA primario: `variant="emphasized" color="primary"`.
- `size="condensed"` para toolbars.
- Prefixo com icone: `<Button.Prefix><ArrowUpIcon /></Button.Prefix>`.
- `IntentButton` (mesmo pacote) para intents declarativos.

```tsx
<Button variant="emphasized" color="primary" onClick={send}>
  <Button.Prefix><ArrowUpIcon /></Button.Prefix>
  Send
</Button>
```

---

## 8. Icones (strato-icons)

```tsx
import { DavisCoPilotIcon, DynatraceIntelligenceSignetIcon, ArrowUpIcon }
  from "@dynatrace/strato-icons";
<DynatraceIntelligenceSignetIcon size="large" />
```

- `DynatraceIntelligenceSignetIcon` — identidade do Assist/IA (headers, empty states)
- `DavisCoPilotIcon` — avatar de mensagens do Davis no chat
- `ArrowUpIcon` — botao de enviar do composer

**Nada de emoji em botoes/labels** (decisao de design do app).

---

## 9. Overlays / Modal — GOTCHA

`Modal` de `@dynatrace/strato-components-preview/overlays`.
**`Modal.Footer` NAO existe no 1.x** — faca o footer como ultima row:

```tsx
<Flex flexDirection="row" justifyContent="flex-end" gap={8}
  style={{ paddingTop: 8, borderTop: `1px solid ${borderSub}` }}>
  <Button onClick={close}>Close</Button>
</Flex>
```

Modal de chat com altura fixa: wrapper `style={{ minWidth: 620, maxWidth: 860,
height: 560 }}` em `flexDirection="column"`; area central com
`flex: 1, minHeight: 0, overflowY: "auto"`; composer fixo embaixo.

---

## 10. Forms customizados

`inputStyle` compartilhado (inputs/textarea/select nativos estilizados):

```tsx
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", fontSize: 13, borderRadius: 6,
  border: `1px solid ${borderSub}`,
  background: dk ? "rgba(0,0,0,0.20)" : "rgba(255,255,255,0.85)",
  color: text, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};
```

- **Chat composer (pill)**: mesmo estilo com `borderRadius: 20`.
- **Select nativo**: `style={{ ...inputStyle, appearance: "auto" }}` + hint
  abaixo dizendo a fonte oficial dos dados (ex: "Official Ownership teams
  (Settings > Ownership > Teams)").
- **GOTCHA teclado**: inputs dentro de cards clicaveis (Space/Enter togglam o
  card) precisam de `e.stopPropagation()` em `onKeyDown` E `onKeyUp` — senao
  digitar espaco colapsa o card.

---

## 11. Padroes de UI

### 11.1 Chip com dot (capability)

```tsx
<Flex alignItems="center" gap={4} style={{
  padding: "2px 10px", borderRadius: 8,
  background: capColor + (dk ? "22" : "15"),
  border: `1px solid ${capColor}44` }}>
  <Flex style={{ width: 8, height: 8, borderRadius: "50%", background: capColor }} />
  <Text style={{ fontSize: 11, fontWeight: 600 }}>{name}</Text>
</Flex>
```

### 11.2 Badge de status de IA (header do card)

Estados: `"AI available"` (idle) · `"AI…"` (loading) · `"AI ✓"` (ok, expandido)
· `"AI ready"` (ok, colapsado) · `"AI !"` (erro, cor Critical):

```tsx
<Text style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px",
  borderRadius: 6, background: c + (dk ? "20" : "15"), color: c,
  border: `1px solid ${c}${dk ? "40" : "30"}` }}>{label}</Text>
```

### 11.3 Card de objetivo/projeto

```tsx
<Flex flexDirection="column" gap={8} style={{
  padding: 16, borderRadius: 10, border: `1px solid ${border}`,
  background: surface,
  borderLeft: `4px solid ${primaryCapColor}` }}>   // accent lateral
  {/* header: titulo + meta 11px textTert + acoes a direita */}
  {/* corpo: objetivo 12px textSec, chips, graficos, plano */}
</Flex>
```

### 11.4 Linha de sugestao selecionavel (picker de objetivos)

```tsx
<Flex flexDirection="column" gap={2} role="button" tabIndex={0}
  onClick={prefill}
  style={{ padding: "6px 10px", borderRadius: 6, cursor: "pointer",
    border: `1px solid ${selected ? accent : borderSub}`,
    background: selected ? (dk ? "rgba(99,102,241,0.12)" : "rgba(99,102,241,0.08)")
                         : "transparent" }}>
  <Flex gap={6} alignItems="center">
    <Text style={{ /* mini-badge uppercase 9px na cor accent */ }}>QUICK WIN</Text>
    <Text style={{ fontSize: 11, fontWeight: 600 }}>{title}</Text>
  </Flex>
  <Text style={{ fontSize: 10, color: textTert }}>{detail}</Text>
</Flex>
```

### 11.5 Progress pill / barra com gradiente

```tsx
<Flex style={{ height: 8, borderRadius: 4, background: trackBg, overflow: "hidden" }}>
  <Flex style={{ height: "100%", width: `${pct}%`, borderRadius: 4,
    background: `linear-gradient(90deg, ${color}99, ${color})` }} />
</Flex>
```

---

## 12. Padroes de chat / IA

### 12.1 Bolhas de conversa

- **Usuario**: alinhado a direita, bolha indigo
  `background: dk ? "rgba(99,102,241,0.18)" : "rgba(99,102,241,0.12)"`,
  `borderRadius: 12`, `maxWidth: "80%"`.
- **Assistente**: a esquerda com avatar `<DavisCoPilotIcon />`, bolha neutra
  `dk ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"`, markdown renderizado.
- Auto-scroll: ref na area de mensagens + `useEffect` setando
  `el.scrollTop = el.scrollHeight` quando a conversa muda.
- Loading: bolha do assistente com `<SkeletonText lines={3} />`.

### 12.2 Painel de erro acionavel (nunca "unavailable" seco)

```
Davis error (HTTP 403)              ← 12px bold Critical
┌ mensagem crua em monospace ┐      ← 11px, mono, fundo sutil, wordBreak
Forbidden. The OAuth token is missing davis-copilot:conversations:execute.
Sign out and back in…               ← hint 11px textSec
```

### 12.3 Disclaimer obrigatorio em toda saida de IA

```
AI-generated · may contain inaccuracies · verify before acting
```
(10px, italic, textTert/subdued)

### 12.4 Renderer de markdown seguro

Subconjunto: `#/##/###`, listas `-`/`1.`, `**bold**`, `` `code` `` inline.
Sem HTML cru (strip `<[^>]*>`), sem links externos. Implementacao exportada em
`ui/app/components/DavisInsightSection.tsx` (`renderMarkdown(md, textColor,
accentColor)`) — importe em vez de duplicar.

### 12.5 Launcher do Assist nativo (conversation starters)

Header com `DynatraceIntelligenceSignetIcon` + "Dynatrace Intelligence";
gate de disponibilidade via `listAvailableSkills()` (mostrar triggers so se
`skills` contiver `"conversation"`); chips de starters agrupados por categoria
(label uppercase 10px); acoes disparam `sendIntent` para
`dynatrace.davis.copilot` / `ask-question` com contexts
`supplementary` (≤100K) / `instruction` (≤2.5K) / `document-retrieval` /
`origin-app`. Ver `ui/app/ai/assistIntent.ts`.

---

## 13. Graficos (sem bibliotecas — SVG/Flex puros)

### 13.1 Radar SVG (`ui/app/components/ProjectRadar.tsx`)

- Aneis em 25/50/75/100 (`strokeDasharray "3,3"`, anel 100 solido);
- Eixos com dot colorido da capability na ponta (`r=4`);
- Poligono de valores: fill `rgba(99,102,241,0.18/0.25)`, stroke accent;
- So renderiza com **3+ eixos** (menos que isso e degenerado — caia para lista);
- Canvas grande (TechRadar): lembrar `devicePixelRatio` scaling.

### 13.2 Barras duplas coverage × utilization

Uma linha por metrica: label 10px (width fixa 64) + track (`trackBg`) +
fill gradiente na cor da capability + valor 10px bold a direita.

### 13.3 Barra empilhada de ownership _(removido do Pulse — padrao mantido para reuso)_

Segmentos na MESMA cor da capability com opacidade decrescente
(`opacity: 1 - i * 0.22`, `minWidth: 3`), `title` com tooltip nativo,
legenda abaixo com quadradinhos 7px + "nome · contagem".

### 13.4 Timeline de semanas

Por bloco: label "Weeks X–Y" (width fixa) + track relativo com barra absoluta
`left: (start-1)/max*100%`, `width: (end-start+1)/max*100%`, gradiente accent;
contagem de milestones a direita; titulos listados abaixo (10px).

---

## 14. Dados oficiais da plataforma (fontes para selects/discovery)

| Dado | SDK | Scope |
|---|---|---|
| Ownership teams | `settingsObjectsClient.getSettingsObjects({schemaIds:"builtin:ownership.teams"})` | `settings:objects:read` |
| Segments | `filterSegmentsClient.getLeanFilterSegments()` | `storage:filter-segments:read` |
| Ownership discovery | DQL `fetch dt.entity.X \| expand tag = tags \| filter startsWith(tag,"dt.owner:") \| summarize countDistinct(id), by:{tag}` | `storage:entities:read` |
| Davis conversation | `publicClient.recommenderConversation` / `listAvailableSkills` | `davis-copilot:conversations:execute` |

Padrao de hook: lazy (`active` flag), `started` guard, degradacao silenciosa
para lista vazia + hint na UI de onde definir o dado oficialmente.

---

## 15. Persistencia (Document Store)

Padrao unico para caches/projetos (`useProjects`, `DavisCache`, `QueryCache`):
- 1 doc por dominio (`id` = `name` = `type`, ex: "pulse-projects");
- `schemaVersion` guard na leitura;
- optimistic locking (`optimisticLockingVersion` no update; create no 404);
- **degradacao silenciosa**: erro de storage nunca quebra a UI (estado
  continua em memoria).

---

## 16. Dev mode / gating

`useDevMode` — 3 caminhos, qualquer um ativa:
1. **`hostname === "localhost"`** (dt-app dev) → automatico, zero setup;
2. `?dev=1` na URL;
3. `localStorage.cca.dev = "1"`.

Producao (`*.apps.dynatrace.com`) nunca casa com localhost → superficie de
IA/diagnostico fica invisivel para o cliente sem esforco.

---

## 17. Estados vazios e loading

- **Empty state**: centralizado, `DynatraceIntelligenceSignetIcon size="large"`,
  titulo 14px bold, texto 12px textSec (maxWidth ~460), CTA emphasized.
- **Loading**: `Skeleton`/`SkeletonText` (em Suspense fallback, bolhas de chat,
  cards durante analise). Nunca spinner custom.
- **Aviso contextual**: linha 11-12px na cor `Charts.Status.Warning` (ex: "run
  the assessment first…").

---

## 18. Estrutura de pastas

```
ui/app/
  App.tsx                    # Page + Routes (lazy) + ErrorBoundary
  queries.ts                 # dominios + cores das capabilities
  scale-tier.ts              # tiers de escala + modo economico (sampling/janela)
  trace-proxy.ts             # substitutos de metrica/topologia p/ checks de span
  ai/                        # prompts, intents, starters, analises
    assistIntent.ts            # sendIntent p/ Assist nativo
    conversationStarters.ts    # starters por pagina + por time
    reportPrompt.ts            # contexto do assessment p/ prompts
    smartReport.ts             # relatorio narrativo via Davis CoPilot
  hooks/                     # dados (DQL, Doc Store, fontes oficiais)
    useCoverageData.ts, useAppAdoption.ts, usePreflight.ts,
    useScaleTier.ts, useDavisRecommendations.ts, useDevMode.ts
  components/                # UI reutilizavel
    CovUtilRadar.tsx (radar, modo coverageOnly), CapabilityScatter.tsx
    (barras de coverage + linha de utilization), CustomReportModal.tsx,
    SmartReportModal.tsx, DavisInsightSection.tsx (exporta renderMarkdown),
    ScaleTierBanner.tsx (+ CostModeNote), TraceProxyBanner.tsx, TechRadar.tsx
  reports/                   # geradores de PDF por persona (EN/PT/ES)
    personaReports.ts, aiNarrativePdf.ts
  data/                      # mapas estaticos (tiers, importancia, apps)
  pages/                     # 1 arquivo por rota
  utils/                     # colors.ts (bandas de score)
  perf/                      # instrumentacao + caches
```

---

## 19. Checklist para novo app

1. Instalar strato-components(+preview), design-tokens, strato-icons e os SDKs
   da secao 1; declarar scopes minimos no `app.config.json`.
2. `<ErrorBoundary><Page><Page.Main><Suspense fallback={Skeleton…}><Routes>`.
3. Tokens para toda cor de texto/fundo/borda; hex so em canvas/SVG/dominio.
4. `gap` apenas com tokens validos (nada de 10); variants de Button validos.
5. Footer de Modal manual (nao existe `Modal.Footer`).
6. Inputs em contexto clicavel: `stopPropagation` em keyDown/keyUp.
7. IA: pergunta natural (guardrail), erro acionavel, disclaimer, markdown seguro,
   nomes amigaveis (nunca ids internos tipo `i15`).
8. Assist nativo via `sendIntent` + gate `listAvailableSkills`.
9. Persistencia Doc Store com schemaVersion + optimistic locking + degradacao.
10. Dev gating por localhost/`?dev=1`/localStorage.

---

## 20. Anti-patterns (visto na pratica)

- `gap={10}` → erro de tipo (token invalido).
- `variant="minimal"` em Button → nao existe.
- `Modal.Footer` → nao existe no 1.x.
- Emoji em botoes/labels.
- IDs internos de checks (`i15`) em texto de IA — sempre nome amigavel.
- Prompt imperativo ("Produce…/Give me…") → guardrail do Davis rejeita; use
  forma de pergunta ("What should I include…?").
- Input sem `stopPropagation` dentro de card com toggle por Space.
- Cor hardcoded espalhada — centralize (CAP_COLOR, utils/colors.ts).
- Chamada de LLM automatica em mount/expand — sempre acao explicita do usuario.

---

*v2 gerado a partir do estado da branch `feat/davis-insights`. Atualize ao
mudar paleta, versoes do Strato ou padroes de IA.*
