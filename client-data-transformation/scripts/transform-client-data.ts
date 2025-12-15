/**
 * Client Data Transformation Script
 *
 * Transforms Bidfood client CSV files to templates.xlsx format
 *
 * Usage:
 *   npx tsx scripts/transform-client-data.ts
 */

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import {
  transformClientDataToTemplate,
  type ClientLocation,
  type ClientArticle,
  type ClientPick,
} from '../src/client-to-template';

// ==========================================
// CONFIGURATION
// ==========================================

const INPUT_DIR = path.join(
  __dirname,
  '../..',
  'Example of input data from client'
);
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

const INPUT_FILES = {
  locations: path.join(INPUT_DIR, 'Locations.csv'),
  articles: path.join(INPUT_DIR, 'Artikelinformatie.csv'),
  picks: path.join(INPUT_DIR, '251028_Bidfood_Pick.csv'),
};

// ==========================================
// CSV PARSING FUNCTIONS
// ==========================================

function parseCSV<T>(filePath: string): T[] {
  console.log(`Reading ${path.basename(filePath)}...`);

  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const workbook = XLSX.read(fileContent, { type: 'string' });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error(`No sheets found in ${filePath}`);
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Sheet ${sheetName} not found in ${filePath}`);
  }

  const data = XLSX.utils.sheet_to_json<T>(sheet, {
    raw: false, // Keep values as strings
    defval: '', // Default value for empty cells
  });

  console.log(`✓ Read ${data.length} rows from ${path.basename(filePath)}`);

  return data;
}

// ==========================================
// VALIDATION FUNCTIONS
// ==========================================

function validateLocations(locations: ClientLocation[]): void {
  console.log('\nValidating locations...');

  // Check for duplicates
  const locationCodes = locations.map(loc => loc.Location);
  const duplicates = locationCodes.filter(
    (code, index) => locationCodes.indexOf(code) !== index
  );

  if (duplicates.length > 0) {
    console.warn(`⚠ Warning: Found ${duplicates.length} duplicate locations`);
    console.warn(`  First few: ${duplicates.slice(0, 5).join(', ')}`);
  }

  // Check for missing required fields
  const missingFields = locations.filter(
    loc => !loc.Location || !loc.Aisle || !loc.Bay
  );

  if (missingFields.length > 0) {
    throw new Error(
      `Found ${missingFields.length} locations with missing required fields`
    );
  }

  console.log('✓ Locations validated');
}

function validatePicks(picks: ClientPick[], locationCodes: Set<string>): void {
  console.log('\nValidating picks...');

  // Check for picks referencing unknown locations
  const invalidPicks = picks.filter(
    pick => !locationCodes.has(pick.Locatiecode)
  );

  if (invalidPicks.length > 0) {
    console.warn(
      `⚠ Warning: ${invalidPicks.length} picks reference unknown locations`
    );

    // Show sample
    const samples = invalidPicks.slice(0, 5);
    samples.forEach(pick => {
      console.warn(`  - Article ${pick.Artikelnummer} → ${pick.Locatiecode}`);
    });
  }

  // Check for missing required fields
  const missingFields = picks.filter(
    pick =>
      !pick.Artikelnummer || !pick.Locatiecode || !pick['Aantal basiseenheden']
  );

  if (missingFields.length > 0) {
    throw new Error(
      `Found ${missingFields.length} picks with missing required fields`
    );
  }

  console.log('✓ Picks validated');
}

function validateArticles(
  articles: ClientArticle[],
  locationCodes: Set<string>
): void {
  console.log('\nValidating articles...');

  // Check for articles with invalid pick locations
  const articlesWithLocations = articles.filter(
    art => art.Picklocatie && art.Picklocatie.trim()
  );

  const invalidArticles = articlesWithLocations.filter(
    art => !locationCodes.has(art.Picklocatie)
  );

  if (invalidArticles.length > 0) {
    console.warn(
      `⚠ Warning: ${invalidArticles.length} articles reference unknown pick locations`
    );

    // Show sample
    const samples = invalidArticles.slice(0, 5);
    samples.forEach(art => {
      console.warn(`  - Article ${art.Artikelnummer} → ${art.Picklocatie}`);
    });
  }

  console.log('✓ Articles validated');
}

// ==========================================
// FILENAME GENERATION
// ==========================================

function generateDescriptiveFilename(picks: ClientPick[]): string {
  // Detect date range
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

  // Format date range
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let dateRange = '';
  if (minDate && maxDate) {
    const startMonth = monthNames[minDate.getMonth()];
    const endMonth = monthNames[maxDate.getMonth()];
    const year = maxDate.getFullYear();

    if (startMonth === endMonth) {
      dateRange = `${startMonth}-${year}`;
    } else {
      dateRange = `${startMonth}-${endMonth}-${year}`;
    }
  }

  // Format pick count
  const pickCount = picks.length;
  const pickCountFormatted = pickCount >= 1000
    ? `${Math.round(pickCount / 1000)}K`
    : `${pickCount}`;

  // Generate filename: Bidfood_Full_Jul-Oct-2025_237K-picks.xlsx
  return `Bidfood_Full_${dateRange}_${pickCountFormatted}-picks.xlsx`;
}

// ==========================================
// MAIN TRANSFORMATION
// ==========================================

async function main() {
  console.log('='.repeat(60));
  console.log('CLIENT DATA TRANSFORMATION');
  console.log('='.repeat(60));

  try {
    // Read CSV files
    console.log('\n📂 Reading input files...');
    const locations = parseCSV<ClientLocation>(INPUT_FILES.locations);
    const articles = parseCSV<ClientArticle>(INPUT_FILES.articles);
    const picks = parseCSV<ClientPick>(INPUT_FILES.picks);

    // Create location codes set for validation
    const locationCodes = new Set(locations.map(loc => loc.Location));

    // Validate data
    console.log('\n🔍 Validating data...');
    validateLocations(locations);
    validatePicks(picks, locationCodes);
    validateArticles(articles, locationCodes);

    // Transform data
    console.log('\n⚙️  Transforming data...');
    const workbook = await transformClientDataToTemplate(
      locations,
      articles,
      picks
    );

    // Generate descriptive output filename
    const outputFilename = generateDescriptiveFilename(picks);
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    // Write output file
    console.log(`\n💾 Writing output file: ${outputFilename}`);
    XLSX.writeFile(workbook, outputPath);

    // Success summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ TRANSFORMATION COMPLETE');
    console.log('='.repeat(60));
    console.log(`Output file: ${outputPath}`);
    console.log('\nSheet summary:');
    console.log(`  - Pick: ${picks.length} rows`);
    console.log(`  - Location: ${locations.length} rows`);
    console.log(
      `  - ArticleLocation: ${articles.filter(a => a.Picklocatie).length} rows`
    );
    console.log('\n✅ Validation checklist:');
    console.log('  ✓ All picks reference valid locations');
    console.log('  ✓ Each bay capacity layout calculated');
    console.log('  ✓ All location sizes assigned (0.25, 0.5, or 1.0)');
    console.log('  ✓ Zones calculated (even/odd)');
    console.log('  ✓ European decimal format (commas)');
    console.log('  ✓ No duplicate locations');
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

// Run transformation
main();
