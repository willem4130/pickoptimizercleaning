/**
 * Referential Integrity Validation
 *
 * Validates consistency across all sheets:
 * - Primary keys (articles, bay locations)
 * - Foreign key relationships
 * - Article-Location logic
 * - Capacity layout consistency
 */

import * as XLSX from 'xlsx';
import * as path from 'path';

const OUTPUT_FILE = path.join(
  __dirname,
  '..',
  'output',
  '01_Ready_For_Import',
  'Bidfood_Full_Aug-Dec-2025_100K-picks.xlsx'
);

interface ValidationIssue {
  sheet: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  category: string;
  description: string;
  count: number;
  examples: string[];
}

function main() {
  console.log('='.repeat(70));
  console.log('REFERENTIAL INTEGRITY VALIDATION');
  console.log('='.repeat(70));

  console.log(`\n📂 Reading: ${path.basename(OUTPUT_FILE)}\n`);

  const wb = XLSX.readFile(OUTPUT_FILE);
  const issues: ValidationIssue[] = [];

  // Load all sheets
  const picks = XLSX.utils.sheet_to_json(wb.Sheets['Pick']!);
  const locations = XLSX.utils.sheet_to_json(wb.Sheets['Location']!);
  const articleLocations = XLSX.utils.sheet_to_json(wb.Sheets['ArticleLocation']!);
  const locationMapping = XLSX.utils.sheet_to_json(wb.Sheets['LocationMapping']!);

  console.log('📊 Sheet Summary:');
  console.log(`  - Pick: ${picks.length.toLocaleString()} rows`);
  console.log(`  - Location: ${locations.length.toLocaleString()} rows`);
  console.log(`  - ArticleLocation: ${articleLocations.length.toLocaleString()} rows`);
  console.log(`  - LocationMapping: ${locationMapping.length.toLocaleString()} rows\n`);

  // Build lookup sets for fast validation
  const locationCodes = new Set(locations.map((l: any) => l.location));
  const articleNumbers = new Set(articleLocations.map((al: any) => al.article));
  const articleLocationPairs = new Set(
    articleLocations.map((al: any) => `${al.article}-${al.location}`)
  );

  console.log('🔍 Running validation checks...\n');

  // ============================================
  // CHECK 1: Pick.location → Location.location
  // ============================================
  console.log('1️⃣  Validating Pick.location → Location.location...');
  const invalidPickLocations = picks.filter((p: any) => !locationCodes.has(p.location));

  if (invalidPickLocations.length > 0) {
    const examples = invalidPickLocations.slice(0, 5).map((p: any) => p.location);
    issues.push({
      sheet: 'Pick',
      severity: 'ERROR',
      category: 'Missing Location',
      description: 'Picks reference bay locations not in Location sheet',
      count: invalidPickLocations.length,
      examples,
    });
    console.log(`   ❌ ERROR: ${invalidPickLocations.length} picks reference invalid locations`);
  } else {
    console.log('   ✅ All pick locations exist in Location sheet');
  }

  // ============================================
  // CHECK 2: Pick.article → ArticleLocation.article
  // ============================================
  console.log('\n2️⃣  Validating Pick.article → ArticleLocation.article...');
  const pickArticles = new Set(picks.map((p: any) => p.article));
  const missingArticles = Array.from(pickArticles).filter(a => !articleNumbers.has(a));

  if (missingArticles.length > 0) {
    const examples = missingArticles.slice(0, 5).map(String);
    issues.push({
      sheet: 'Pick',
      severity: 'WARNING',
      category: 'Missing Article',
      description: 'Picks reference articles not in ArticleLocation sheet',
      count: missingArticles.length,
      examples,
    });
    console.log(`   ⚠️  WARNING: ${missingArticles.length} articles in picks not in ArticleLocation`);
  } else {
    console.log('   ✅ All pick articles exist in ArticleLocation sheet');
  }

  // ============================================
  // CHECK 3: ArticleLocation.location → Location.location
  // ============================================
  console.log('\n3️⃣  Validating ArticleLocation.location → Location.location...');
  const invalidArticleLocations = articleLocations.filter(
    (al: any) => !locationCodes.has(al.location)
  );

  if (invalidArticleLocations.length > 0) {
    const examples = invalidArticleLocations.slice(0, 5).map((al: any) => al.location);
    issues.push({
      sheet: 'ArticleLocation',
      severity: 'ERROR',
      category: 'Missing Location',
      description: 'ArticleLocation references bay locations not in Location sheet',
      count: invalidArticleLocations.length,
      examples,
    });
    console.log(`   ❌ ERROR: ${invalidArticleLocations.length} article-locations reference invalid bays`);
  } else {
    console.log('   ✅ All article-location bays exist in Location sheet');
  }

  // ============================================
  // CHECK 4: Article-Location Pair Consistency
  // ============================================
  console.log('\n4️⃣  Validating article-location pair consistency...');
  const pickPairs = picks.map((p: any) => `${p.article}-${p.location}`);
  const uniquePickPairs = new Set(pickPairs);
  const missingPairs = Array.from(uniquePickPairs).filter(
    pair => !articleLocationPairs.has(pair)
  );

  if (missingPairs.length > 0) {
    const examples = missingPairs.slice(0, 5);
    issues.push({
      sheet: 'Pick',
      severity: 'WARNING',
      category: 'Missing Article-Location Pair',
      description: 'Picks use article-location combinations not in ArticleLocation sheet',
      count: missingPairs.length,
      examples,
    });
    console.log(`   ⚠️  WARNING: ${missingPairs.length} article-location pairs in picks not in ArticleLocation`);
  } else {
    console.log('   ✅ All pick article-location pairs exist in ArticleLocation sheet');
  }

  // ============================================
  // CHECK 5: Capacity Layout Slot Size Validation (NEW ARCHITECTURE)
  // ============================================
  console.log('\n5️⃣  Validating capacity layout values (0.25, 0.50, 1.00 only)...');
  const invalidCapacityLayoutValues = locations.filter((loc: any) => {
    const capacities = loc.capacityLayout
      .split('-')
      .map((c: string) => parseFloat(c.replace(',', '.')));
    return capacities.some((c: number) => ![0.25, 0.50, 0.5, 1.00, 1.0].includes(c));
  });

  if (invalidCapacityLayoutValues.length > 0) {
    const examples = invalidCapacityLayoutValues.slice(0, 5).map((loc: any) => {
      const capacities = loc.capacityLayout
        .split('-')
        .map((c: string) => parseFloat(c.replace(',', '.')));
      const invalid = capacities.filter((c: number) => ![0.25, 0.50, 0.5, 1.00, 1.0].includes(c));
      return `${loc.location} (invalid: ${invalid.join(', ')})`;
    });
    issues.push({
      sheet: 'Location',
      severity: 'ERROR',
      category: 'Invalid Capacity Layout Values',
      description: 'Capacity layout contains values other than 0.25, 0.50, or 1.00',
      count: invalidCapacityLayoutValues.length,
      examples,
    });
    console.log(`   ❌ ERROR: ${invalidCapacityLayoutValues.length} capacity layouts have invalid values`);
  } else {
    console.log('   ✅ All capacity layouts contain only valid slot sizes (0.25, 0.50, 1.00)');
  }

  // ============================================
  // CHECK 6: LocationSize Consistency
  // ============================================
  console.log('\n6️⃣  Validating locationSize values (0.25, 0.50, 1.00)...');
  const validSizes = [0.25, 0.5, 0.75, 1.0];
  const invalidSizes = articleLocations.filter(
    (al: any) => !validSizes.includes(al.locationSize)
  );

  if (invalidSizes.length > 0) {
    const examples = invalidSizes.slice(0, 5).map((al: any) =>
      `Article ${al.article} @ ${al.location} = ${al.locationSize}`
    );
    issues.push({
      sheet: 'ArticleLocation',
      severity: 'WARNING',
      category: 'Invalid Location Size',
      description: 'locationSize values outside expected range (0.25, 0.50, 0.75, 1.00)',
      count: invalidSizes.length,
      examples,
    });
    console.log(`   ⚠️  WARNING: ${invalidSizes.length} invalid locationSize values`);
  } else {
    console.log('   ✅ All locationSize values are valid');
  }

  // ============================================
  // CHECK 7: Duplicate Checks
  // ============================================
  console.log('\n7️⃣  Checking for duplicate keys...');

  // Duplicate bay locations
  const locationCounts = new Map<string, number>();
  locations.forEach((loc: any) => {
    locationCounts.set(loc.location, (locationCounts.get(loc.location) || 0) + 1);
  });
  const duplicateLocations = Array.from(locationCounts.entries()).filter(([_, count]) => count > 1);

  if (duplicateLocations.length > 0) {
    const examples = duplicateLocations.slice(0, 5).map(([loc, count]) => `${loc} (${count}×)`);
    issues.push({
      sheet: 'Location',
      severity: 'ERROR',
      category: 'Duplicate Location',
      description: 'Duplicate bay locations found',
      count: duplicateLocations.length,
      examples,
    });
    console.log(`   ❌ ERROR: ${duplicateLocations.length} duplicate bay locations`);
  } else {
    console.log('   ✅ No duplicate bay locations');
  }

  // Duplicate article-location pairs
  const alPairCounts = new Map<string, number>();
  articleLocations.forEach((al: any) => {
    const pair = `${al.article}-${al.location}`;
    alPairCounts.set(pair, (alPairCounts.get(pair) || 0) + 1);
  });
  const duplicatePairs = Array.from(alPairCounts.entries()).filter(([_, count]) => count > 1);

  if (duplicatePairs.length > 0) {
    const examples = duplicatePairs.slice(0, 5).map(([pair, count]) => `${pair} (${count}×)`);
    issues.push({
      sheet: 'ArticleLocation',
      severity: 'ERROR',
      category: 'Duplicate Article-Location Pair',
      description: 'Duplicate article-location pairs found',
      count: duplicatePairs.length,
      examples,
    });
    console.log(`   ❌ ERROR: ${duplicatePairs.length} duplicate article-location pairs`);
  } else {
    console.log('   ✅ No duplicate article-location pairs');
  }

  // ============================================
  // CHECK 8: OriginalPickLocation Validation
  // ============================================
  console.log('\n8️⃣  Validating originalPickLocation references...');
  const originalLocations = new Set(locationMapping.map((lm: any) => lm.originalLocation));
  const invalidOriginalLocs = picks.filter(
    (p: any) => p.originalPickLocation && !originalLocations.has(p.originalPickLocation)
  );

  if (invalidOriginalLocs.length > 0) {
    const examples = invalidOriginalLocs.slice(0, 5).map((p: any) => p.originalPickLocation);
    issues.push({
      sheet: 'Pick',
      severity: 'WARNING',
      category: 'Invalid Original Location',
      description: 'originalPickLocation references not in LocationMapping',
      count: invalidOriginalLocs.length,
      examples,
    });
    console.log(`   ⚠️  WARNING: ${invalidOriginalLocs.length} invalid originalPickLocation references`);
  } else {
    console.log('   ✅ All originalPickLocation references are valid');
  }

  // ============================================
  // CHECK 9: Capacity Constraint Validation (NEW ARCHITECTURE)
  // ============================================
  console.log('\n9️⃣  Validating slot capacity constraints...');
  const capacityViolations: string[] = [];

  locations.forEach((loc: any) => {
    const bayCode = loc.location;

    // Parse capacityLayout to count available slots per size
    const capacities = loc.capacityLayout
      .split('-')
      .map((c: string) => parseFloat(c.replace(',', '.')));

    const availableSlots = new Map<number, number>();
    availableSlots.set(0.25, 0);
    availableSlots.set(0.50, 0);
    availableSlots.set(1.00, 0);

    capacities.forEach((size: number) => {
      const normalizedSize = size === 0.5 ? 0.50 : size;
      availableSlots.set(normalizedSize, (availableSlots.get(normalizedSize) || 0) + 1);
    });

    // Count assigned articles per size from ArticleLocation
    const assignedSlots = new Map<number, number>();
    assignedSlots.set(0.25, 0);
    assignedSlots.set(0.50, 0);
    assignedSlots.set(1.00, 0);

    articleLocations.forEach((al: any) => {
      if (al.location === bayCode) {
        const size = parseFloat(al.locationSize.toString());
        const normalizedSize = size === 0.5 ? 0.50 : size;
        assignedSlots.set(normalizedSize, (assignedSlots.get(normalizedSize) || 0) + 1);
      }
    });

    // Check for violations
    [0.25, 0.50, 1.00].forEach(size => {
      const available = availableSlots.get(size) || 0;
      const assigned = assignedSlots.get(size) || 0;

      if (assigned > available) {
        capacityViolations.push(
          `${bayCode} size ${size.toFixed(2)}: ${assigned} assigned > ${available} available`
        );
      }
    });
  });

  if (capacityViolations.length > 0) {
    const examples = capacityViolations.slice(0, 5);
    issues.push({
      sheet: 'ArticleLocation',
      severity: 'ERROR',
      category: 'Capacity Constraint Violation',
      description: 'More articles assigned than available slots',
      count: capacityViolations.length,
      examples,
    });
    console.log(`   ❌ ERROR: ${capacityViolations.length} capacity constraint violations`);
  } else {
    console.log('   ✅ No capacity violations (assigned ≤ available for all bays)');
  }

  // ============================================
  // SUMMARY
  // ============================================
  console.log('\n' + '='.repeat(70));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(70));

  const errors = issues.filter(i => i.severity === 'ERROR');
  const warnings = issues.filter(i => i.severity === 'WARNING');

  if (errors.length === 0 && warnings.length === 0) {
    console.log('\n✅ PERFECT! No issues found. Data is 100% consistent.\n');
  } else {
    console.log(`\n📋 Found ${errors.length} errors and ${warnings.length} warnings:\n`);

    if (errors.length > 0) {
      console.log('❌ ERRORS (Must fix):');
      errors.forEach(issue => {
        console.log(`\n  ${issue.sheet} - ${issue.category}`);
        console.log(`  ${issue.description}`);
        console.log(`  Count: ${issue.count.toLocaleString()}`);
        console.log(`  Examples: ${issue.examples.join(', ')}`);
      });
    }

    if (warnings.length > 0) {
      console.log('\n⚠️  WARNINGS (Review recommended):');
      warnings.forEach(issue => {
        console.log(`\n  ${issue.sheet} - ${issue.category}`);
        console.log(`  ${issue.description}`);
        console.log(`  Count: ${issue.count.toLocaleString()}`);
        console.log(`  Examples: ${issue.examples.join(', ')}`);
      });
    }
  }

  console.log('\n' + '='.repeat(70));

  // Return exit code based on errors
  if (errors.length > 0) {
    process.exit(1);
  }
}

main();
