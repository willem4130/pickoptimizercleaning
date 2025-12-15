/**
 * Analyze Bay Patterns and Slot Type Compositions
 *
 * This script analyzes the location data to understand:
 * - Bay compositions (slot types per bay)
 * - Standard configurations
 * - Capacity layout patterns
 */

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const INPUT_DIR = path.join(__dirname, '../..', 'Example of input data from client');

interface LocationRow {
  Warehouse: string;
  'Location Class': string;
  Location: string;
  Aisle: string;
  Bay: string;
  'Slot Type': string;
  'Slot Type Description': string;
}

interface BayComposition {
  bayCode: string;
  locations: string[];
  slotTypes: Map<string, number>;
  slotTypeDescriptions: Map<string, string>;
  totalLocations: number;
}

// Slot volumes from Vertaaltabel
const SLOT_VOLUMES: Record<string, number> = {
  BLH: 2_430_000,
  BLN: 15_120_000,
  BLL: 810_000,
  PP5: 421_200,
  PP3: 316_800,
  PP7: 145_800,
  PP9: 54_000,
  PK: 140_400,
  PLK: 140_400,
  PLV: 140_400,
};

function parseLocations(): LocationRow[] {
  const filePath = path.join(INPUT_DIR, 'Locations.csv');
  const content = fs.readFileSync(filePath, 'utf-8');
  const wb = XLSX.read(content, { type: 'string' });
  const sheet = wb.Sheets[wb.SheetNames[0]!];
  return XLSX.utils.sheet_to_json(sheet, { raw: false });
}

function analyzeBayCompositions(locations: LocationRow[]): Map<string, BayComposition> {
  const bayCompositions = new Map<string, BayComposition>();

  locations.forEach(loc => {
    const bayCode = `${loc.Aisle}-${loc.Bay}`;

    if (!bayCompositions.has(bayCode)) {
      bayCompositions.set(bayCode, {
        bayCode,
        locations: [],
        slotTypes: new Map(),
        slotTypeDescriptions: new Map(),
        totalLocations: 0,
      });
    }

    const bay = bayCompositions.get(bayCode)!;
    bay.locations.push(loc.Location);
    bay.totalLocations++;

    const slotType = loc['Slot Type'] || 'UNKNOWN';
    const slotDesc = loc['Slot Type Description'] || 'Unknown';

    bay.slotTypes.set(slotType, (bay.slotTypes.get(slotType) || 0) + 1);
    bay.slotTypeDescriptions.set(slotType, slotDesc);
  });

  return bayCompositions;
}

function calculateSimplifiedCapacityLayout(bay: BayComposition): string {
  // Calculate volume-based percentages
  const locationVolumes: Array<{ location: string; slotType: string; volume: number }> = [];

  bay.locations.forEach((loc, idx) => {
    // Find which slot type this location belongs to
    let slotType = 'UNKNOWN';
    let remainingCount = idx + 1;

    for (const [type, count] of bay.slotTypes.entries()) {
      if (remainingCount <= count) {
        slotType = type;
        break;
      }
      remainingCount -= count;
    }

    const volume = SLOT_VOLUMES[slotType] || 1;
    locationVolumes.push({ location: loc, slotType, volume });
  });

  // Calculate total volume
  const totalVolume = locationVolumes.reduce((sum, lv) => sum + lv.volume, 0);

  // Calculate percentages and round to 2 decimals
  let capacities = locationVolumes.map(lv => {
    const percentage = lv.volume / totalVolume;
    return Math.round(percentage * 100) / 100;
  });

  // Adjust to ensure sum = 1.00
  const sum = capacities.reduce((a, b) => a + b, 0);
  const diff = 1.00 - sum;

  if (Math.abs(diff) > 0.01) {
    // Distribute difference to largest values
    const maxIdx = capacities.indexOf(Math.max(...capacities));
    capacities[maxIdx] += diff;
    capacities[maxIdx] = Math.round(capacities[maxIdx] * 100) / 100;
  }

  // Format with commas (European decimals)
  return capacities.map(c => c.toFixed(2).replace('.', ',')).join('-');
}

function main() {
  console.log('='.repeat(60));
  console.log('BAY PATTERN ANALYSIS');
  console.log('='.repeat(60));

  console.log('\n📂 Reading location data...');
  const locations = parseLocations();
  console.log(`✓ Loaded ${locations.length} locations`);

  console.log('\n🔍 Analyzing bay compositions...');
  const bayCompositions = analyzeBayCompositions(locations);
  console.log(`✓ Found ${bayCompositions.size} unique bays`);

  // Analyze patterns
  const patternCounts = new Map<string, number>();

  bayCompositions.forEach(bay => {
    const pattern = Array.from(bay.slotTypes.entries())
      .map(([type, count]) => `${count}×${type}`)
      .sort()
      .join('+');

    patternCounts.set(pattern, (patternCounts.get(pattern) || 0) + 1);
  });

  console.log('\n📊 Top 20 Bay Patterns:');
  console.log('-'.repeat(60));
  const sortedPatterns = Array.from(patternCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  sortedPatterns.forEach(([pattern, count], idx) => {
    console.log(`${String(idx + 1).padStart(2)}. ${pattern.padEnd(40)} (${count} bays)`);
  });

  console.log('\n💡 Sample Capacity Layouts:');
  console.log('-'.repeat(60));

  let sampleCount = 0;
  for (const bay of bayCompositions.values()) {
    if (sampleCount >= 5) break;

    const pattern = Array.from(bay.slotTypes.entries())
      .map(([type, count]) => `${count}×${type}`)
      .join('+');

    const capacityLayout = calculateSimplifiedCapacityLayout(bay);

    console.log(`\nBay: ${bay.bayCode}`);
    console.log(`  Pattern: ${pattern}`);
    console.log(`  Locations: ${bay.totalLocations}`);
    console.log(`  Capacity: ${capacityLayout}`);
    console.log(`  Sum check: ${capacityLayout.split('-').map(c => parseFloat(c.replace(',', '.'))).reduce((a, b) => a + b, 0).toFixed(2)}`);

    sampleCount++;
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ ANALYSIS COMPLETE');
  console.log('='.repeat(60));
}

main();
