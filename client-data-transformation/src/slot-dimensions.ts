/**
 * Slot Type Dimensions and Volume Calculations
 *
 * Based on Vertaaltabel data Scex.xlsx:
 * - BLH: 120×90×225 cm (Blokpallet hoog)
 * - BLL: 120×90×75 cm (Blokpallet laag)
 * - BLN: 240×180×350 cm (Blokpallet dubbele locatie - DOUBLE SIZE!)
 * - PP3: 44×90×80 cm (Plank DKW 3 artikelen)
 * - PP5: 52×90×90 cm (Plank DKW 5 artikelen)
 * - PP7: 18×90×90 cm (Plank DKW 7 artikelen)
 * - PP9: 30×90×20 cm (Plank DKW 9 artikelen)
 * - PK: 52×90×30 cm (2 Planken)
 */

export interface SlotDimensions {
  slotType: string;
  width: number;  // cm
  depth: number;  // cm
  height: number; // cm
  volume: number; // cm³
  locationSize: 0.25 | 0.5 | 1.0; // standardized size for template
}

export const SLOT_DIMENSIONS: Record<string, SlotDimensions> = {
  // Large pallet slots (1.0)
  BLH: {
    slotType: 'BLH',
    width: 120,
    depth: 90,
    height: 225,
    volume: 2_430_000,
    locationSize: 1.0,
  },
  BLN: {
    slotType: 'BLN',
    width: 240,  // DOUBLE WIDTH!
    depth: 180,  // DOUBLE DEPTH!
    height: 350,
    volume: 15_120_000,
    locationSize: 1.0,
  },

  // Medium pallet slots (0.5)
  BLL: {
    slotType: 'BLL',
    width: 120,
    depth: 90,
    height: 75,
    volume: 810_000,
    locationSize: 0.5,
  },
  PP5: {
    slotType: 'PP5',
    width: 52,
    depth: 90,
    height: 90,
    volume: 421_200,
    locationSize: 0.5,
  },

  // Small shelf slots (0.25)
  PP3: {
    slotType: 'PP3',
    width: 44,
    depth: 90,
    height: 80,
    volume: 316_800,
    locationSize: 0.25,
  },
  PP7: {
    slotType: 'PP7',
    width: 18,
    depth: 90,
    height: 90,
    volume: 145_800,
    locationSize: 0.25,
  },
  PP9: {
    slotType: 'PP9',
    width: 30,
    depth: 90,
    height: 20,
    volume: 54_000,
    locationSize: 0.25,
  },
  PK: {
    slotType: 'PK',
    width: 52,
    depth: 90,
    height: 30,
    volume: 140_400,
    locationSize: 0.25,
  },
  PLK: {
    slotType: 'PLK',
    width: 52,
    depth: 90,
    height: 30,
    volume: 140_400,
    locationSize: 0.25,
  },
  PLV: {
    slotType: 'PLV',
    width: 52,
    depth: 90,
    height: 30,
    volume: 140_400,
    locationSize: 0.25,
  },
};

/**
 * Get slot dimensions for a given slot type
 */
export function getSlotDimensions(slotType: string): SlotDimensions | null {
  return SLOT_DIMENSIONS[slotType] || null;
}

/**
 * Get location size for a slot type
 */
export function getLocationSize(slotType: string): 0.25 | 0.5 | 1.0 {
  const dimensions = getSlotDimensions(slotType);
  return dimensions?.locationSize || 1.0; // Default to 1.0 for unknown/Reserve locations
}

/**
 * Get volume for a slot type
 */
export function getSlotVolume(slotType: string): number {
  const dimensions = getSlotDimensions(slotType);
  return dimensions?.volume || 0;
}

/**
 * Calculate capacity layout for locations in a bay
 *
 * @param locations Array of locations with their slot types
 * @returns Map of location codes to their capacity percentages (0-1)
 */
export function calculateCapacityLayout(
  locations: Array<{ location: string; slotType: string | null }>
): Map<string, number> {
  const capacityMap = new Map<string, number>();

  // Calculate total volume for the bay
  const totalVolume = locations.reduce((sum, loc) => {
    if (!loc.slotType) {
      // Reserve locations (no slot type) - use equal distribution
      return sum + 1;
    }
    return sum + getSlotVolume(loc.slotType);
  }, 0);

  if (totalVolume === 0) {
    // If no volume, distribute equally
    const equalShare = 1 / locations.length;
    locations.forEach(loc => {
      capacityMap.set(loc.location, equalShare);
    });
    return capacityMap;
  }

  // Calculate each location's percentage of total volume
  locations.forEach(loc => {
    const volume = loc.slotType ? getSlotVolume(loc.slotType) : 1;
    const percentage = volume / totalVolume;
    capacityMap.set(loc.location, percentage);
  });

  return capacityMap;
}

/**
 * Format capacity layout as European decimal string (comma-separated)
 *
 * @param capacities Array of capacity percentages
 * @returns Formatted string like "0,2174-0,1130-0,6696"
 */
export function formatCapacityLayout(capacities: number[]): string {
  return capacities
    .map(c => c.toFixed(16).replace('.', ',')) // Use high precision, then replace decimal point
    .join('-');
}

/**
 * Validate that capacity layout sums to 1.0 (within tolerance)
 */
export function validateCapacityLayout(capacities: number[], tolerance = 0.001): boolean {
  const sum = capacities.reduce((a, b) => a + b, 0);
  return Math.abs(sum - 1.0) <= tolerance;
}

/**
 * Determine the required locationSize for an article based on dimensions
 *
 * Strategy: Find the smallest slot type that can fit the article
 *
 * @param length Article length in cm
 * @param width Article width in cm
 * @param height Article height in cm
 * @returns Required locationSize (0.25, 0.5, or 1.0)
 */
export function getRequiredLocationSize(
  length: number,
  width: number,
  height: number
): 0.25 | 0.5 | 1.0 {
  // Try small slots (0.25) first
  const smallSlots = [
    SLOT_DIMENSIONS.PP3,  // 44×90×80
    SLOT_DIMENSIONS.PP7,  // 18×90×90
    SLOT_DIMENSIONS.PP9,  // 30×90×20
    SLOT_DIMENSIONS.PK,   // 52×90×30
    SLOT_DIMENSIONS.PLK,  // 52×90×30
    SLOT_DIMENSIONS.PLV,  // 52×90×30
  ];

  for (const slot of smallSlots) {
    if (canFitInSlot(length, width, height, slot)) {
      return 0.25;
    }
  }

  // Try medium slots (0.5)
  const mediumSlots = [
    SLOT_DIMENSIONS.BLL,  // 120×90×75
    SLOT_DIMENSIONS.PP5,  // 52×90×90
  ];

  for (const slot of mediumSlots) {
    if (canFitInSlot(length, width, height, slot)) {
      return 0.5;
    }
  }

  // Default to large slots (1.0)
  return 1.0;
}

/**
 * Check if an article can fit in a slot (considering all rotations)
 */
function canFitInSlot(
  artLength: number,
  artWidth: number,
  artHeight: number,
  slot: SlotDimensions
): boolean {
  const artDims = [artLength, artWidth, artHeight].sort((a, b) => a - b);
  const slotDims = [slot.width, slot.depth, slot.height].sort((a, b) => a - b);

  // Check if sorted dimensions fit (smallest to smallest, etc.)
  return artDims[0] <= slotDims[0] &&
         artDims[1] <= slotDims[1] &&
         artDims[2] <= slotDims[2];
}

/**
 * Extract available locationSizes from a bay's slot type composition
 *
 * @param slotTypeComposition e.g., "2×BLL,5×PP5" or "9×UNKNOWN"
 * @returns Set of available locationSizes in this bay
 */
export function getAvailableLocationSizes(slotTypeComposition: string): Set<0.25 | 0.5 | 1.0> {
  const sizes = new Set<0.25 | 0.5 | 1.0>();

  // Parse slot type composition (format: "2×BLL,5×PP5")
  const parts = slotTypeComposition.split(',');
  for (const part of parts) {
    const match = part.trim().match(/\d+×(.+)/);
    if (match) {
      const slotType = match[1]!.trim();
      const locationSize = getLocationSize(slotType);
      sizes.add(locationSize);
    }
  }

  return sizes;
}

/**
 * Check if an article with given dimensions can be assigned to a bay
 *
 * @param articleLength Article length in cm
 * @param articleWidth Article width in cm
 * @param articleHeight Article height in cm
 * @param slotTypeComposition Bay's slot type composition
 * @returns true if article can fit, false otherwise
 */
export function canAssignArticleToBay(
  articleLength: number,
  articleWidth: number,
  articleHeight: number,
  slotTypeComposition: string
): boolean {
  const requiredSize = getRequiredLocationSize(articleLength, articleWidth, articleHeight);
  const availableSizes = getAvailableLocationSizes(slotTypeComposition);

  return availableSizes.has(requiredSize);
}
