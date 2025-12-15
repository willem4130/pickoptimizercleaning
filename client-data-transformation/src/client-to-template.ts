/**
 * Client Data to Template Transformation
 *
 * Transforms Bidfood client CSV files to templates.xlsx format
 *
 * Input files:
 * - Locations.csv
 * - Artikelinformatie.csv
 * - 251028_Bidfood_Pick.csv
 *
 * Output: Single Excel with 3 sheets (PICK, LOCATION, ARTICLELOCATION)
 */

import * as XLSX from 'xlsx';
import {
  calculateCapacityLayout,
  formatCapacityLayout,
  getLocationSize,
  validateCapacityLayout,
} from './slot-dimensions';

// ==========================================
// INPUT TYPES (Client CSV Structure)
// ==========================================

export interface ClientLocation {
  Warehouse: string;
  'Location Class': string; // C = Case pick, R = Reserve
  'Location Class Description': string;
  Location: string; // e.g., "D11-021-11"
  Area: string;
  Aisle: string;
  Bay: string;
  Level: string;
  Position: string;
  'Slot Type': string; // e.g., "BLL", "PP5", or empty for Reserve
  'Slot Type Description': string;
  'Dedication Type': string;
  'Dedication Type Description': string;
}

export interface ClientArticle {
  Artikelnummer: string;
  'Artikeloms Verkoop': string;
  'Lengte St Eenheid': string;
  'Breedte St Eenheid': string;
  'Hoogte St Eenheid': string;
  Picklocatie: string;
  [key: string]: string; // Other columns we don't need
}

export interface ClientPick {
  Klantnummer: string;
  'Pickorder nummer': string;
  'Pickorder omschrijving': string;
  'Aanmaak datumtijd': string;
  'Pick datumtijd': string;
  Leverdatum: string;
  'oLPN nummer': string;
  Artikelnummer: string;
  Locatiecode: string;
  Magazijn: string;
  'Aantal basiseenheden': string;
  Ordertype: string;
  [key: string]: string;
}

// ==========================================
// OUTPUT TYPES (Template Structure)
// ==========================================

export interface TemplatePick {
  pickList: number; // Auto-incremented ID
  location: string;
  article: number;
  quantity: number;
  pickTime: string; // DD-MM-YYYY format
  salesOrder: string;
  salesOrderCategory: string;
}

export interface TemplateLocation {
  location: string;
  seqWMS: string;
  zone: boolean;
  x: string;
  y: string;
  pickSide: string;
  capacityLayout: string;
  locationGroup: string; // Bay code (aisle-bay)
}

export interface TemplateArticleLocation {
  article: number;
  location: string;
  articleDescription: string;
  articleCategory: string;
  articleVolume: number;
  locationSize: number; // 0.25, 0.5, or 1.0
  locationGroup: string; // Bay code
  remarkOne: string; // C or R (Case/Reserve)
  remarkTwo: string;
  remarkThree: string;
  remarkFour: string;
  remarkFive: string;
}

// ==========================================
// TRANSFORMATION FUNCTIONS
// ==========================================

/**
 * Calculate zone: TRUE if last 3 digits of location code are EVEN
 */
export function calculateZone(locationCode: string): boolean {
  const parts = locationCode.split('-');
  const lastPart = parts[parts.length - 1] || '';
  const lastDigits = parseInt(lastPart.padStart(3, '0'), 10);
  return lastDigits % 2 === 0;
}

/**
 * Get bay code from aisle and bay
 */
export function getBayCode(aisle: string, bay: string): string {
  return `${aisle}-${bay}`;
}

/**
 * Format date from DD-MM-YYYY to D-M-YYYY (remove leading zeros)
 */
export function formatPickDate(dateStr: string): string {
  // Input: "04-07-2025" or "04-07-25"
  // Output: "4-7-2025"
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const day = parseInt(parts[0]!, 10).toString();
    const month = parseInt(parts[1]!, 10).toString();
    let year = parts[2]!;

    // Handle 2-digit year
    if (year.length === 2) {
      year = '20' + year;
    }

    return `${day}-${month}-${year}`;
  }
  return dateStr;
}

/**
 * Parse European decimal string to number
 */
export function parseEuropeanDecimal(value: string): number {
  return parseFloat(value.replace(',', '.'));
}

/**
 * Transform locations to template format with capacity layout
 */
export function transformLocations(
  locations: ClientLocation[]
): TemplateLocation[] {
  // Group locations by bay
  const bayGroups = new Map<string, ClientLocation[]>();

  locations.forEach(loc => {
    const bayCode = getBayCode(loc.Aisle, loc.Bay);
    if (!bayGroups.has(bayCode)) {
      bayGroups.set(bayCode, []);
    }
    bayGroups.get(bayCode)!.push(loc);
  });

  // Process each bay and calculate capacity layout
  const results: TemplateLocation[] = [];

  bayGroups.forEach((bayLocations, bayCode) => {
    // Calculate capacity layout for this bay
    const capacityMap = calculateCapacityLayout(
      bayLocations.map(loc => ({
        location: loc.Location,
        slotType: loc['Slot Type'] || null,
      }))
    );

    // Get all capacities in order
    const capacities = bayLocations.map(
      loc => capacityMap.get(loc.Location) || 0
    );

    // Validate capacity layout sums to 1.0
    if (!validateCapacityLayout(capacities)) {
      console.warn(
        `Warning: Bay ${bayCode} capacity layout does not sum to 1.0:`,
        capacities.reduce((a, b) => a + b, 0)
      );
    }

    // Build the full capacity layout string (all capacities joined)
    const fullLayout = formatCapacityLayout(capacities);

    // Create output records
    bayLocations.forEach(loc => {
      results.push({
        location: loc.Location,
        seqWMS: '',
        zone: calculateZone(loc.Location),
        x: '',
        y: '',
        pickSide: '',
        capacityLayout: fullLayout,
        locationGroup: bayCode,
      });
    });
  });

  return results;
}

/**
 * Transform picks to template format
 */
export function transformPicks(picks: ClientPick[]): TemplatePick[] {
  return picks.map((pick, index) => {
    // Parse pick date from "DD-MM-YYYY HH:MM:SS" to "D-M-YYYY"
    const pickDateParts = pick['Pick datumtijd']?.split(' ') || [];
    const datePart = pickDateParts[0] || pick['Leverdatum'] || '';
    const formattedDate = formatPickDate(datePart);

    return {
      pickList: 10081994 + index, // Start from template's first ID
      location: pick.Locatiecode,
      article: parseInt(pick.Artikelnummer, 10),
      quantity: parseInt(pick['Aantal basiseenheden'] || '1', 10),
      pickTime: formattedDate,
      salesOrder: pick['Pickorder nummer'],
      salesOrderCategory: pick.Ordertype || '',
    };
  });
}

/**
 * Transform article locations to template format
 */
export function transformArticleLocations(
  articles: ClientArticle[],
  locations: ClientLocation[]
): TemplateArticleLocation[] {
  const results: TemplateArticleLocation[] = [];

  // Create a map of location code to location info
  const locationMap = new Map(
    locations.map(loc => [loc.Location, loc])
  );

  // Process each article
  articles.forEach(article => {
    const pickLocation = article.Picklocatie?.trim();

    if (!pickLocation) {
      return; // Skip articles without pick location
    }

    const location = locationMap.get(pickLocation);

    if (!location) {
      console.warn(
        `Warning: Article ${article.Artikelnummer} references unknown location ${pickLocation}`
      );
      return;
    }

    // Calculate article volume
    const length = parseEuropeanDecimal(article['Lengte St Eenheid'] || '0');
    const width = parseEuropeanDecimal(article['Breedte St Eenheid'] || '0');
    const height = parseEuropeanDecimal(article['Hoogte St Eenheid'] || '0');
    const volume = length * width * height;

    // Get location size
    const slotType = location['Slot Type'];
    const locationSize = slotType ? getLocationSize(slotType) : 1.0;

    // Get bay code
    const bayCode = getBayCode(location.Aisle, location.Bay);

    // Determine remark (C or R)
    const remarkOne = location['Location Class'] === 'C' ? 'C' : 'R';

    results.push({
      article: parseInt(article.Artikelnummer, 10),
      location: pickLocation,
      articleDescription: article['Artikeloms Verkoop'] || '',
      articleCategory: '',
      articleVolume: Math.round(volume),
      locationSize,
      locationGroup: bayCode,
      remarkOne,
      remarkTwo: '',
      remarkThree: '',
      remarkFour: '',
      remarkFive: '',
    });
  });

  return results;
}

/**
 * Main transformation function
 */
export async function transformClientDataToTemplate(
  locationsData: ClientLocation[],
  articlesData: ClientArticle[],
  picksData: ClientPick[]
): Promise<XLSX.WorkBook> {
  console.log('Starting transformation...');
  console.log(`Locations: ${locationsData.length}`);
  console.log(`Articles: ${articlesData.length}`);
  console.log(`Picks: ${picksData.length}`);

  // Transform data
  const locations = transformLocations(locationsData);
  const picks = transformPicks(picksData);
  const articleLocations = transformArticleLocations(
    articlesData,
    locationsData
  );

  console.log('Transformation complete:');
  console.log(`- Locations: ${locations.length}`);
  console.log(`- Picks: ${picks.length}`);
  console.log(`- ArticleLocations: ${articleLocations.length}`);

  // Create workbook
  const workbook = XLSX.utils.book_new();

  // Create PICK sheet
  const pickSheet = XLSX.utils.json_to_sheet(picks);
  XLSX.utils.book_append_sheet(workbook, pickSheet, 'Pick');

  // Create LOCATION sheet
  const locationSheet = XLSX.utils.json_to_sheet(locations);
  XLSX.utils.book_append_sheet(workbook, locationSheet, 'Location');

  // Create ARTICLELOCATION sheet
  const articleLocationSheet = XLSX.utils.json_to_sheet(articleLocations);
  XLSX.utils.book_append_sheet(workbook, articleLocationSheet, 'ArticleLocation');

  return workbook;
}
