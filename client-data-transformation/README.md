# Bidfood Client Data Transformation

Transform Bidfood warehouse CSV files to standardized template format for warehouse optimization simulation.

## Quick Start

```bash
# Install dependencies (first time only)
npm install

# Run transformation
npm run transform
```

Output file will be created in `output/` with descriptive name:
```
output/Bidfood_Full_Jul-Oct-2025_237K-picks.xlsx
```

## Input Files

Place these CSV files in `../Example of input data from client/`:

- **Locations.csv** (4,824 locations) - Location master with slot types, aisles, bays
- **Artikelinformatie.csv** (3,006 articles) - Article master with dimensions
- **251028_Bidfood_Pick.csv** (237K picks) - Pick transaction history

## Output Format

Single Excel file with 3 sheets ready for simulation tool import:

### 1. Pick Sheet (237,333 rows)
- pickList, location, article, quantity, pickTime, salesOrder, salesOrderCategory

### 2. Location Sheet (4,824 rows)
- location, zone, capacityLayout, locationGroup (bay code)
- Capacity layout uses European decimals (commas), sums to 1.0 per bay
- Zone calculated as ISEVEN(last 3 digits of location)

### 3. ArticleLocation Sheet (2,107 rows)
- article, location, articleDescription, articleVolume, locationSize
- Location sizes: 0.25 (small), 0.5 (medium), 1.0 (large)
- remarkOne: "C" (Case Pick) or "R" (Reserve)

## Filename Convention

Format: `{Warehouse}_{Type}_{Period}_{PickCount}.xlsx`

Examples:
- `Bidfood_Full_Jul-Oct-2025_237K-picks.xlsx` (all data, 237K picks)
- `Bidfood_Subset_Aug-2025_50K-picks.xlsx` (single month, ~50K picks)
- `Bidfood_Subset_Week32_12K-picks.xlsx` (single week, ~12K picks)

## Key Algorithms

### Bay Grouping
- Bay code = Aisle + "-" + Bay (e.g., "11-021")
- All locations in same bay share capacity layout

### Capacity Layout
- Volume-based distribution within each bay
- Each bay's layout sums to exactly 1.0
- European decimal format (commas): "0,1829-0,0951-..."

### Location Size Mapping
Based on slot type volumes:
- **0.25**: PP3, PP7, PP9, PK (< 250K cm³)
- **0.5**: BLL, PP5 (250K-1M cm³)
- **1.0**: BLH, BLN (> 1M cm³)

### Slot Type Dimensions

| Slot Type | Width | Depth | Height | Volume (cm³) | Size |
|-----------|-------|-------|--------|--------------|------|
| BLH | 120 | 90 | 225 | 2,430,000 | 1.0 |
| BLN* | 240 | 180 | 350 | 15,120,000 | 1.0 |
| BLL | 120 | 90 | 75 | 810,000 | 0.5 |
| PP5 | 52 | 90 | 90 | 421,200 | 0.5 |
| PP3 | 44 | 90 | 80 | 316,800 | 0.25 |
| PP7 | 18 | 90 | 90 | 145,800 | 0.25 |
| PP9 | 30 | 90 | 20 | 54,000 | 0.25 |
| PK | 52 | 90 | 30 | 140,400 | 0.25 |

*BLN is double-width (2 × 120 = 240)

## Validation

Automatic validation checks:
- ✓ All picks reference valid locations
- ✓ Each bay capacity layout sums to 1.0 (±0.001)
- ✓ All location sizes are 0.25, 0.5, or 1.0
- ✓ Zones calculated correctly (even/odd)
- ✓ No duplicate locations
- ⚠ Warns about picks referencing unknown locations (different warehouse zones)

## Typical Pick Count Ranges

For simulation tool (recommended: 10K-100K picks):
- **Full dataset**: 237K picks (Jul-Oct 2025) - May need to split
- **Monthly**: ~60-80K picks per month
- **Weekly**: ~15-20K picks per week
- **Daily**: ~2-3K picks per day

## Future Enhancements

To create subsets with controlled pick counts:
1. Date range filtering (e.g., single month, week)
2. Customer filtering (specific customers only)
3. Article filtering (ABC analysis, top movers)
4. Random sampling (stratified by location)

## Project Structure

```
client-data-transformation/
├── src/
│   ├── slot-dimensions.ts       # Slot type definitions & volumes
│   └── client-to-template.ts    # Main transformation logic
├── scripts/
│   └── transform-client-data.ts # Execution script
├── output/
│   └── Bidfood_Full_Jul-Oct-2025_237K-picks.xlsx
├── package.json
├── tsconfig.json
└── README.md
```

## Troubleshooting

**Problem**: `npm install` fails
**Solution**: Make sure you're in the `client-data-transformation/` folder

**Problem**: Input files not found
**Solution**: CSV files must be in `../Example of input data from client/`

**Problem**: Output file too large for simulation tool
**Solution**: Future: Add date range filtering to reduce pick count

**Problem**: Capacity layout doesn't sum to 1.0
**Solution**: Script validates this automatically, check console warnings

## Technical Details

- **Language**: TypeScript
- **Runtime**: Node.js 20+
- **Dependencies**: xlsx (Excel file generation)
- **Memory**: Handles 237K+ rows efficiently
- **Performance**: ~5-10 seconds for full transformation
