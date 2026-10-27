# ADR 0011 — Energetic types use international standards, not house names

**Status**: accepted (M8, planned)

## Context

To turn an abstract energy-systems diagram into a model of a real household, business or
landscape, every store and flow has to say what it is. That means Odum's Code position (the
kernel's `carrier`), the unit it is measured in, and, for money, the currency. Only then can it
be compared with measured data and calibrated (FR-OBS, FR-CAL). The owner asked that these names
follow international standards wherever a standard exists.

Odum's inter-block array has four positions: Code, Force, Flow and Transformity. Only **Code**
is a type. Force (the level Q), Flow (J) and Transformity (emergy per unit) are the quantities
every pathway carries. The pinned kernel already models Code as `carrier`, with `unit` and
`conserved` in a top-level `carriers` list, and Transformity as `quality_input`.

## Decision

Each attribute takes the name and the code list of the standard that governs it:

| Attribute                                    | Standard                                                                                                                                           | What it holds                                                                                | Example                                                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Unit of a physical carrier                   | **UCUM**, the Unified Code for Units of Measure (Regenstrief), with SI (ISO 80000 / IEC 80000-13) as the basis                                     | a case-sensitive UCUM code                                                                   | `kW.h`, `kL`, `kg`, `By`, `{subscription}`                                                                                            |
| Fiat currency                                | **ISO 4217**                                                                                                                                       | the alphabetic code                                                                          | `AUD`, `USD`, `EUR`                                                                                                                   |
| Crypto-asset                                 | **ISO 24165**, Digital Token Identifier (DTI)                                                                                                      | the DTI from the DTI registry                                                                | Bitcoin's DTI                                                                                                                         |
| What a household spends on (budget accounts) | **COICOP 2018**, the UN Classification of Individual Consumption According to Purpose, used by household budget surveys and consumer price indices | a COICOP code                                                                                | `04` Housing, water, electricity, gas and other fuels; `03` Clothing and footwear; `07` Transport; `08` Information and communication |
| What the product is (optional)               | **CPC** v2.1, the UN Central Product Classification                                                                                                | a CPC code                                                                                   | electricity, water, a streaming service                                                                                               |
| Who a party is (optional, later)             | **SNA 2008** institutional sectors; **ISIC** Rev. 4 for industry                                                                                   | sector or industry code                                                                      | households; electricity supply                                                                                                        |
| Energy quality                               | Odum's emergy terms: there is no ISO standard                                                                                                      | transformity (sej/J), specific emergy (sej/g), emergy-to-money ratio (sej per currency unit) | —                                                                                                                                     |

Three consequences for names:

1. **No field is called "sector".** In the System of National Accounts, an _institutional
   sector_ means who (households, corporations, government), not what is bought. What the
   owner called sector, budget accounts such as utilities, clothes, transport and travel, is
   **purpose** in the standard sense. Purpose is a COICOP 2018 code.
2. **Kind** (`energy`, `material`, `information`, `monetary`) has no single governing standard.
   The closest are SEEA's split between physical and monetary accounts and the SI dimension of
   the unit. So the studio **infers kind from the unit**:
   - an energy dimension (J, W·h) is energy;
   - a mass or volume (kg, L) is material;
   - a quantity of information (bit, byte) is information;
   - an ISO 4217 or ISO 24165 currency is monetary.

   An explicit kind is asked for only when the unit cannot tell, such as a count like
   `{subscription}`. "Monetary" is the SNA/SEEA term, so it is used rather than "money".

3. **Tags** are free strings for filtering and personal grouping, such as "Netflix",
   "shared with flatmate" or "tax-deductible". They are never a substitute for the purpose
   code. A user's own chart of accounts goes in tags, or later as a named custom scheme.

Line styles follow Odum's ecological-economic diagrams:

- energy and material pathways are solid;
- **monetary pathways are dashed**;
- **information pathways are dotted**.

Validity is shown by a glow behind a symbol (FR-VAL-002), never by line colour, so the two never
compete.

## Consequences

- Imported data can be matched by unit and currency. A series in kL can only be compared with a
  water carrier in kL, and the checks refuse dollars against kilowatt-hours.
- Budgets can be totalled by COICOP purpose and compared with national household-expenditure
  statistics, which publish by the same classification.
- In the kernel's Schema v4 the carrier entries are closed except for `_`-prefixed keys. The
  studio therefore stores `kind`, the currency and the classifications as `_kind`,
  `_currency`/`_dti` and `_cpc` until the kernel adopts them (K-9 KX-1/KX-2), and the saved file
  still loads in the kernel unchanged.
- The studio ships the COICOP 2018 divisions and groups as a code list, with their English
  titles, and the ISO 4217 active codes. It does not ship the DTI registry: a DTI is entered and
  checked only for its format.
