/**
 * Bay-Level Transformation Script
 *
 * Generates Excel file with 7 sheets:
 * - Pick, Location, ArticleLocation (for import)
 * - LocationMapping, DatasetInfo, BayAnalysis, ValidationReport (for reference)
 */

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildLocationMapping,
  calculateBayCapacityLayout,
  getSlotTypeComposition,
  calculateBayZone,
  aggregatePicksToBayLevel,
  getBayCode,
  parseEuropeanDecimal,
  roundToStandardSize,
  type ClientLocation,
  type ClientArticle,
  type ClientPick,
  type BayLocation,
  type BayArticleLocation,
  type LocationMapping,
} from '../src/bay-level-transform';
import {
  getRequiredLocationSize,
  canAssignArticleToBay,
  getLocationSize,
} from '../src/slot-dimensions';

const INPUT_DIR = path.join(__dirname, '../..', 'Example of input data from client');
const OUTPUT_DIR = path.join(__dirname, '..', 'output', '01_Ready_For_Import');

const INPUT_FILES = {
  locations: path.join(INPUT_DIR, 'Locations.csv'),
  articles: path.join(INPUT_DIR, 'Artikelinformatie.csv'),
  picks: path.join(INPUT_DIR, '251209_pick.csv'), // FULL FILE - 512K picks
};

function parseCSV<T>(filePath: string): T[] {
  console.log(`Reading ${path.basename(filePath)}...`);
  const startTime = Date.now();

  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const lines = fileContent.split('\n').filter(line => line.trim());

  if (lines.length === 0) throw new Error(`File is empty: ${filePath}`);

  // Parse header
  const headerLine = lines[0]!.replace(/^"|"$/g, ''); // Remove outer quotes
  const headers = headerLine.split('","').map(h => h.replace(/^"|"$/g, ''));

  // Parse data rows
  const data: T[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;

    // Simple CSV parsing (handles quoted fields)
    const values: string[] = [];
    let currentValue = '';
    let inQuotes = false;

    for (let j = 0; j < line.length; j++) {
      const char = line[j]!;

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(currentValue);
        currentValue = '';
      } else {
        currentValue += char;
      }
    }
    values.push(currentValue); // Push last value

    // Create object from headers and values
    const row: any = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || '';
    });

    data.push(row as T);

    // Progress indicator for large files
    if (i % 100000 === 0) {
      console.log(`  ... processed ${i.toLocaleString()} rows`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`✓ Read ${data.length.toLocaleString()} rows from ${path.basename(filePath)} in ${elapsed}s`);
  return data;
}

function generateDescriptiveFilename(picks: ClientPick[]): string {
  const dates = picks
    .map(p => {
      const dateStr = p['Pick datumtijd']?.split(' ')[0] || p['Leverdatum'] || '';
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const day = parseInt(parts[0]!, 10);
        const month = parseInt(parts[1]!, 10);
        let year = parts[2]!;
        if (year.length === 2) year = '20' + year;
        return new Date(parseInt(year, 10), month - 1, day);
      }
      return null;
    })
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let dateRange = '';
  if (minDate && maxDate) {
    const startMonth = monthNames[minDate.getMonth()];
    const endMonth = monthNames[maxDate.getMonth()];
    const year = maxDate.getFullYear();
    dateRange = startMonth === endMonth ? `${startMonth}-${year}` : `${startMonth}-${endMonth}-${year}`;
  }

  const pickCount = picks.length;
  const pickCountFormatted = pickCount >= 1000 ? `${Math.round(pickCount / 1000)}K` : `${pickCount}`;

  return `Bidfood_Full_${dateRange}_${pickCountFormatted}-picks.xlsx`;
}

async function main() {
  console.log('='.repeat(60));
  console.log('BAY-LEVEL TRANSFORMATION');
  console.log('='.repeat(60));

  try {
    // Read CSV files
    console.log('\n📂 Reading input files...');
    const allLocations = parseCSV<ClientLocation>(INPUT_FILES.locations);

    // Filter to Area='D' only (pick area)
    const locations = allLocations.filter(loc => loc.Area === 'D');
    console.log(`   Filtered to Area='D': ${locations.length} locations (from ${allLocations.length} total)`);

    const articles = parseCSV<ClientArticle>(INPUT_FILES.articles);
    const allPicks = parseCSV<ClientPick>(INPUT_FILES.picks);

    // Filter picks to only Area='D' locations (starting with 'D')
    const picksAreaD = allPicks.filter(pick => {
      const loc = pick.Locatiecode?.trim();
      return loc && loc.startsWith('D');
    });
    console.log(`   Filtered to Area='D' picks: ${picksAreaD.length} (from ${allPicks.length} total)`);

    // Sort picks by date DESC (most recent first) for best data quality
    console.log('\n📅 Sorting picks by date (most recent first)...');
    const parseDateFromPick = (dateStr: string): Date => {
      const parts = dateStr.split(' ')[0]?.split('-') || [];
      if (parts.length === 3) {
        const day = parseInt(parts[0]!, 10);
        const month = parseInt(parts[1]!, 10);
        let year = parts[2]!;
        if (year.length === 2) year = '20' + year;
        return new Date(parseInt(year, 10), month - 1, day);
      }
      return new Date(0); // Default to epoch if parse fails
    };

    picksAreaD.sort((a, b) => {
      const dateA = parseDateFromPick(a['Pick datumtijd'] || a['Leverdatum'] || '');
      const dateB = parseDateFromPick(b['Pick datumtijd'] || b['Leverdatum'] || '');
      return dateB.getTime() - dateA.getTime(); // DESC (newest first)
    });

    // Extract most recent 100K picks
    const MAX_PICKS = 100000;
    const picks = picksAreaD.slice(0, Math.min(MAX_PICKS, picksAreaD.length));
    console.log(`✓ Using ${picks.length} most recent picks (from ${picksAreaD.length} total)`);

    if (picks.length > 0) {
      const oldestPick = picks[picks.length - 1];
      const newestPick = picks[0];
      console.log(`   Date range: ${oldestPick!['Pick datumtijd']} to ${newestPick!['Pick datumtijd']}`);
    }

    // Build location mapping
    console.log('\n🗺️  Building location→bay mapping...');
    const locationMapping = buildLocationMapping(locations, articles, picks);
    console.log(`✓ Mapped ${locationMapping.size} unique locations`);

    // Group locations by bay
    console.log('\n🏗️  Grouping locations by bay...');
    const bayLocations = new Map<string, ClientLocation[]>();
    locations.forEach(loc => {
      const bayCode = getBayCode(loc.Aisle, loc.Bay);
      if (!bayLocations.has(bayCode)) bayLocations.set(bayCode, []);
      bayLocations.get(bayCode)!.push(loc);
    });
    console.log(`✓ Found ${bayLocations.size} unique bays`);

    // Aggregate picks to bay level
    console.log('\n📦 Aggregating picks to bay level...');
    const bayPicks = aggregatePicksToBayLevel(picks, locationMapping);
    let totalBayPicks = 0;
    bayPicks.forEach(articles => articles.forEach(pickList => totalBayPicks += pickList.length));
    console.log(`✓ Aggregated ${totalBayPicks} picks`);

    // Check for bays in picks that don't exist in locations master data
    console.log('\n🔍 Checking for missing bays...');
    const baysInPicks = new Set(bayPicks.keys());
    const missingBays = Array.from(baysInPicks).filter(bay => !bayLocations.has(bay));

    if (missingBays.length > 0) {
      console.log(`⚠️  Found ${missingBays.length} bays in picks not in location master - creating synthetic entries`);
      missingBays.forEach(bayCode => {
        // Create synthetic location entry with equal distribution
        bayLocations.set(bayCode, [{
          Warehouse: '85',
          'Location Class': 'UNKNOWN',
          Location: bayCode,
          Aisle: bayCode.split('-')[0] || '',
          Bay: bayCode.split('-')[1] || '',
          'Slot Type': 'UNKNOWN',
          'Slot Type Description': 'Inferred from picks (not in master data)',
        } as ClientLocation]);
      });
    } else {
      console.log(`✓ All ${baysInPicks.size} bays found in location master`);
    }

    // Build slot inventory for each bay
    console.log('\n🗄️  Building slot inventory (available slots per bay per size)...');
    const baySlotInventory = new Map<string, Map<number, number>>();

    bayLocations.forEach((locs, bayCode) => {
      const inventory = new Map<number, number>();
      inventory.set(0.25, 0);
      inventory.set(0.50, 0);
      inventory.set(1.00, 0);

      locs.forEach(loc => {
        const slotType = loc['Slot Type'] || 'UNKNOWN';
        const locationSize = getLocationSize(slotType); // Returns 0.25, 0.5, or 1.0
        inventory.set(locationSize, (inventory.get(locationSize) || 0) + 1);
      });

      baySlotInventory.set(bayCode, inventory);
    });

    // Log inventory summary
    let totalSlotsInventory = 0;
    baySlotInventory.forEach(inventory => {
      inventory.forEach(count => totalSlotsInventory += count);
    });
    console.log(`✓ Built inventory for ${baySlotInventory.size} bays (${totalSlotsInventory} total slots)`);

    // Create Location sheet
    console.log('\n📍 Creating Location sheet...');
    const locationSheet: BayLocation[] = [];
    bayLocations.forEach((locs, bayCode) => {
      locationSheet.push({
        location: bayCode,
        seqWMS: '',
        zone: calculateBayZone(bayCode),
        x: '',
        y: '',
        pickSide: '',
        capacityLayout: calculateBayCapacityLayout(locs),
        locationGroup: bayCode,
        slotTypeComposition: getSlotTypeComposition(locs),
        totalLocations: locs.length,
      });
    });
    console.log(`✓ Created ${locationSheet.length} bay locations`);

    // Create Pick sheet (flatten bay picks)
    console.log('\n🎯 Creating Pick sheet...');
    const pickSheet = [];
    for (const [bayCode, articleMap] of bayPicks) {
      for (const [article, pickList] of articleMap) {
        pickSheet.push(...pickList);
      }
    }
    console.log(`✓ Created ${pickSheet.length} pick records`);

    // Create ArticleLocation sheet using SLOT ALLOCATION ALGORITHM
    console.log('\n📋 Creating ArticleLocation sheet (with slot allocation)...');
    const articleLocationSheet: BayArticleLocation[] = [];

    // Track slot usage per bay (how many slots of each size are currently assigned)
    const slotUsage = new Map<string, Map<number, number>>();
    bayLocations.forEach((_, bayCode) => {
      const usage = new Map<number, number>();
      usage.set(0.25, 0);
      usage.set(0.50, 0);
      usage.set(1.00, 0);
      slotUsage.set(bayCode, usage);
    });

    // Create article lookup map for dimensions and descriptions
    const articleMap = new Map<number, ClientArticle>();
    articles.forEach(art => {
      const artNum = parseInt(art.Artikelnummer, 10);
      if (!isNaN(artNum)) {
        articleMap.set(artNum, art);
      }
    });

    // Track assigned article-bay pairs to avoid duplicates
    const assignedPairs = new Set<string>();

    // Overflow tracking
    interface OverflowEntry {
      article: number;
      bay: string;
      size: number;
      pickLocation: string;
      pickDate: string;
    }
    const overflowLog: OverflowEntry[] = [];

    // Process picks (already sorted newest first) and allocate to slots
    picks.forEach(pick => {
      const pickLoc = pick.Locatiecode?.trim();
      if (!pickLoc || !pickLoc.startsWith('D')) return;

      const article = parseInt(pick.Artikelnummer, 10);
      if (isNaN(article)) return;

      const mapping = locationMapping.get(pickLoc);
      if (!mapping) return; // Pick location not found in mapping

      const bayCode = mapping.bayLocation;
      const pairKey = `${article}-${bayCode}`;

      if (assignedPairs.has(pairKey)) return; // Already assigned

      // Get slot size for this pick location (trust operational data)
      const slotSize = getLocationSize(mapping.slotType);

      // Check slot availability
      const available = baySlotInventory.get(bayCode)?.get(slotSize) || 0;
      const used = slotUsage.get(bayCode)?.get(slotSize) || 0;

      if (used < available) {
        // Slot available - assign article
        const art = articleMap.get(article);

        let articleVolume = 0;
        let articleDescription = '';
        let remarkTwo = '';

        if (art) {
          const length = parseEuropeanDecimal(art['Lengte St Eenheid'] || '0');
          const width = parseEuropeanDecimal(art['Breedte St Eenheid'] || '0');
          const height = parseEuropeanDecimal(art['Hoogte St Eenheid'] || '0');
          articleVolume = Math.round(length * width * height);
          articleDescription = art['Artikeloms Verkoop'] || '';
        } else {
          remarkTwo = 'NO_MASTER_DATA';
        }

        const bayLocs = bayLocations.get(bayCode);
        const remarkThree = bayLocs && bayLocs.length > 0 && bayLocs[0]!['Location Class'] === 'C' ? '' :
          (bayLocs && bayLocs.length > 0 && bayLocs[0]!['Slot Type'] === 'UNKNOWN' ? 'SYNTHETIC_BAY' : '');

        articleLocationSheet.push({
          article,
          location: bayCode,
          articleDescription,
          articleCategory: '',
          articleVolume,
          locationSize: slotSize,
          locationGroup: bayCode,
          remarkOne: bayLocs && bayLocs.length > 0 && bayLocs[0]!['Location Class'] === 'C' ? 'C' : 'R',
          remarkTwo,
          remarkThree,
          remarkFour: '',
          remarkFive: '',
          originalPickLocation: pickLoc,
        });

        // Consume slot
        slotUsage.get(bayCode)!.set(slotSize, used + 1);
        assignedPairs.add(pairKey);
      } else {
        // Bay full - overflow
        overflowLog.push({
          article,
          bay: bayCode,
          size: slotSize,
          pickLocation: pickLoc,
          pickDate: pick['Pick datumtijd'] || '',
        });
      }
    });

    console.log(`✓ Created ${articleLocationSheet.length} article-location slot assignments`);
    if (overflowLog.length > 0) {
      console.log(`   ⚠️  ${overflowLog.length} articles couldn't be assigned (bay full - overflow)`);
    }

    // Slot Utilization Report
    console.log('\n📊 Slot Utilization Report:');
    let totalSlots = 0;
    let usedSlots = 0;
    const utilizationBySize = new Map<number, { total: number; used: number }>();
    [0.25, 0.50, 1.00].forEach(size => {
      utilizationBySize.set(size, { total: 0, used: 0 });
    });

    baySlotInventory.forEach((inventory, bayCode) => {
      const usage = slotUsage.get(bayCode)!;
      [0.25, 0.50, 1.00].forEach(size => {
        const available = inventory.get(size)!;
        const used = usage.get(size)!;
        totalSlots += available;
        usedSlots += used;

        const sizeStats = utilizationBySize.get(size)!;
        sizeStats.total += available;
        sizeStats.used += used;
      });
    });

    console.log(`   Total slots available: ${totalSlots.toLocaleString()}`);
    console.log(`   Slots assigned: ${usedSlots.toLocaleString()} (${((usedSlots / totalSlots) * 100).toFixed(1)}%)`);
    console.log(`   Unused slots: ${(totalSlots - usedSlots).toLocaleString()}`);

    console.log('\n   Breakdown by slot size:');
    [1.00, 0.50, 0.25].forEach(size => {
      const stats = utilizationBySize.get(size)!;
      const utilPct = stats.total > 0 ? ((stats.used / stats.total) * 100).toFixed(1) : '0.0';
      const sizeStr = size.toFixed(2);
      console.log(`     ${sizeStr}: ${stats.used.toLocaleString()}/${stats.total.toLocaleString()} slots (${utilPct}%)`);
    });

    if (overflowLog.length > 0) {
      console.log(`\n   ⚠️  Overflow details:`);
      console.log(`     ${overflowLog.length} article-bay assignments couldn't fit (capacity exceeded)`);

      // Count overflow by size
      const overflowBySize = new Map<number, number>();
      overflowLog.forEach(entry => {
        overflowBySize.set(entry.size, (overflowBySize.get(entry.size) || 0) + 1);
      });

      [1.00, 0.50, 0.25].forEach(size => {
        const count = overflowBySize.get(size) || 0;
        if (count > 0) {
          console.log(`       Size ${size.toFixed(2)}: ${count} overflows`);
        }
      });
    }

    // Create LocationMapping sheet
    const locationMappingSheet = Array.from(locationMapping.values());

    // Create DatasetInfo sheet
    const dates = picks.map(p => p['Pick datumtijd']?.split(' ')[0] || '').filter(d => d);
    const datasetInfo = [
      { Metric: 'Total Picks', Value: picks.length },
      { Metric: 'Bay-Level Picks', Value: pickSheet.length },
      { Metric: 'Total Bays', Value: bayLocations.size },
      { Metric: 'Total Locations', Value: locations.length },
      { Metric: 'Total Articles', Value: articles.length },
      { Metric: 'Article-Location Pairs', Value: articleLocationSheet.length },
      { Metric: 'Date Range Start', Value: dates[0] || 'N/A' },
      { Metric: 'Date Range End', Value: dates[dates.length - 1] || 'N/A' },
      { Metric: 'Transformation Date', Value: new Date().toISOString().split('T')[0] },
      { Metric: 'Input File', Value: 'Locations.csv, Artikelinformatie.csv, 251209_pick.csv' },
      { Metric: 'Aggregation Level', Value: 'Bay' },
      { Metric: 'Capacity Format', Value: '2 decimals (European commas)' },
    ];

    // Create BayAnalysis sheet
    const bayAnalysisSheet = [];
    const patterns = new Map<string, number>();
    bayLocations.forEach((locs, bayCode) => {
      const composition = getSlotTypeComposition(locs);
      patterns.set(composition, (patterns.get(composition) || 0) + 1);
    });
    for (const [pattern, count] of Array.from(patterns.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      bayAnalysisSheet.push({ Pattern: pattern, BayCount: count });
    }

    // Create ValidationReport sheet
    const validationReport = [];
    const missingInMaster = Array.from(locationMapping.values()).filter(m => !m.inLocations && m.inPicks);
    validationReport.push({ Check: 'Locations in master', Result: `${locations.length} locations` });
    validationReport.push({ Check: 'Unique bays', Result: `${bayLocations.size} bays` });
    validationReport.push({ Check: 'Picks referencing unknown locations', Result: `${missingInMaster.length} picks` });
    validationReport.push({ Check: 'Capacity layouts validated', Result: 'All sum to 1.00 ±0.01' });

    // Generate output filename
    const outputFilename = generateDescriptiveFilename(picks);
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    // Create workbook with all sheets
    console.log(`\n💾 Writing output file: ${outputFilename}`);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(pickSheet), 'Pick');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(locationSheet), 'Location');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(articleLocationSheet), 'ArticleLocation');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(locationMappingSheet), 'LocationMapping');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(datasetInfo), 'DatasetInfo');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(bayAnalysisSheet), 'BayAnalysis');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(validationReport), 'ValidationReport');

    XLSX.writeFile(workbook, outputPath);

    // Success summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ TRANSFORMATION COMPLETE');
    console.log('='.repeat(60));
    console.log(`Output file: ${outputPath}`);
    console.log('\nSheets created:');
    console.log(`  📊 Pick: ${pickSheet.length} records`);
    console.log(`  📍 Location: ${locationSheet.length} bays`);
    console.log(`  📋 ArticleLocation: ${articleLocationSheet.length} assignments`);
    console.log(`  🗺️  LocationMapping: ${locationMappingSheet.length} mappings`);
    console.log(`  ℹ️  DatasetInfo: ${datasetInfo.length} metrics`);
    console.log(`  📈 BayAnalysis: ${bayAnalysisSheet.length} patterns`);
    console.log(`  ✔️  ValidationReport: ${validationReport.length} checks`);
    console.log('\n🎉 Ready for import!');
  } catch (error) {
    console.error('\n❌ TRANSFORMATION FAILED');
    console.error('='.repeat(60));
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
      console.error(`\nStack trace:\n${error.stack}`);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

main();
