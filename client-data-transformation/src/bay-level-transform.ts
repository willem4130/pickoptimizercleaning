/**
 * Bay-Level Transformation
 *
 * Transforms client data to bay-level aggregation with:
 * - Bay codes as primary keys
 * - Simplified 2-decimal capacity layouts
 * - Location reconciliation across all inputs
 */

import * as XLSX from 'xlsx';
import { getLocationSize } from './slot-dimensions';

// Slot volumes from Vertaaltabel (cm³)
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
  EUL: 810_000,  // Assume similar to BLL
  EUH: 2_430_000, // Assume similar to BLH
  PL: 140_400,   // Assume similar to PK
};

// Input types
export interface ClientLocation {
  Warehouse: string;
  'Location Class': string;
  Location: string;
  Area: string;
  Aisle: string;
  Bay: string;
  'Slot Type': string;
  'Slot Type Description': string;
}

export interface ClientArticle {
  Artikelnummer: string;
  'Artikeloms Verkoop': string;
  'Lengte St Eenheid': string;
  'Breedte St Eenheid': string;
  'Hoogte St Eenheid': string;
  Picklocatie: string;
}

export interface ClientPick {
  Artikelnummer: string;
  Locatiecode: string;
  'Aantal basiseenheden': string;
  'Pick datumtijd': string;
  Leverdatum: string;
  'Pickorder nummer': string;
  Order_type: string;
}

// Output types
export interface BayPick {
  pickList: number;
  location: string; // Bay code
  article: number;
  quantity: number;
  pickTime: string;
  salesOrder: string;
  salesOrderCategory: string;
  originalPickLocation: string; // Reference
}

export interface BayLocation {
  location: string; // Bay code
  seqWMS: string;
  zone: boolean;
  x: string;
  y: string;
  pickSide: string;
  capacityLayout: string; // 2 decimals, European format
  locationGroup: string; // Same as location (bay code)
  slotTypeComposition: string; // e.g., "2×BLL,5×PP5"
  totalLocations: number;
}

export interface BayArticleLocation {
  article: number;
  location: string; // Bay code
  articleDescription: string;
  articleCategory: string;
  articleVolume: number;
  locationSize: number;
  locationGroup: string; // Same as location
  remarkOne: string; // C or R
  remarkTwo: string;
  remarkThree: string;
  remarkFour: string;
  remarkFive: string;
  originalPickLocation: string; // Reference
}

export interface LocationMapping {
  originalLocation: string;
  bayLocation: string;
  slotType: string;
  slotTypeDescription: string;
  inLocations: boolean;
  inArticles: boolean;
  inPicks: boolean;
  pickCount: number;
}

/**
 * Get bay code from aisle and bay
 */
export function getBayCode(aisle: string, bay: string): string {
  return `${aisle}-${bay}`;
}

/**
 * Build location→bay mapping
 */
export function buildLocationMapping(
  locations: ClientLocation[],
  articles: ClientArticle[],
  picks: ClientPick[]
): Map<string, LocationMapping> {
  const mapping = new Map<string, LocationMapping>();

  // Add from locations file (master)
  locations.forEach(loc => {
    const bayCode = getBayCode(loc.Aisle, loc.Bay);
    mapping.set(loc.Location, {
      originalLocation: loc.Location,
      bayLocation: bayCode,
      slotType: loc['Slot Type'] || 'UNKNOWN',
      slotTypeDescription: loc['Slot Type Description'] || 'Unknown',
      inLocations: true,
      inArticles: false,
      inPicks: false,
      pickCount: 0,
    });
  });

  // Mark locations found in articles
  articles.forEach(art => {
    const pickLoc = art.Picklocatie?.trim();
    if (pickLoc && mapping.has(pickLoc)) {
      mapping.get(pickLoc)!.inArticles = true;
    } else if (pickLoc) {
      // Location in articles but not in locations master
      console.warn(`Article ${art.Artikelnummer} references unknown location: ${pickLoc}`);
    }
  });

  // Mark locations found in picks and count
  picks.forEach(pick => {
    const pickLoc = pick.Locatiecode?.trim();
    if (pickLoc && mapping.has(pickLoc)) {
      const loc = mapping.get(pickLoc)!;
      loc.inPicks = true;
      loc.pickCount++;
    } else if (pickLoc) {
      // Location in picks but not in locations master
      if (!mapping.has(pickLoc)) {
        // Try to infer bay from location code
        const parts = pickLoc.split('-');
        if (parts.length >= 2) {
          const aisle = parts[0]!.replace(/\D/g, '');
          const bay = parts[1]!;
          const bayCode = getBayCode(aisle, bay);

          mapping.set(pickLoc, {
            originalLocation: pickLoc,
            bayLocation: bayCode,
            slotType: 'UNKNOWN',
            slotTypeDescription: 'Not in master data',
            inLocations: false,
            inArticles: false,
            inPicks: true,
            pickCount: 1,
          });
        }
      }
    }
  });

  return mapping;
}

/**
 * Calculate capacity layout as list of individual slot sizes
 *
 * CRITICAL: This represents individual physical pick location slots, NOT volume percentages!
 * Each value in the output = one physical slot in the bay
 * Example: "0,25-0,25-0,50-1,00-1,00" = 5 slots (2×0.25, 1×0.50, 2×1.00)
 */
export function calculateBayCapacityLayout(
  locations: ClientLocation[]
): string {
  if (locations.length === 0) return '';

  // Get size for EACH individual pick location
  const slotSizes = locations.map(loc => {
    const slotType = loc['Slot Type'] || 'UNKNOWN';
    return getLocationSize(slotType); // Returns 0.25, 0.50, or 1.00
  });

  // Format as European decimals (comma as decimal separator)
  return slotSizes
    .map(size => size.toFixed(2).replace('.', ','))
    .join('-');
}

/**
 * Get slot type composition string
 */
export function getSlotTypeComposition(locations: ClientLocation[]): string {
  const slotTypeCounts = new Map<string, number>();

  locations.forEach(loc => {
    const slotType = loc['Slot Type'] || 'UNKNOWN';
    slotTypeCounts.set(slotType, (slotTypeCounts.get(slotType) || 0) + 1);
  });

  return Array.from(slotTypeCounts.entries())
    .sort((a, b) => b[1] - a[1]) // Sort by count descending
    .map(([type, count]) => `${count}×${type}`)
    .join(',');
}

/**
 * Calculate zone (even/odd based on bay code last digit)
 */
export function calculateBayZone(bayCode: string): boolean {
  const bayNumber = parseInt(bayCode.split('-')[1] || '0', 10);
  return bayNumber % 2 === 0;
}

/**
 * Round locationSize to nearest standard value (0.25, 0.50, 0.75, 1.00)
 */
export function roundToStandardSize(value: number): number {
  const standardSizes = [0.25, 0.50, 0.75, 1.00];
  let closest = standardSizes[0]!;
  let minDiff = Math.abs(value - closest);

  for (const size of standardSizes) {
    const diff = Math.abs(value - size);
    if (diff < minDiff) {
      minDiff = diff;
      closest = size;
    }
  }

  return closest;
}

/**
 * Aggregate picks to bay level
 */
export function aggregatePicksToBayLevel(
  picks: ClientPick[],
  locationMapping: Map<string, LocationMapping>
): Map<string, Map<number, BayPick[]>> {
  // Map: bayCode → articleNumber → picks[]
  const bayPicks = new Map<string, Map<number, BayPick[]>>();

  picks.forEach((pick, idx) => {
    const pickLoc = pick.Locatiecode?.trim();
    if (!pickLoc) return;

    const mapping = locationMapping.get(pickLoc);
    if (!mapping) return;

    const bayCode = mapping.bayLocation;
    const article = parseInt(pick.Artikelnummer, 10);
    const quantity = parseInt(pick['Aantal basiseenheden'] || '1', 10);

    if (!bayPicks.has(bayCode)) {
      bayPicks.set(bayCode, new Map());
    }

    const bayArticles = bayPicks.get(bayCode)!;
    if (!bayArticles.has(article)) {
      bayArticles.set(article, []);
    }

    // Format pick date
    const pickDateParts = pick['Pick datumtijd']?.split(' ') || [];
    const datePart = pickDateParts[0] || pick['Leverdatum'] || '';
    const formattedDate = formatPickDate(datePart);

    bayArticles.get(article)!.push({
      pickList: 10081994 + idx,
      location: bayCode,
      article,
      quantity,
      pickTime: formattedDate,
      salesOrder: pick['Pickorder nummer'] || '',
      salesOrderCategory: pick.Order_type || '',
      originalPickLocation: pickLoc,
    });
  });

  return bayPicks;
}

function formatPickDate(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const day = parseInt(parts[0]!, 10).toString();
    const month = parseInt(parts[1]!, 10).toString();
    let year = parts[2]!;
    if (year.length === 2) year = '20' + year;
    return `${day}-${month}-${year}`;
  }
  return dateStr;
}

function parseEuropeanDecimal(value: string): number {
  return parseFloat(value.replace(',', '.'));
}

export { parseEuropeanDecimal, formatPickDate };
