/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GEO-DATA FILTER: Strip POI clutter, extract Level 1 & 2 infrastructure
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Purpose:
 *   - Filter out non-strategic POI: shops, restaurants, amenities
 *   - Keep only: major cities, provincial capitals, primary roads, borders
 *   - Apply heuristics: population threshold, road classification, proximity
 * 
 * Classification:
 *   Level 1: National capitals, major cities (>500k)
 *   Level 2: Provincial capitals, secondary cities (50k-500k)
 *   Level 3: Tertiary cities, towns (10k-50k)
 */

const GEO_FILTER = {
    
    /**
     * Filter out low-importance cities using multiple criteria
     */
    filterCities(cities = [], options = {}) {
        // Validate input
        if (!cities || !Array.isArray(cities)) {
            console.warn('[GEO_FILTER] Invalid cities array provided, returning empty array');
            return [];
        }
        
        const {
            minPopulation = 50000,
            maxResults = 1000,
            importanceThreshold = 30,
            removeDuplicates = true,
            proximityThreshold = 10 // km
        } = options;

        console.log(`[GEO_FILTER] Filtering ${cities.length} cities...`);

        // Step 1: Remove duplicates (cities within proximityThreshold)
        let filtered = cities;
        if (removeDuplicates) {
            filtered = this._deduplicateCities(cities, proximityThreshold);
            console.log(`[GEO_FILTER] After deduplication: ${filtered.length} cities`);
        }

        // Step 2: Apply population threshold
        filtered = filtered.filter(c => c.population >= minPopulation || c.importance >= importanceThreshold);
        console.log(`[GEO_FILTER] After population filter: ${filtered.length} cities`);

        // Step 3: Sort by importance and limit
        filtered.sort((a, b) => b.importance - a.importance);
        filtered = filtered.slice(0, maxResults);

        console.log(`[GEO_FILTER] Final result: ${filtered.length} cities`);
        return filtered;
    },

    /**
     * Filter highways: keep only strategically important routes
     */
    filterHighways(highways = [], cities = [], options = {}) {
        // Validate input
        if (!highways || !Array.isArray(highways)) {
            console.warn('[GEO_FILTER] Invalid highways array provided, returning empty array');
            return [];
        }
        
        const {
            maxHighwayLength = 5000, // km, filter out very long routes
            minHighwayLength = 10,   // km, filter out very short routes
            priorityRoads = ['motorway', 'trunk', 'primary']
        } = options;

        console.log(`[GEO_FILTER] Filtering ${highways.length} highways...`);

        let filtered = highways.filter(hw => {
            // Filter by road type
            if (!priorityRoads.includes(hw.highway)) {
                return false;
            }

            // Calculate length
            let length = this._calculateLineStringLength(hw.coords);
            if (length < minHighwayLength || length > maxHighwayLength) {
                return false;
            }

            return true;
        });

        console.log(`[GEO_FILTER] After type/length filter: ${filtered.length} highways`);

        // Connect highways to major cities (snap endpoints to city locations)
        filtered = this._snapHighwaysToCities(filtered, cities);

        console.log(`[GEO_FILTER] Final result: ${filtered.length} strategic highways`);
        return filtered;
    },

    /**
     * Filter provinces: remove unnecessary detail, keep major boundaries
     */
    filterProvinces(provinces = [], options = {}) {
        // Validate input
        if (!provinces || !Array.isArray(provinces)) {
            console.warn('[GEO_FILTER] Invalid provinces array provided, returning empty array');
            return [];
        }
        
        const {
            maxProvinces = 200
        } = options;

        console.log(`[GEO_FILTER] Filtering ${provinces.length} provinces...`);

        // Limit number of provinces (keep only larger ones)
        let filtered = provinces.slice(0, maxProvinces);

        console.log(`[GEO_FILTER] Final result: ${filtered.length} provinces`);
        return filtered;
    },

    /**
     * Classify cities by tier (importance level)
     * Used for LOD, marker sizing, etc.
     */
    classifyCitiesByTier(cities) {
        const tiers = {
            1: [],  // National capitals, mega-cities (pop > 1M)
            2: [],  // Provincial capitals, large cities (pop 100k-1M)
            3: []   // Secondary cities, towns (pop < 100k)
        };

        cities.forEach(city => {
            if (city.importance >= 85) {
                tiers[1].push(city);
            } else if (city.importance >= 50) {
                tiers[2].push(city);
            } else {
                tiers[3].push(city);
            }
        });

        console.log(`[GEO_FILTER] City tiers: Tier1=${tiers[1].length}, Tier2=${tiers[2].length}, Tier3=${tiers[3].length}`);
        return tiers;
    },

    /**
     * Remove duplicate/nearby cities
     */
    _deduplicateCities(cities, proximityThreshold) {
        const kept = [];
        const usedIndices = new Set();

        cities.forEach((city, idx) => {
            if (usedIndices.has(idx)) return;

            kept.push(city);
            usedIndices.add(idx);

            // Mark nearby cities as duplicates
            cities.forEach((other, oIdx) => {
                if (usedIndices.has(oIdx) || oIdx === idx) return;

                const dist = this._haversineDist(city.lat, city.lon, other.lat, other.lon);
                if (dist < proximityThreshold) {
                    usedIndices.add(oIdx);
                }
            });
        });

        return kept;
    },

    /**
     * Calculate great-circle distance (km) between two points
     */
    _haversineDist(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    },

    /**
     * Calculate total length of a LineString (coordinate sequence)
     */
    _calculateLineStringLength(coords) {
        let length = 0;
        for (let i = 0; i < coords.length - 1; i++) {
            length += this._haversineDist(
                coords[i].lat, coords[i].lon,
                coords[i+1].lat, coords[i+1].lon
            );
        }
        return length;
    },

    /**
     * Snap highway endpoints to nearest major cities
     * This helps with road connectivity visualization
     */
    _snapHighwaysToCities(highways, cities) {
        const snapThreshold = 50; // km
        
        return highways.map(hw => {
            if (!hw.coords || hw.coords.length < 2) return hw;

            // Check start and end points
            const start = hw.coords[0];
            const end = hw.coords[hw.coords.length - 1];

            let startCity = null, endCity = null;

            // Find nearest city to start
            cities.forEach(city => {
                const dist = this._haversineDist(start.lat, start.lon, city.lat, city.lon);
                if (dist < snapThreshold) {
                    if (!startCity || dist < this._haversineDist(start.lat, start.lon, startCity.lat, startCity.lon)) {
                        startCity = city;
                    }
                }
            });

            // Find nearest city to end
            cities.forEach(city => {
                const dist = this._haversineDist(end.lat, end.lon, city.lat, city.lon);
                if (dist < snapThreshold) {
                    if (!endCity || dist < this._haversineDist(end.lat, end.lon, endCity.lat, endCity.lon)) {
                        endCity = city;
                    }
                }
            });

            return {
                ...hw,
                startCity: startCity ? startCity.name : null,
                endCity: endCity ? endCity.name : null,
                connectedToMajorCities: !!(startCity && endCity)
            };
        });
    },

    /**
     * Generate a summary report of filtered data
     */
    generateReport(originalData, filteredData) {
        const report = {
            timestamp: new Date().toISOString(),
            region: filteredData.region,
            cityCount: {
                original: originalData.cities ? originalData.cities.length : 0,
                filtered: filteredData.cities.length,
                reduction: ((1 - (filteredData.cities.length / (originalData.cities ? originalData.cities.length : 1))) * 100).toFixed(1) + '%'
            },
            highwayCount: {
                original: originalData.highways ? originalData.highways.length : 0,
                filtered: filteredData.highways.length,
                reduction: ((1 - (filteredData.highways.length / (originalData.highways ? originalData.highways.length : 1))) * 100).toFixed(1) + '%'
            },
            provinceCount: {
                original: originalData.provinces ? originalData.provinces.length : 0,
                filtered: filteredData.provinces.length,
                reduction: ((1 - (filteredData.provinces.length / (originalData.provinces ? originalData.provinces.length : 1))) * 100).toFixed(1) + '%'
            },
            cityTiers: filteredData.cityTiers || {}
        };

        console.table(report);
        return report;
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GEO_FILTER;
}
