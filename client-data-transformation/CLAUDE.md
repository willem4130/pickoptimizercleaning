# Bidfood Warehouse Data Transformation

Transforms Bidfood warehouse CSV files (locations, articles, picks) into standardized Excel format for warehouse optimization simulation tools.

## CRITICAL ARCHITECTURE UNDERSTANDING

**This is a SLOT ALLOCATION problem, NOT a volume calculation!**

- `capacityLayout` = **LIST OF INDIVIDUAL PICK LOCATION SIZES** (e.g., "0,25-0,25-0,50-1,00-1,00")
- Each value represents ONE physical slot in the bay
- ArticleLocation = slot assignments (each article consumes exactly one slot)
- **Constraint**: Cannot assign more articles per size than available slots of that size

## Project Structure

```
client-data-transformation/
├── src/                          # Core transformation modules
│   ├── bay-level-transform.ts    # Bay-level aggregation & capacity calculation
│   ├── client-to-template.ts     # Legacy template conversion
│   └── slot-dimensions.ts        # Slot type dimensions & volume calculations
├── scripts/                      # Executable transformation scripts
│   ├── transform-bay-level.ts            # Main transformation (Area='D' bays)
│   ├── analyze-bay-patterns.ts           # Bay pattern analysis
│   └── validate-referential-integrity.ts # Data integrity validation
├── output/                       # Generated Excel files
│   ├── 01_Ready_For_Import/      # Processed files ready for import
│   ├── 02_Archived/              # Previous transformations
│   └── 03_Analysis_Reports/      # Analysis outputs
└── ../Example of input data from client/  # Raw CSV input files
    ├── Locations.csv             # 4,824 warehouse locations (Area='D' only: 3,394)
    ├── Artikelinformatie.csv     # 3,006 articles with dimensions
    └── 251209_pick.csv           # 512K picks (filters to ~390K Area='D')
```

## Key Transformation Logic

**Input** → **Output** (3 Excel sheets):
1. **Pick Sheet**: Most recent 100K picks from Area='D' locations
2. **Location Sheet**: Bays with capacityLayout = list of individual slot sizes
3. **ArticleLocation Sheet**: Slot assignments (respects capacity constraints)

**Critical Requirements**:
- ✅ Filter locations to Area='D' (starts with 'D')
- ✅ Filter picks to Area='D' locations only
- ✅ Sort picks by date DESC (most recent first)
- ✅ **SLOT ALLOCATION**: Each article consumes one slot from capacityLayout
- ✅ **CAPACITY CONSTRAINT**: Articles per size ≤ available slots per size
- ✅ Overflow articles logged when bay is full

**Example**:
- Bay "11-021" has capacityLayout: "0,25-0,25-0,50-1,00-1,00"
- This means: 2 slots (0.25), 1 slot (0.50), 2 slots (1.00) = 5 total
- Can assign: AT MOST 2 articles with locationSize=0.25, 1 with 0.50, 2 with 1.00

## Organization Rules

**Module Separation**:
- Core logic → `src/` (imported by scripts)
- Executable scripts → `scripts/` (run via npm)
- Type definitions → Co-located with usage
- Outputs → `output/` with organized subdirectories

**File Responsibilities**:
- `bay-level-transform.ts` - Bay grouping, capacity calculation, location mapping
- `slot-dimensions.ts` - Slot dimensions, volume calculations, article fitting
- `transform-bay-level.ts` - Main transformation orchestration
- `validate-referential-integrity.ts` - 8-check validation suite

## Code Quality - Zero Tolerance

After editing ANY file, run:

```bash
npm run typecheck  # TypeScript type checking (strict mode)
```

Fix ALL errors before continuing.

After transformation changes:

```bash
npm run transform  # Generate output Excel file
npm run validate   # Verify referential integrity (expect 0 errors)
```

Expected output:
- ~390K picks (Area='D' locations)
- 324 bays
- ArticleLocation >= unique articles in picks
- 0 validation errors

## Key Algorithms

**Capacity Layout** (bay-level-transform.ts):
```typescript
// For each bay, list INDIVIDUAL slot sizes (NOT volume percentages)
capacityLayout = locations
  .map(loc => getLocationSize(loc['Slot Type'])) // 0.25, 0.50, or 1.00
  .map(size => size.toFixed(2).replace('.', ','))
  .join('-')
// Result: "0,25-0,25-0,50-1,00-1,00" (5 slots total)
```

**Slot Allocation Algorithm** (transform-bay-level.ts):
```typescript
1. Sort picks by date DESC (most recent first)
2. Extract most recent 100K picks
3. For each pick:
   - Get article, bay, and pick location's slot size
   - Check if slot available: used[bay][size] < available[bay][size]
   - If yes: assign article to slot, increment usage
   - If no: log overflow (bay full)
4. Report: total slots, used slots, overflow count
```

**Slot Inventory Tracking**:
- Build: `availableSlots[bay][size] = count of slots per size`
- Track: `slotUsage[bay][size] = count of assigned articles`
- Constraint: `slotUsage[bay][size] ≤ availableSlots[bay][size]`

**Area Filtering**:
- Locations: Filter to `Area === 'D'` (3,394 from 4,824)
- Picks: Filter to `Locatiecode.startsWith('D')` (all 512K are Area='D')
