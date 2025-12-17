# Bidfood Warehouse Data Transformation

Transform warehouse CSV → Excel with **slot allocation** (bin packing with capacity constraints).

## Quick Start

```bash
npm install        # First time only
npm run typecheck  # Verify TypeScript (MUST pass)
npm run transform  # Generate Excel from 100K most recent picks
npm run validate   # Verify output (expect 0 errors, 2 warnings)
```

**Output**: `output/01_Ready_For_Import/Bidfood_Full_Aug-Dec-2025_100K-picks.xlsx`

## Input Files

Located in `../Example of input data from client/`:

- **Locations.csv** (4,824 locations → 3,394 Area='D')
- **Artikelinformatie.csv** (3,006 articles)
- **251209_pick.csv** (512,922 picks → 100K most recent used)

## CRITICAL: Slot Allocation Architecture

**NOT volume calculation - this is bin packing!**

- `capacityLayout` = list of slot sizes: `"0,25-0,25-0,50-1,00-1,00"` (5 physical slots)
- Each article consumes exactly ONE slot
- Constraint: `assigned[bay][size] ≤ available[bay][size]`
- Overflow logged when bay reaches capacity

## Output Format

Excel file with 7 sheets (3 for import, 4 reference):

### Import Sheets

**1. Pick Sheet** (~100,000 rows)
- Most recent 100K picks sorted DESC by date
- Fields: pickList, location, article, quantity, pickTime, salesOrder, salesOrderCategory

**2. Location Sheet** (324 bays)
- location (bay code), zone, capacityLayout, locationGroup, slotTypeComposition
- **capacityLayout**: List of individual slot sizes (e.g., `"0,25-0,25-0,50-1,00"`)
- **NOT** volume percentages - each value = one physical slot

**3. ArticleLocation Sheet** (~1,524 assignments)
- article, location, articleDescription, articleVolume, locationSize
- **Respects capacity constraints**: assigned ≤ available slots per size
- locationSize matches a slot from capacityLayout

### Reference Sheets

4. **LocationMapping**: Original location → bay mapping
5. **DatasetInfo**: Transformation metadata
6. **BayAnalysis**: Slot type composition patterns
7. **ValidationReport**: Referential integrity checks

## Expected Output Metrics

```
Picks: 100,000 (most recent from 512K, sorted DESC)
Bays: 324 (Area='D' only)
Total slots: 3,394 (1,572×1.00 + 1,230×0.50 + 592×0.25)
ArticleLocation: ~1,524 assignments (44-45% utilization)
Overflow: ~6,500 articles (capacity exceeded - expected)
Validation: 0 errors, 2 warnings (overflow warnings = correct behavior)
```

## Key Implementation

### Capacity Layout (Slot List)
```typescript
// Bay "11-021" has 5 locations: 2×PP3, 1×PP5, 2×BLH
capacityLayout = "0,25-0,25-0,50-1,00-1,00"
// Means: 2 slots size 0.25, 1 slot size 0.50, 2 slots size 1.00
```

### Slot Allocation Algorithm
```
1. Sort picks DESC by date (newest first)
2. Extract 100K most recent
3. Build slot inventory per bay (count slots by size)
4. For each pick:
   - Get article's slot size from pick location
   - Check: used < available?
   - If yes: assign article → slot, increment usage
   - If no: log overflow (bay full)
```

### Location Size Mapping
Based on slot type:

- **1.0 (large)**: BLH, BLN
- **0.5 (medium)**: BLL, PP5
- **0.25 (small)**: PP3, PP7, PP9, PK, PLK, PLV
- **UNKNOWN**: defaults to 1.0

| Slot Type | Width×Depth×Height (cm) | Volume (cm³) | Size |
|-----------|------------------------|--------------|------|
| BLH | 120×90×225 | 2,430,000 | 1.0 |
| BLN | 240×180×350 | 15,120,000 | 1.0 |
| BLL | 120×90×75 | 810,000 | 0.5 |
| PP5 | 52×90×90 | 421,200 | 0.5 |
| PP3 | 44×90×80 | 316,800 | 0.25 |
| PP7 | 18×90×90 | 145,800 | 0.25 |
| PP9 | 30×90×20 | 54,000 | 0.25 |
| PK/PLK/PLV | 52×90×30 | 140,400 | 0.25 |

## Validation (9 Checks)

```bash
npm run validate  # Expect: 0 errors, 2 warnings
```

**Checks that MUST pass** (0 errors):
1. ✅ Pick.location → Location.location
2. ⚠️ Pick.article → ArticleLocation (overflow expected)
3. ✅ ArticleLocation.location → Location
4. ⚠️ Article-location pairs (overflow expected)
5. ✅ **capacityLayout values ∈ {0.25, 0.50, 1.00}** (no volume percentages!)
6. ✅ locationSize values valid
7. ✅ No duplicate keys
8. ✅ originalPickLocation references valid
9. ✅ **Capacity constraints: assigned ≤ available per size**

**Warnings are EXPECTED** - they indicate overflow (articles that couldn't fit due to capacity constraints).

## Data Flow

```
Locations.csv (4,824)
  → Filter Area='D' (3,394)
  → Group by bay (324)
  → List slot sizes per bay → capacityLayout

251209_pick.csv (512,922)
  → Filter Area='D' (512,922)
  → Sort DESC by date (newest first)
  → Take 100K most recent
  → Allocate to slots (FIFO)
  → ArticleLocation (1,524) + Overflow (6,586)
```

## Project Structure

```
client-data-transformation/
├── src/
│   ├── bay-level-transform.ts    # calculateBayCapacityLayout, aggregatePicksToBayLevel
│   ├── slot-dimensions.ts        # getLocationSize, SLOT_DIMENSIONS
│   └── client-to-template.ts     # Legacy (not used)
├── scripts/
│   ├── transform-bay-level.ts    # Main: sort picks, build inventory, allocate
│   ├── validate-referential-integrity.ts  # 9 validation checks
│   └── analyze-bay-patterns.ts   # Bay pattern analysis
├── output/01_Ready_For_Import/
│   └── Bidfood_Full_Aug-Dec-2025_100K-picks.xlsx
├── CLAUDE.md                     # Implementation guide (READ THIS!)
└── README.md
```

## Troubleshooting

**Validation error: "capacity layouts don't sum to 1.00"**
→ This is EXPECTED! New architecture uses slot lists, not volume percentages.
→ Check 5 validates slot sizes ∈ {0.25, 0.50, 1.00}, NOT sum = 1.0

**Warning: "articles in picks not in ArticleLocation"**
→ EXPECTED! This is overflow (bay full).
→ ~6,500 articles can't be assigned due to capacity constraints.

**ArticleLocation count seems low (~1,524)**
→ CORRECT! This respects capacity constraints (44% utilization).
→ Old approach assigned all articles (3,313) - this was WRONG.

**Need more article assignments?**
→ Increase MAX_PICKS in transform-bay-level.ts (currently 100K)
→ Or accept that warehouse has limited physical capacity

## Critical Rules

1. **Never calculate volume percentages** - only list slot sizes
2. **Always sort picks DESC by date** - newest = best data quality
3. **Respect capacity constraints** - stop at available slots, log overflow
4. **Trust operational data** - use pick location's slot size
5. **European decimals** - comma separator (0,25) in output

## See Also

- **CLAUDE.md** - Complete implementation guide with code snippets
- **package.json** - Available npm commands
- **scripts/validate-referential-integrity.ts** - All validation checks explained
