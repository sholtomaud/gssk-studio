# K-9 — Transactions: priced counter-flows in the GSSK kernel

**For**: the GSSK kernel (`energese-project/GSSK-Giannantoni`), to be implemented by a kernel
agent. **From**: GSSK Studio (SPEC §6.2, §17 K-9 and K-10). **Against**: pinned GSSK 5.3.0
(`dist` @ 3043a57c). **Status**: requested.

The key words MUST, SHOULD and MAY are used as in RFC 2119.

## 1. Purpose

Odum's ecological-economic convention: wherever money changes hands, it flows **against** a flow
of something else (energy, a material, a service, information). A purchase is a pair of
pathways. Goods flow from seller to buyer, and money flows from buyer to seller. The price links
the two:

    J_money = P × J_goods

Here P is in units of the currency per unit of the goods carrier (AUD/kWh, BTC/GB, USD/month of
service). Odum draws the pair through the transaction symbol (the diamond). The studio draws it
as a transaction marking on the two flows. The kernel needs to compute it.

The studio must be able to express all of these:

- a household paying a utility per kWh;
- a fixed monthly subscription that buys a quantity of service;
- a price that is a state of the model (Odum's M/W money-to-work price), so inflation can emerge
  rather than be dialled in;
- a payer who runs out of money and so stops receiving goods.

## 2. What the pinned kernel does today

Reproduce with `tests/kernel` in GSSK Studio (snippets in §8). Every case uses `method: "rk4"`,
`dt = 0.1`, 10 steps.

| Case                                                                            | Observed                                                                                | Expected                                           |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `gain` node between two storages                                                | output storage receives 2 × input; input not drained (signal)                           | as documented                                      |
| `interaction` node with two inputs                                              | output receives k·Q₁·Q₂, the origin is drained                                          | as documented                                      |
| `exchange` node, goods and money each wired in → node → out, `params.price = 2` | inbound edges report J (100, 1000); **outbound edges report 0, and no storage changes** | goods reach the buyer and money reaches the seller |
| Two plain `linear` edges with reciprocal `coupled_edge`                         | runs; each flow independent of the other                                                | as documented (quality accounting only)            |
| `coupled_edge` naming an edge that does not exist                               | **accepted silently**                                                                   | rejected (K-10)                                    |

So the schema documents the exchange (`NodeParams.price`: "applies F_money = price × F_goods to
the money counter-flow"), but in 5.3.0 it moves nothing. `coupled_edge` already pairs the right
two edges, but nothing reads the pairing outside quality accounting.

## 3. Requirements

### 3.1 Carriers say what they measure (KX-1 … KX-4)

- **KX-1** `Carrier` MUST gain an optional `kind`, one of `"energy"`, `"material"`,
  `"information"` or `"monetary"`.
- **KX-2** A monetary carrier MUST identify its currency by exactly one of:
  - `currency`: an ISO 4217 alphabetic code (`"AUD"`, `"USD"`, `"EUR"`); or
  - `dti`: an ISO 24165 Digital Token Identifier, for a crypto-asset such as BTC.

  It MAY carry `decimals` (minor units: 2 for AUD; 8 for BTC, whose smallest unit is the satoshi).

- **KX-3** A non-monetary carrier SHOULD state `unit` as a UCUM code (`"kW.h"`, `"kL"`, `"kg"`,
  `"By"`, `"{subscription}"`). The kernel does no unit arithmetic. It MUST carry the strings
  through serialisation unchanged, and it MAY refuse a `unit` on a monetary carrier
  (`currency`/`dti` is its unit).
- **KX-4** `kind` MUST NOT change integration. It exists so §3.2 can be validated and §3.5
  reported.

### 3.2 A priced edge logic (KX-5 … KX-12)

- **KX-5** A new edge logic, `"price"`, MUST compute its flow from the flow of the edge it is
  coupled to:

      J_this = P(t) × J_coupled              (goods-driven: this is the money edge)

  where `params.coupled_edge`, or the existing top-level `coupled_edge`, names the other edge.
  The pairing MUST be reciprocal: each edge names the other.

- **KX-6** `P(t)` comes from the first of these that is present:
  1. `params.price_node`: the current state Q of a node, which makes price endogenous;
  2. a `forcing` block on the price edge, which drives P(t) rather than k. This reuses the
     forcing vocabulary unchanged and covers inflation as an exponential and tariff steps as a
     table;
  3. `params.price`: a constant.

  `params.k` MUST be ignored on a `price` edge.

- **KX-7** A money-driven transaction MUST also be expressible: a fixed payment buys
  `J_goods = J_money / P`. Proposal: `params.driver: "goods" | "money"` on the `price` edge,
  default `"goods"`.
  - With `"money"`, the **money** edge keeps an ordinary logic (e.g. `constant`, k = 50 AUD/month).
  - The **goods** edge takes `logic: "price"` with `params.driver: "money"` and computes
    `J_goods = J_coupled / P`.
  - P ≤ 0 MUST be a schema error for a constant price. A state or forced price that reaches
    P ≤ 0 MUST make `J_goods = 0`, not divide by zero, and the event MUST be visible to the
    caller (a warning status or a getter).
- **KX-8** Evaluation order: a `price` edge's flow MUST be computed after the edge it reads,
  within the same RK stage, using that stage's state. Every Runge–Kutta stage MUST see the same
  rule. A cycle of `price` edges (A prices B prices A) MUST be rejected at `GSSK_Init` with
  `GSSK_ERR_SCHEMA_VIOLATION`.
- **KX-9** Payer limit. When the payer is exhausted, the transaction MUST stop rather than
  drive the payer's money storage negative. The payer is the money edge's origin, when it is a
  storage.
  - Goods-driven: if Q_payer ≤ 0 at a stage, both J_money and J_goods are 0 at that stage.
  - The crossing MUST be located within the solver tolerance: for example, by limiting the
    step that would cross, or by an event step. A one-step overshoot clamped afterwards is not
    acceptable, because it is step-size dependent and breaks conservation of the monetary
    carrier.
  - Optional per edge: `params.payer_limit: false` turns this off (credit is allowed).
- **KX-10** Validation at `GSSK_Init`. Each of these MUST fail with `GSSK_ERR_SCHEMA_VIOLATION`
  and a description naming the edge:
  - a `price` edge with no reciprocal coupled edge;
  - a coupled pair that does not carry exactly one `monetary` carrier, when both carriers are
    declared with a `kind`;
  - the pair's two edges have the same carrier;
  - P is a constant ≤ 0;
  - `price_node` names no node.
- **KX-11** Solver eligibility. With a constant P, a goods-driven pair is still linear in the
  state when the goods edge is linear: J_money = P·k·Q_origin. It SHOULD stay eligible for
  `expm` and `auto`. A `price_node` makes it bilinear, so `auto` MUST choose RK4 and report that
  it did. Forced P has the same problem as K-7: in `auto`, evaluate forcing within the step or
  choose RK4.
- **KX-12** Conservation. With both ends of every monetary edge being storages or the
  boundary, the per-carrier conservation error for the monetary carrier MUST stay at solver
  tolerance through payer exhaustion (KX-9).

### 3.3 The exchange node (KX-13)

- **KX-13** Either repair `exchange` or deprecate it.
  - **Repair.** The node has a goods in-port and out-port and a money in-port and out-port,
    chosen by edge carrier `kind`. Goods pass through unchanged, and money out = P × goods.
  - **Deprecate.** `GSSK_Init` prints one notice and expands the node into the KX-5 pair.
  - Either way, it MUST NOT silently compute nothing. The studio will not use the node. A
    transaction is a marking on a coupled pair (SPEC §6.2), so KX-5 … KX-12 are what the studio
    needs. KX-13 exists so that no model with an `exchange` node runs wrong.

### 3.4 Coupling is checked (K-10, KX-14)

- **KX-14** `coupled_edge` naming an edge that does not exist, naming the edge itself, or
  being non-reciprocal MUST be rejected at `GSSK_Init`, whatever the logic.

### 3.5 Reading transactions back (KX-15 … KX-17)

- **KX-15** Flat getters, so the studio never decodes a struct:
  - `GSSK_GetEdgePrice(inst, edge_idx)`: P at the current time for a `price` edge, NaN
    otherwise.
  - `GSSK_GetEdgeCoupled(inst, edge_idx)`: the coupled edge's index, or `SIZE_MAX`.
  - `GSSK_GetCarrierKind(inst, carrier_idx)`: an enum.
  - `GSSK_GetCarrierCurrency(inst, carrier_idx)`: the ISO 4217 code or DTI, or `""`.
- **KX-16** Emergy-to-money ratio (Odum's sej per currency unit). When quality accounting is
  on, the kernel SHOULD expose, per `price` pair, the emergy carried by the goods flow divided
  by the money flow. This is the emdollar basis.
- **KX-17** `GSSK_SerializeModel` MUST round-trip every new field, and `GSSK_Replay` MUST
  reproduce a run that includes `price` edges bit-for-bit.

## 4. Schema (proposed, Schema v5)

```jsonc
"carriers": [
  { "id": "electricity", "kind": "energy", "unit": "kW.h" },
  { "id": "aud", "kind": "monetary", "currency": "AUD", "decimals": 2 },
  { "id": "btc", "kind": "monetary", "dti": "<ISO 24165 DTI of Bitcoin>", "decimals": 8 }
],
"edges": [
  { "id": "power", "origin": "grid", "target": "house", "carrier": "electricity",
    "logic": "linear", "params": { "k": 0.1 }, "coupled_edge": "power_bill" },
  { "id": "power_bill", "origin": "bank", "target": "retailer", "carrier": "aud",
    "logic": "price", "params": { "price": 0.32 }, "coupled_edge": "power" }
]
```

## 5. Acceptance tests

All use `method: "rk4"`, `dt = 0.1`, t from 0 to 1, unless stated otherwise. The tolerances are
relative, against the analytic value; RK4's error at this dt is around 1e-10.

Model T (goods-driven, constant price):

- storages `u` (water seller, carrier water), `h` (buyer's tank, water), `bank` (buyer's money,
  aud), `co` (seller's money, aud);
- edge `goods`: u → h, linear, k = 0.1, coupled to `pay`;
- edge `pay`: bank → co, `price`, P = 2, coupled to `goods`.

Then Q_u(t) = 100·e^(−0.1t), J_goods = 10·e^(−0.1t), and the cumulative money paid is
2·100·(1 − e^(−0.1t)).

| #   | Variant                                                                                                                                            | At t = 1, expect (rel. tol. 1e-7 unless stated)                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | T with u = 100, bank = 1000                                                                                                                        | u = 90.483742, h = 9.516258, bank = 980.967484, co = 19.032516                                                                                                      |
| A2  | T, `GSSK_GetEdgePrice(pay)`                                                                                                                        | 2 at every step                                                                                                                                                     |
| A3  | T with bank = 10 (payer limit)                                                                                                                     | both flows stop at t* = −10·ln 0.95 = 0.512933; final u = 95.0, h = 5.0, bank = 0, co = 10 (rel. tol. 1e-6); money conservation error ≤ solver tolerance throughout |
| A4  | T with `payer_limit: false`, bank = 10                                                                                                             | bank = −9.032516                                                                                                                                                    |
| A5  | T with P from `price_node` = storage `p0` (value 2, no flows)                                                                                      | equals A1 exactly                                                                                                                                                   |
| A6  | T with P forced `{ "waveform": "step", "t_on": 0.5, "v0": 2, "v1": 4 }`                                                                            | money paid = 2·100(1−e^(−0.05)) + 4·100(e^(−0.05) − e^(−0.1)), so co = 28.310918 (the step lands on a step boundary, t = 0.5)                                       |
| A7  | Money-driven: `pay` constant k = 5 (AUD per unit time), `goods` `price` with `driver: "money"`, P = 2                                              | J_goods = 2.5; at t = 1, h = 2.5, bank = 995, co = 5, u = 97.5                                                                                                      |
| A8  | A1 under `expm` and under `auto`                                                                                                                   | equals A1 to 1e-6; `auto` reports no solver divergence                                                                                                              |
| A9  | Rejections: `price` edge without coupling; non-reciprocal coupling; coupling to a missing edge; both edges monetary; P = 0 constant; a price cycle | `GSSK_ERR_SCHEMA_VIOLATION`, with the description naming the edge                                                                                                   |
| A10 | `exchange` node model from §2                                                                                                                      | either moves goods and money as in A1 (repair) or prints the deprecation notice and equals A1 (expanded); never all-zero outflow                                    |
| A11 | Serialise A1, re-init, run                                                                                                                         | bit-identical to A1; `GSSK_Replay` of A6 bit-identical                                                                                                              |

## 6. Out of scope for the kernel

The studio does these itself:

- drawing and validating the transaction marking;
- classifying flows by purpose (COICOP);
- tags;
- identifying the parties (who is the buyer).

These stay in `_`-prefixed editor fields or `visual`, which the kernel ignores (SPEC §5.5).

## 7. Compatibility

- Additive. A Schema v4 model, with no `price` logic, no carrier `kind` and no bad
  `coupled_edge`, MUST run bit-identically to 5.3.0.
- KX-14 and KX-13 may reject or change models that load today, but only ones that are already
  wrong. List them in the release notes.

## 8. Probe used for §2

```ts
const m = {
  metadata: { schema_version: 4, name: 'p' },
  config: { t_start: 0, t_end: 1, dt: 0.1, method: 'rk4' },
  carriers: [
    { id: 'water', unit: 'kL' },
    { id: 'money', unit: 'AUD' },
  ],
  nodes: [
    { id: 'u', type: 'storage', value: 100, carrier: 'water' },
    { id: 'tx', type: 'exchange', value: 0, params: { price: 2 } },
    { id: 'h', type: 'storage', value: 0, carrier: 'water' },
    { id: 'bank', type: 'storage', value: 1000, carrier: 'money' },
    { id: 'co', type: 'storage', value: 0, carrier: 'money' },
  ],
  edges: [
    { id: 'g1', origin: 'u', target: 'tx', carrier: 'water' },
    { id: 'g2', origin: 'tx', target: 'h', carrier: 'water' },
    { id: 'm1', origin: 'bank', target: 'tx', carrier: 'money' },
    { id: 'm2', origin: 'tx', target: 'co', carrier: 'money' },
  ],
};
// After 10 GSSK_Step calls: flows g1=100 g2=0 m1=1000 m2=0; every storage unchanged.
```
