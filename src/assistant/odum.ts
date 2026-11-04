/**
 * An Odum reference (M12, ADR 0016): what each symbol of the energy systems
 * language means and the conventions for drawing with it, for the assistant to
 * read (the odum_reference tool) instead of guessing, and for people to read
 * on the Reference page. Written from H.T. Odum's books (sources below); the
 * app's own facts in each symbol entry (kernel type, equation, what its value
 * means) come from the catalogue, so they cannot drift from what the app does.
 *
 * Entries are Markdown. Keep them short, exact and practical: what it means,
 * how to draw it here, and the usual mistakes.
 */
import { CATALOGUE, LOGICS, symbolFor } from '../model/catalogue.ts';
import type { NodeType } from '../model/types.ts';

export interface ReferenceEntry {
  id: string;
  title: string;
  kind: 'symbol' | 'convention' | 'method';
  /** One line for the index. */
  gist: string;
  /** For a symbol: the kernel type it draws. */
  type?: NodeType;
  /** Markdown. */
  text: string;
  /** Related entries. */
  see: string[];
}

export const SOURCES = [
  'H.T. Odum (1983). Systems Ecology: An Introduction. Wiley.',
  'H.T. Odum (1994). Ecological and General Systems: An Introduction to Systems Ecology. University Press of Colorado (revised edition of Systems Ecology).',
  'H.T. Odum (1996). Environmental Accounting: Emergy and Environmental Decision Making. Wiley.',
  'H.T. Odum and E.C. Odum (2000). Modeling for All Scales: An Introduction to System Simulation. Academic Press.',
];

/** What the app itself does with a symbol, from the catalogue. */
function inApp(type: NodeType): string {
  const s = symbolFor(type);
  return [
    '**Kernel**',
    `- Kernel type \`${type}\`${s.palette ? '' : ' (not in the palette; models that have it still draw and run)'}.`,
    `- Its value is the ${s.valueLabel.toLowerCase()}${s.holdsState ? '; it holds state, so runs chart its level' : ''}.`,
    ...(s.composite
      ? [
          '- A composite: the kernel expands it into members (body, gate, heat) when the model loads.',
        ]
      : []),
    `- ${s.summary}`,
  ].join('\n');
}

const SYMBOLS: Omit<ReferenceEntry, 'kind'>[] = [
  {
    id: 'source',
    type: 'source',
    title: 'Source',
    gist: 'An outside input: sun, rain, fuel, wages, a market.',
    text: `A **source** (circle) is energy, material, money or information coming from outside the system, a *forcing function*: sunlight, rain, fuel, imported goods, wages. The system does not control it.

- Draw sources **outside the boundary**, around its edge, ordered by energy quality (see *Layout*).
- Odum distinguishes a source held at a level (a pressure, like a fuel supply) from a **flow-limited** source that only passes what arrives (sunlight, rain). Here a source is held at its value; a varying source is a *forced* one (the inspector's Forcing).
- A source has no inflow and no heat sink: it is outside the accounting.

**Mistakes**: drawing the main storage of the system as a source (it should be a storage inside the boundary); a source with flows into it.`,
    see: ['storage', 'layout', 'boundary'],
  },
  {
    id: 'storage',
    type: 'storage',
    title: 'Storage (tank)',
    gist: 'A quantity held: water, biomass, money, information, assets.',
    text: `A **storage** (tank) holds a quantity Q that its inflows raise and its outflows lower: dQ/dt = inflows − outflows. Water in a dam, biomass, fuel in a tank, money in an account, books in a library.

- **Every storage has a depreciation pathway** to the heat sink (second law): stored energy and structure disperse and wear unless work maintains them. See *Losses and depreciation*.
- Its outflows usually depend on how full it is, J = k·Q (a *linear* flow): a fuller tank pushes harder.
- Give it a carrier (water in kL, money in AUD) so its flows can be checked and fitted to data.

**Mistakes**: a storage with no outflow at all (it can only fill); money drained to a heat sink (money circulates instead; see *Money*); confusing a storage with the source that fills it.`,
    see: ['depreciation', 'heat-sink', 'money', 'logics'],
  },
  {
    id: 'heat-sink',
    type: 'sink',
    title: 'Heat sink',
    gist: 'Where degraded, used energy leaves the system (the earth symbol).',
    text: `The **heat sink** is drawn like the electrical earth: a short vertical line over three horizontal lines, each shorter than the one above. It is where **degraded energy** leaves: the heat dispersed by every real process (second law). Nothing flows back out of it.

- Odum draws a heat-sink pathway from **every storage** (depreciation) and **every work process** (interactions, producers, consumers): used energy is the price of work.
- Heat sinks sit **below** the diagram, usually one shared sink at the bottom of the boundary; flows enter it from above.
- Only **energy** goes to a heat sink. Money is not degraded (it circulates); materials are not destroyed (they leave or are recycled). See *Money* and *Materials*.

**In this app** the sink is also the one way for anything to leave the system, so a material leaving (evaporation, water used, waste) is drawn to a sink too: label it for where it goes ("Evaporation", "Household use") so it is not mistaken for heat.

**Mistakes**: drawing it as a triangle or an arrow (it is the earth symbol); money flowing into it; a flow out of it.`,
    see: ['depreciation', 'energy-laws', 'materials', 'money'],
  },
  {
    id: 'interaction',
    type: 'interaction',
    title: 'Interaction (work gate)',
    gist: 'Two flows combining multiplicatively: one does work on the other.',
    text: `An **interaction** (work gate, the chevron) is a **production process**: two or more pathways, each carrying something different and each necessary, combine to make a product of another kind: sunlight and nutrients in photosynthesis, fuel and labour in a factory. It holds nothing: it is arithmetic on its inputs, the **production function**.

- **All its flows are in proportion to the production function**, usually the product of the input forces: the product out is k₁·A·B, each ingredient drawn in is its own k·A·B, and the **used energy** goes to the heat sink, k·A·B again. Each pathway has its own coefficient k.
- **Inputs by quality**: the low-transformity input (most energy) comes in from the left; the highest-transformity input, often a **control feedback** from a unit downstream, comes in from the right or top as a solid curve. The chevron points left to right along the flow.
- **Variants** (Modeling for All Scales, Fig. 2.6): three or more inputs multiplied; a **divisor** (the left input divided by the control: dilution); a **subtracting** action.
- A control can be an ingredient that is **used up** (drawn down in proportion), or a force that is only **read** (information, a pressure).

**Here** an interaction is a **process** (ADR 0018): one chevron, its pathways drawn into and out of it.
- Place one with the palette's **Interaction** and wire it: the first symbol wired in is the main input, the next ones controls; drag from its right port to what it makes. Or drop a symbol onto a flow: the flow becomes the product, the symbol its control.
- Each control is **used up** (an ingredient, drawn down: its own pathway, k·B·A) or **only read** (a force or information).
- The **used energy** goes to a heat sink (the nearest one below, or a new one), k·A·B with its own k.
- The production function is a **product** (\`*\` once per multiplied control; up to eight), a **divisor** (\`÷\`, the kernel's *ratio*) or **subtracting** (\`−\`).
- A unit feeding back to its own intake (grazers on their grazing, a producer on its capture) is a control that is also the product.

The kernel runs each pathway as a flow and reads controls without draining them, which is why a used-up control has its own pathway. Older models may have a plain interaction flow (a gate on one flow); its inspector offers **Make it a process**.

**Mistakes**: adding the inputs instead of multiplying (that is two separate flows); no heat sink; an ingredient that is never drawn down; reading the gate as a coefficient (every pathway has its own k, interaction or not).`,
    see: ['logics', 'producer', 'energy-laws'],
  },
  {
    id: 'producer',
    type: 'producer',
    title: 'Producer',
    gist: 'A self-maintaining unit capturing outside energy: plants, farms.',
    text: `A **producer** (the bullet shape: flat on the left, rounded on the right) is a self-maintaining unit that **captures and concentrates outside energy** through an interaction with its own storage: green plants and algae, farms, a mine, an industry turning raw inputs into goods.

- Inside it, in Odum's convention, are an interaction (its work gate), a storage (its biomass or assets) and a heat sink (respiration, depreciation). The symbol stands for all three.
- Producers sit toward the **left** inside the boundary: low transformity, near the sources that feed them.

**Here** it is a composite: the kernel expands it into body, gate and heat, with production and respiration rates, so its heat sink is built in. Charts show its body.

**Mistakes**: adding a separate heat sink for its respiration (already inside); using a producer for a plain storage.`,
    see: ['consumer', 'interaction', 'layout'],
  },
  {
    id: 'consumer',
    type: 'consumer',
    title: 'Consumer',
    gist: 'A self-maintaining unit using higher-quality energy: animals, cities.',
    text: `A **consumer** (hexagon) is a self-maintaining unit that **uses higher-quality energy** made by others and feeds back services: animals, people, households, cities, firms that buy rather than capture. Like a producer it contains a storage, its work and its heat sink.

- Consumers sit to the **right** of producers: higher transformity, fewer of them, larger territories.
- Odum often draws a storage symbol inside a consumer (a city's money, a household's savings) to show what it holds; here, pack the storages into a group and its ports show which one each flow reaches.
- A consumer usually **feeds back** to what feeds it (services, control, recycling): look for that loop.

**Here** it is a composite with a metabolism rate, its heat sink built in.

**Mistakes**: a consumer with no feedback, a pure dead end; an extra heat sink for its metabolism.`,
    see: ['producer', 'layout', 'aggregation', 'money'],
  },
  {
    id: 'transaction',
    title: 'Transaction',
    gist: 'Money exchanged against goods or services: the diamond.',
    text: `A **transaction** (diamond) is a purchase: **money flows one way, goods or services the other**. Odum draws the two flows side by side, running opposite ways, with the diamond across both, and the money flow dashed. The ratio of the two is the **price**.

- Every purchase is a pair: no money flow without what it buys, and the reverse.
- The money flow goes from the **buyer's** money storage to the **seller's**; the goods flow from the seller to the buyer.

**In this app** it is a marking on a flow, not a node: drag the palette's Transaction onto the flow of goods, then **Add counter-flow** draws the money flow and pairs them (the kernel's \`coupled_edge\`). It is invalid until the money flow exists. Until the kernel prices pairs (K-9), each flow keeps its own rate and the app shows the implied price, money J ÷ goods J.

**Mistakes**: a money flow in the same direction as the goods; money paid into a heat sink; a transaction with no money flow.`,
    see: ['money', 'storage'],
  },
  {
    id: 'switch',
    type: 'switch',
    title: 'Switch',
    gist: 'On/off action around a threshold: fire, harvest, a decision.',
    text: `A **switch** passes a flow **on or off** when a level crosses a threshold: a fire when fuel builds up, a harvest when a crop is ripe, a policy that triggers above a limit. It makes pulsing behaviour possible.

**Here** a threshold flow (J = k when Q₀ > θ, else 0) does the same job on a pathway; the Switch symbol is for a switch with its own outputs.`,
    see: ['logics'],
  },
  {
    id: 'amplifier',
    type: 'gain',
    title: 'Constant-gain amplifier',
    gist: 'An output proportional to a control, drawing on its own power supply.',
    text: `A **constant-gain amplifier** (triangle) delivers an output **proportional to a control signal**, drawing the energy from a separate supply: a thermostat-driven heater, a population growing in proportion to its numbers while food is plentiful.

- The control does little work itself; the gain comes from the supply.`,
    see: ['interaction', 'logics'],
  },
  {
    id: 'receiver',
    type: 'loop_limited',
    title: 'Self-limiting receptor',
    gist: 'An input that saturates: light captured by leaves, service capacity.',
    text: `A **self-limiting receptor** (half circle with a flat side) captures a flow that **saturates** as the input grows, because the receptors are limited in number: light absorbed by chlorophyll, customers served by a fixed staff. Output follows a Michaelis–Menten curve, k·Q/(1 + Q/C), with C the capacity.

**Here** a *limit* flow does the same on a pathway.`,
    see: ['logics', 'producer'],
  },
  {
    id: 'box',
    type: 'misc_box',
    title: 'Box (miscellaneous unit)',
    gist: 'A subsystem not drawn in detail.',
    text: `A **box** (rectangle) stands for a **unit or subsystem not drawn in detail**: a government department, a market, an industry. Label it with what it is.

- Prefer drawing what it contains when it matters to the question; a box is a placeholder.
- **Here**, to keep detail but hide it, pack the symbols into a group instead: the kernel still runs every symbol, and the group's ports show where each flow goes.`,
    see: ['aggregation'],
  },
  {
    id: 'sensor',
    title: 'Sensor',
    gist: 'Reads a flow without taking from it.',
    text: `A **sensor** (small box on a pathway) reads a flow's rate without taking from it, so the reading can control something else (information, dotted lines).

**Here** drag the palette's Sensor onto a flow: it shows the flow's rate during playback and charts it. It cannot yet drive a control (kernel request K-5).`,
    see: ['information'],
  },
  {
    id: 'constant',
    type: 'constant',
    title: 'Constant',
    gist: 'A fixed level other flows can read.',
    text: `A **constant** holds a fixed value that flows can read, such as a price or a policy setting. A source held at its value does the same job, so the palette offers only Source; imported models with constants still draw and run.`,
    see: ['source'],
  },
];

const CONVENTIONS: Omit<ReferenceEntry, 'kind'>[] = [
  {
    id: 'energy-laws',
    title: 'The energy laws in a diagram',
    gist: 'Every node balances; every process degrades some energy.',
    text: `- **First law**: energy (and material) is conserved: at every storage, what flows in minus what flows out is the change in storage. Every pathway starts somewhere and ends somewhere.
- **Second law**: every real process degrades some energy into dispersed heat. So every storage (depreciation) and every work process (interaction, producer, consumer) has a pathway to a **heat sink**.
- **Maximum empower** (Odum's proposed fourth principle): systems that prevail are those that develop designs, feedbacks and storages that maximise their useful energy throughput. In a diagram this shows as feedback loops from high-quality units back to the ones that feed them.`,
    see: ['heat-sink', 'depreciation', 'layout'],
  },
  {
    id: 'depreciation',
    title: 'Losses and depreciation',
    gist: 'Every storage wears down: draw it to the heat sink.',
    text: `**Every storage has a depreciation pathway**: stored energy and structure disperse unless work maintains them. Odum draws it from the storage to the heat sink, usually as a linear flow, J = k·Q, with k the fraction lost per unit time.

- For an **energy** storage (fuel, biomass, a building's structure) it is the energy degraded: draw it to the heat sink.
- For a **material** that actually leaves (a dam's evaporation and seepage, a tank's leaks) it is a flow out across the boundary. Here it is drawn to a sink labelled for where it goes.
- **Money** does not depreciate to a heat sink: it circulates. See *Money*.
- **add_loss** draws a linear loss from a storage to a new sink below it.

A model without losses fills forever and is unrealistically conserving; losses are usually what bring storages to a steady state.`,
    see: ['heat-sink', 'storage', 'materials', 'money'],
  },
  {
    id: 'money',
    title: 'Money',
    gist: 'Money circulates against energy and goods; dashed; never to a heat sink.',
    text: `In Odum's diagrams **money circulates in loops, flowing opposite to the energy, goods and services it pays for**, and is drawn **dashed**.

- Money is **not degraded**: it never flows to a heat sink. It leaves a storage only by being paid to someone (who may be outside the system, across the boundary).
- Every purchase is a **transaction**: the goods flow one way, the money flow the other, with the diamond across both. Their ratio is the price.
- Money buys human services and goods that carry emergy; the **emergy-to-money ratio** of an economy (sej per dollar) converts between them.
- Income usually arrives from outside (wages, sales) as a source of money; savings are a storage; spending is outflow to sellers.

**Mistakes**: money to a heat sink; money flowing the same way as what it buys; a money storage that only fills.`,
    see: ['transaction', 'emergy', 'depreciation'],
  },
  {
    id: 'materials',
    title: 'Materials and recycling',
    gist: 'Materials are conserved: they leave or recycle, they do not degrade.',
    text: `Materials (water, nutrients, minerals, goods) are **conserved**: they are not destroyed, so they do not go to a heat sink as heat does. They are **carried** by energy flows, concentrated by work, used, and **recycled** or exported.

- Show where they go: water used by a household goes on as wastewater; nutrients return to the soil through decomposers (a recycle loop back to the producers).
- A material leaving the system crosses the boundary. In this app that is a flow to a sink labelled for where it goes.`,
    see: ['depreciation', 'boundary'],
  },
  {
    id: 'information',
    title: 'Information',
    gist: 'Copied, not used up; dotted lines; high transformity.',
    text: `Information (genes, knowledge, data, culture) is **copied rather than used up**, so it is not conserved the way energy and materials are, and it has very high transformity. It controls rather than powers. It is drawn **dotted** here. Information storages still depreciate (forgetting, decay of records) and need energy to maintain and copy.`,
    see: ['sensor', 'emergy'],
  },
  {
    id: 'layout',
    title: 'Layout: left to right by energy quality',
    gist: 'Sources around the outside, low quality on the left; sinks below.',
    text: `Odum arranges a diagram by **energy quality (transformity)**, increasing from **left to right**:

- **Sources** around the outside of the boundary, low-transformity ones (sun, wind, rain) on the left, higher ones (fuels, goods, services, information) toward the right and top.
- **Inside**: producers on the left, consumers on the right, the highest-quality units (cities, governments, information) furthest right.
- **Heat sinks** at the bottom; money loops usually run along the top or between units, against the goods.
- Feedbacks from right to left show high-quality units controlling and serving the ones that feed them.

This app does not enforce the layout, but following it makes a diagram readable at a glance.`,
    see: ['boundary', 'emergy', 'producer', 'consumer'],
  },
  {
    id: 'boundary',
    title: 'The system boundary',
    gist: 'A frame around the system; sources outside it.',
    text: `Every diagram starts with a **boundary** (a rectangle) around the system of interest. **Sources are outside it**, heat sinks below it, and every flow crossing it is an import or export. Choosing the boundary is choosing the question: a household, a farm, a watershed, a nation.

**Here** the palette's Boundary draws a labelled frame; the kernel ignores it.`,
    see: ['layout', 'source', 'aggregation'],
  },
  {
    id: 'aggregation',
    title: 'Aggregation and zooming',
    gist: 'One symbol at one scale is many at the next.',
    text: `Odum's diagrams **zoom**: a single storage at one scale is many storages at the next, and a whole city can be one consumer in a regional diagram. Start simple (a few storages and the main pathways), then expand the parts that matter for the question.

**Here** pack symbols into a **group** (Ctrl/⌘-G): it draws as one symbol, while the kernel still runs every symbol inside it. When its crossing flows reach up to three symbols inside, the group shows them as ports, as Odum draws a storage inside a city.`,
    see: ['box', 'consumer', 'method'],
  },
  {
    id: 'emergy',
    title: 'Emergy and transformity',
    gist: 'Energy of one kind used up to make something: a measure of quality.',
    text: `**Emergy** (spelled with an m) is the available energy of one kind, usually solar, used up directly and indirectly to make a product or service, in solar emjoules (sej). **Transformity** is emergy per joule of the product (sej/J): low for sunlight (1 by definition), higher for wind, rain, fuels, food, electricity, and highest for human services and information.

- Transformity rises along a chain of transformations, which is why diagrams are ordered left to right by it.
- Emergy is not conserved like energy: it is an accounting of what was used.

This app runs energy and material flows; emergy accounting is not computed yet.`,
    see: ['layout', 'money', 'information'],
  },
  {
    id: 'logics',
    title: 'Flow logics',
    gist: 'How each pathway’s rate J depends on the levels it connects.',
    text: `Each pathway's rate J follows a **logic**, after Odum's flow equations. In this app (Q₀ is the origin's level, Qc a control's, k the rate):

${LOGICS.map((l) => `- **${l.label}** (\`${l.logic}\`): ${l.formula}${l.needs.length ? `; needs ${l.needs.join(', ').replace(/_/g, ' ')}` : ''}.`).join('\n')}

**Every pathway has its own coefficient k**, interaction or not: it says how strongly that pathway draws on the force behind it. Most pathways out of a storage are **linear**: a fuller storage pushes harder (a donor-controlled flow), and every storage needs at least one, its depreciation. Use **constant** for a fixed rate set from outside (a bill, a quota), **interaction** for a work gate, **limit** for a saturating receptor.`,
    see: ['interaction', 'receiver', 'switch', 'storage'],
  },
];

const METHOD: Omit<ReferenceEntry, 'kind'>[] = [
  {
    id: 'method',
    title: 'How to build a model',
    gist: 'Boundary, sources, storages, pathways, losses, check, run, fit.',
    text: `Odum's way of building a model, step by step:

1. **Question and boundary**: what do you want to know, and what is inside the system?
2. **Sources**: list the outside inputs (energy, materials, money, information) and place them around the boundary, by quality.
3. **Main storages**: the few quantities that matter for the question.
4. **Pathways**: connect sources to storages and storages to each other; choose each flow's logic; mark interactions where flows combine.
5. **Losses**: a depreciation pathway from every storage, and a heat sink for every work process.
6. **Money**: for each purchase, a transaction and its money counter-flow.
7. **Check**: the app's checks, then read the diagram against the energy laws.
8. **Run** and compare with what you know; then **fit** rates to observations (calibration) and replace assumed numbers with data.

Start with the simplest diagram that can answer the question, and add detail only where it changes the answer.`,
    see: ['boundary', 'source', 'storage', 'depreciation', 'transaction', 'examples'],
  },
  {
    id: 'examples',
    title: 'Worked examples in this app',
    gist: 'The library’s examples, and what each shows.',
    text: `Open these from the Models page:

- **Grassland food chain**: sun → grass (producer) → grazers (consumer), each losing heat. The basic food chain.
- **Predator and prey**: two consumers in an interaction; their levels cycle.
- **Reservoir**: a storage filled by inflow and drained by use and losses, with gauge readings to fit.
- **Household budget**: income into a bank account, every bill and renewal its own flow out, packed into groups.
- **Paying for electricity and streaming**: transactions, money running back against what it buys.
- **Buying water for a home**: a utility's dam selling water to a home, packed with ports.`,
    see: ['method', 'transaction', 'aggregation'],
  },
];

export const REFERENCE: readonly ReferenceEntry[] = [
  ...SYMBOLS.map((e) => ({
    ...e,
    kind: 'symbol' as const,
    text: e.type ? `${e.text}\n\n${inApp(e.type)}` : e.text,
  })),
  ...CONVENTIONS.map((e) => ({ ...e, kind: 'convention' as const })),
  ...METHOD.map((e) => ({ ...e, kind: 'method' as const })),
];

export function referenceEntry(id: string): ReferenceEntry | undefined {
  return REFERENCE.find((e) => e.id === id);
}

/** The palette types with no entry of their own: should be none (a test checks). */
export function uncoveredTypes(): NodeType[] {
  const covered = new Set(REFERENCE.map((e) => e.type).filter(Boolean));
  return CATALOGUE.filter((s) => s.palette && !covered.has(s.type)).map((s) => s.type);
}
