# Bidfood Warehouse Data Transformation

Transforms warehouse CSV → Excel (Pick, Location, ArticleLocation sheets) for simulation tools.

## CRITICAL: Slot Allocation Architecture

**NOT volume calculation - this is bin packing with capacity constraints!**

- `capacityLayout` = list of slot sizes: "0,25-0,25-0,50-1,00-1,00" (5 physical slots)
- Each article consumes exactly ONE slot
- Constraint: `assigned[bay][size] ≤ available[bay][size]`
- Overflow logged when bay full

## Commands

```bash
npm run typecheck   # MUST pass before any commit
npm run transform   # Generate Excel (100K most recent picks)
npm run validate    # Expect 0 errors, 2 warnings (overflow = expected)
```

## Expected Output

```
Picks: 100,000 (most recent from 512K, sorted DESC by date)
Bays: 324
Total slots: 3,394 (1,572×1.00 + 1,230×0.50 + 592×0.25)
ArticleLocation: ~1,500 assignments (44-45% utilization)
Overflow: ~6,500 articles (capacity exceeded)
Validation: 0 errors
```

## Core Implementation

### 1. Capacity Layout (`src/bay-level-transform.ts`)

```typescript
export function calculateBayCapacityLayout(locations: ClientLocation[]): string {
  // Map each location to its slot size (0.25, 0.50, 1.00)
  const slotSizes = locations.map(loc =>
    getLocationSize(loc['Slot Type'] || 'UNKNOWN')
  );

  // Format: European decimals (comma separator)
  return slotSizes
    .map(size => size.toFixed(2).replace('.', ','))
    .join('-');
}
```

**Result**: `"0,25-0,25-0,50-1,00-1,00"` = 5 slots in bay

### 2. Slot Allocation (`scripts/transform-bay-level.ts`)

```typescript
// Step 1: Parse and sort picks (newest first)
const parseDateFromPick = (dateStr: string): Date => {
  const parts = dateStr.split(' ')[0]?.split('-') || [];
  if (parts.length === 3) {
    const [day, month, year] = parts;
    const fullYear = year.length === 2 ? '20' + year : year;
    return new Date(parseInt(fullYear, 10), parseInt(month, 10) - 1, parseInt(day, 10));
  }
  return new Date(0);
};

picksAreaD.sort((a, b) => {
  const dateA = parseDateFromPick(a['Pick datumtijd'] || a['Leverdatum'] || '');
  const dateB = parseDateFromPick(b['Pick datumtijd'] || b['Leverdatum'] || '');
  return dateB.getTime() - dateA.getTime(); // DESC
});

const picks = picksAreaD.slice(0, 100000); // Most recent 100K

// Step 2: Build slot inventory per bay
const baySlotInventory = new Map<string, Map<number, number>>();
bayLocations.forEach((locs, bayCode) => {
  const inventory = new Map([[0.25, 0], [0.50, 0], [1.00, 0]]);
  locs.forEach(loc => {
    const size = getLocationSize(loc['Slot Type'] || 'UNKNOWN');
    inventory.set(size, (inventory.get(size) || 0) + 1);
  });
  baySlotInventory.set(bayCode, inventory);
});

// Step 3: Allocate articles to slots (FIFO by pick date)
const slotUsage = new Map<string, Map<number, number>>();
const assignedPairs = new Set<string>();
const overflowLog = [];

picks.forEach(pick => {
  const article = parseInt(pick.Artikelnummer, 10);
  const mapping = locationMapping.get(pick.Locatiecode?.trim());
  if (!mapping || isNaN(article)) return;

  const bayCode = mapping.bayLocation;
  const slotSize = getLocationSize(mapping.slotType);
  const pairKey = `${article}-${bayCode}`;

  if (assignedPairs.has(pairKey)) return; // Already assigned

  const available = baySlotInventory.get(bayCode)?.get(slotSize) || 0;
  const used = slotUsage.get(bayCode)?.get(slotSize) || 0;

  if (used < available) {
    // Assign article → slot
    articleLocationSheet.push({ article, location: bayCode, locationSize: slotSize, ... });
    slotUsage.get(bayCode)!.set(slotSize, used + 1);
    assignedPairs.add(pairKey);
  } else {
    // Overflow: bay full
    overflowLog.push({ article, bay: bayCode, size: slotSize, ... });
  }
});
```

### 3. Slot Size Mapping (`src/slot-dimensions.ts`)

```typescript
// Slot types → location sizes
BLH, BLN: 1.0 (large pallet)
BLL, PP5: 0.5 (medium)
PP3, PP7, PP9, PK, PLK, PLV: 0.25 (small shelf)
UNKNOWN: 1.0 (default)

export function getLocationSize(slotType: string): 0.25 | 0.5 | 1.0 {
  const dimensions = SLOT_DIMENSIONS[slotType];
  return dimensions?.locationSize || 1.0;
}
```

### 4. Validation (`scripts/validate-referential-integrity.ts`)

**9 Checks** (must all pass):
1. ✅ Pick.location → Location.location
2. ⚠️ Pick.article → ArticleLocation (overflow expected)
3. ✅ ArticleLocation.location → Location
4. ⚠️ Article-location pairs (overflow expected)
5. ✅ **capacityLayout values ∈ {0.25, 0.50, 1.00}**
6. ✅ locationSize values valid
7. ✅ No duplicate keys
8. ✅ originalPickLocation references valid
9. ✅ **Capacity constraints: assigned ≤ available**

```typescript
// Check 5: Validate slot sizes
const invalidValues = locations.filter(loc => {
  const capacities = loc.capacityLayout.split('-')
    .map(c => parseFloat(c.replace(',', '.')));
  return capacities.some(c => ![0.25, 0.50, 0.5, 1.00, 1.0].includes(c));
});

// Check 9: Validate capacity constraints
locations.forEach(loc => {
  const availableSlots = countSlotsFromCapacityLayout(loc.capacityLayout);
  const assignedSlots = countArticlesFromArticleLocation(loc.location);

  [0.25, 0.50, 1.00].forEach(size => {
    if (assignedSlots[size] > availableSlots[size]) {
      errors.push(`${loc.location}: ${assignedSlots[size]} > ${availableSlots[size]}`);
    }
  });
});
```

## Data Flow

```
Locations.csv (4,824)
  → Filter Area='D' (3,394)
  → Group by bay (324)
  → Calculate capacityLayout per bay

251209_pick.csv (512,922)
  → Filter Area='D' (512,922)
  → Sort DESC by date
  → Take 100K most recent
  → Allocate to slots (FIFO)
  → ArticleLocation (1,524) + Overflow (6,586)
```

## File Structure

```
src/
  bay-level-transform.ts    # calculateBayCapacityLayout, aggregatePicksToBayLevel
  slot-dimensions.ts        # getLocationSize, SLOT_DIMENSIONS map
scripts/
  transform-bay-level.ts    # Main: sort picks, build inventory, allocate slots
  validate-referential-integrity.ts  # 9 validation checks
```

## Critical Rules

1. **Never calculate volume percentages** - only list slot sizes
2. **Always sort picks DESC by date** - newest = best data quality
3. **Respect capacity constraints** - stop at available slots, log overflow
4. **Trust operational data** - use pick location's slot size (not article dimensions)
5. **European decimals** - use comma (0,25) not period (0.25) in output
