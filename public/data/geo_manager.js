/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GEO-DATA INTEGRATION EXAMPLE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This file demonstrates how to use the geo-data modules:
 * - GEO_FETCHER: Retrieve data from API
 * - GEO_FILTER: Filter and classify data
 * - GEO_RENDERER: Render on 3D globe
 * 
 * Usage:
 *   1. Include this file in index.html (or paste into console)
 *   2. Call GeoDataManager.loadRegion('iraq')
 *   3. Monitor console for progress and stats
 */

const GeoDataManager = {
    
    /**
     * Load a complete region with geo-data
     * Example: GeoDataManager.loadRegion('iraq')
     */
    async loadRegion(regionName) {
        console.log(`\n${'='.repeat(70)}`);
        console.log(`[GEO-MANAGER] Loading region: ${regionName}`);
        console.log(`${'='.repeat(70)}\n`);

        try {
            // Load and render the region
            const data = await GEO_RENDERER.loadRegion(regionName);

            if (!data) {
                console.error(`[GEO-MANAGER] Failed to load ${regionName}`);
                return;
            }

            // Also load province borders from API
            if (typeof GEO_PROVINCES !== 'undefined') {
                console.log(`[GEO-MANAGER] Loading province boundaries...`);
                await GEO_PROVINCES.loadProvincesForRegion(regionName);
            }

            // Display results
            this._displayResults(data);
            
            // Print statistics
            this._printStats();

            console.log(`\n${'='.repeat(70)}`);
            console.log(`[GEO-MANAGER] Region loaded successfully!`);
            console.log(`${'='.repeat(70)}\n`);

        } catch (error) {
            console.error(`[GEO-MANAGER] Error loading region:`, error);
        }
    },

    /**
     * Display loaded data in console
     */
    _displayResults(data) {
        console.group('[GEO-MANAGER] Loaded Data Summary');
        
        console.log(`Region: ${data.region}`);
        console.log(`\nCities: ${data.cities.length}`);
        if (data.cities.length > 0) {
            console.table(data.cities.slice(0, 5).map(c => ({
                Name: c.name,
                Population: c.population.toLocaleString(),
                Importance: c.importance.toFixed(1),
                Lat: c.lat.toFixed(2),
                Lon: c.lon.toFixed(2)
            })));
        }

        console.log(`\nHighways: ${data.highways.length}`);
        if (data.highways.length > 0) {
            console.table(data.highways.slice(0, 3).map(hw => ({
                Name: hw.name,
                Type: hw.highway,
                Segments: hw.coords.length,
                Connected: hw.connectedToMajorCities ? 'Yes' : 'No'
            })));
        }

        console.log(`\nProvinces: ${data.provinces.length}`);
        
        console.log(`\nCity Tiers:`);
        console.table({
            'Tier 1 (National Capitals)': data.cityTiers[1].length,
            'Tier 2 (Provincial Capitals)': data.cityTiers[2].length,
            'Tier 3 (Secondary Cities)': data.cityTiers[3].length
        });

        console.groupEnd();
    },

    /**
     * Print rendering statistics
     */
    _printStats() {
        const stats = GEO_RENDERER.getStats();
        console.group('[GEO-MANAGER] Rendering Statistics');
        console.table(stats);
        console.groupEnd();
    },

    /**
     * Unload current region and clear rendering
     */
    unloadRegion() {
        GEO_RENDERER.clear();
        console.log('[GEO-MANAGER] Region unloaded');
    },

    /**
     * Get list of available regions
     */
    getAvailableRegions() {
        const regions = Object.keys(GEO_FETCHER.regions);
        console.table(regions.map(r => ({
            Region: r,
            Name: GEO_FETCHER.regions[r].name
        })));
        return regions;
    },

    /**
     * Interactive demo: load multiple regions and compare
     */
    async demoCompareRegions() {
        const regions = ['iraq', 'usa'];
        console.log(`\n[GEO-MANAGER] Starting comparison demo...\n`);

        for (const region of regions) {
            await this.loadRegion(region);
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
            this.unloadRegion();
        }

        console.log(`[GEO-MANAGER] Demo complete!`);
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// QUICK START EXAMPLES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Example 1: Load Iraq with default settings
 * Usage: GeoDataManager.loadRegion('iraq');
 */

/**
 * Example 2: Load USA with default settings
 * Usage: GeoDataManager.loadRegion('usa');
 */

/**
 * Example 3: View available regions
 * Usage: GeoDataManager.getAvailableRegions();
 */

/**
 * Example 4: Unload current region
 * Usage: GeoDataManager.unloadRegion();
 */

/**
 * Example 5: Run comparison demo
 * Usage: GeoDataManager.demoCompareRegions();
 */

// ═══════════════════════════════════════════════════════════════════════════
// TROUBLESHOOTING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * If Overpass API times out or fails:
 * - The system will use fallback cities (hardcoded major cities)
 * - Check browser console for error messages
 * - Overpass API may be rate-limited if making many requests
 * 
 * If highways don't render:
 * - Overpass API query may have returned empty results
 * - Check if the region has primary roads in OSM
 * - Fallback cities should still render
 * 
 * Performance tips:
 * - For large regions, reduce maxResults in GEO_FILTER.filterCities()
 * - Tier 3 cities can be hidden if performance is poor
 * - Use browser DevTools Performance tab to profile
 */

console.log(`
%c${'='.repeat(70)}
GEO-DATA MODULES LOADED
${'='.repeat(70)}

Available commands:
  • GeoDataManager.loadRegion('iraq')
  • GeoDataManager.loadRegion('usa')
  • GeoDataManager.getAvailableRegions()
  • GeoDataManager.unloadRegion()

Modules loaded:
  ✓ GEO_FETCHER (api integration)
  ✓ GEO_FILTER (data filtering)
  ✓ GEO_RENDERER (3D rendering)

Type 'GeoDataManager.getAvailableRegions()' to see available regions.
`, 'color: #00ff88; font-weight: bold; font-size: 12px;');
