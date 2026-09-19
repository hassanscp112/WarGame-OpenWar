/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GEO-DATA FETCHER: Extract Level 1 & 2 Infrastructure from OpenStreetMap
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Purpose:
 *   - Fetch real-world geographical data (cities, provinces, highways)
 *   - Filter out POI clutter (shops, restaurants, small streets)
 *   - Return clean, strategic data for 3D rendering
 * 
 * Data Sources:
 *   - Overpass API: OSM data with strict filtering
 *   - Natural Earth: Country/province boundaries
 *   - Wikipedia/GeoNames: City populations and importance scores
 */

const GEO_FETCHER = {
    // Cache for fetched regions to avoid duplicate API calls
    cache: {},
    
    // Region definition: bounding boxes for countries & regions
    regions: {
        // Middle East & Asia
        'iraq': { minLat: 29.0, maxLat: 37.4, minLon: 38.7, maxLon: 48.6, name: 'العراق' },
        'syria': { minLat: 32.3, maxLat: 37.3, minLon: 35.7, maxLon: 42.4, name: 'سوريا' },
        'jordan': { minLat: 29.2, maxLat: 32.8, minLon: 34.3, maxLon: 39.3, name: 'الأردن' },
        'saudi': { minLat: 16.3, maxLat: 32.2, minLon: 34.5, maxLon: 55.9, name: 'السعودية' },
        'yemen': { minLat: 12.1, maxLat: 19.0, minLon: 42.5, maxLon: 54.6, name: 'اليمن' },
        'oman': { minLat: 16.6, maxLat: 26.6, minLon: 51.9, maxLon: 59.5, name: 'عمان' },
        'uae': { minLat: 22.6, maxLat: 26.2, minLon: 51.6, maxLon: 56.4, name: 'الإمارات' },
        'qatar': { minLat: 24.6, maxLat: 26.2, minLon: 50.7, maxLon: 51.7, name: 'قطر' },
        'bahrain': { minLat: 25.5, maxLat: 26.2, minLon: 50.2, maxLon: 50.6, name: 'البحرين' },
        'kuwait': { minLat: 28.5, maxLat: 30.1, minLon: 46.6, maxLon: 48.4, name: 'الكويت' },
        'lebanon': { minLat: 32.4, maxLat: 34.7, minLon: 35.1, maxLon: 36.6, name: 'لبنان' },
        'palestine': { minLat: 31.4, maxLat: 32.5, minLon: 34.2, maxLon: 35.5, name: 'فلسطين' },
        'israel': { minLat: 29.4, maxLat: 33.3, minLon: 34.2, maxLon: 35.9, name: 'إسرائيل' },
        'egypt': { minLat: 19.0, maxLat: 31.6, minLon: 24.7, maxLon: 36.9, name: 'مصر' },
        'turkey': { minLat: 35.8, maxLat: 42.8, minLon: 25.6, maxLon: 44.8, name: 'تركيا' },
        'iran': { minLat: 24.8, maxLat: 37.4, minLon: 44.1, maxLon: 61.5, name: 'إيران' },
        'afghanistan': { minLat: 29.4, maxLat: 37.1, minLon: 60.5, maxLon: 74.9, name: 'أفغانستان' },
        'pakistan': { minLat: 23.7, maxLat: 37.1, minLon: 60.9, maxLon: 77.8, name: 'باكستان' },
        'india': { minLat: 8.1, maxLat: 35.5, minLon: 68.2, maxLon: 97.4, name: 'الهند' },
        'china': { minLat: 18.2, maxLat: 53.6, minLon: 73.5, maxLon: 135.1, name: 'الصين' },
        'japan': { minLat: 30.4, maxLat: 45.6, minLon: 129.4, maxLon: 145.8, name: 'اليابان' },
        'korea': { minLat: 33.1, maxLat: 43.0, minLon: 124.6, maxLon: 131.9, name: 'كوريا' },
        
        // Europe
        'uk': { minLat: 50.0, maxLat: 58.6, minLon: -8.6, maxLon: 1.8, name: 'بريطانيا' },
        'france': { minLat: 41.4, maxLat: 51.1, minLon: -8.2, maxLon: 8.2, name: 'فرنسا' },
        'germany': { minLat: 47.3, maxLat: 55.9, minLon: 5.9, maxLon: 15.0, name: 'ألمانيا' },
        'italy': { minLat: 36.8, maxLat: 47.1, minLon: 6.6, maxLon: 18.5, name: 'إيطاليا' },
        'spain': { minLat: 36.0, maxLat: 43.8, minLon: -9.3, maxLon: 3.3, name: 'إسبانيا' },
        'portugal': { minLat: 36.9, maxLat: 42.2, minLon: -9.5, maxLon: -6.2, name: 'البرتغال' },
        'netherlands': { minLat: 50.8, maxLat: 53.5, minLon: 3.4, maxLon: 7.2, name: 'هولندا' },
        'belgium': { minLat: 49.5, maxLat: 51.5, minLon: 2.4, maxLon: 6.4, name: 'بلجيكا' },
        'switzerland': { minLat: 45.8, maxLat: 47.8, minLon: 5.9, maxLon: 10.5, name: 'سويسرا' },
        'austria': { minLat: 46.4, maxLat: 49.0, minLon: 9.5, maxLon: 17.2, name: 'النمسا' },
        'poland': { minLat: 49.0, maxLat: 54.8, minLon: 14.1, maxLon: 24.1, name: 'بولندا' },
        'ukraine': { minLat: 41.2, maxLat: 52.4, minLon: 22.1, maxLon: 40.2, name: 'أوكرانيا' },
        'russia': { minLat: 41.2, maxLat: 81.9, minLon: 18.8, maxLon: 169.4, name: 'روسيا' },
        'greece': { minLat: 34.8, maxLat: 41.8, minLon: 19.3, maxLon: 28.2, name: 'اليونان' },
        'romania': { minLat: 43.6, maxLat: 48.2, minLon: 20.3, maxLon: 29.6, name: 'رومانيا' },
        'czech': { minLat: 48.5, maxLat: 51.1, minLon: 12.1, maxLon: 18.9, name: 'التشيك' },
        'hungary': { minLat: 45.7, maxLat: 48.6, minLon: 16.1, maxLon: 22.9, name: 'المجر' },
        'serbia': { minLat: 42.2, maxLat: 46.2, minLon: 18.9, maxLon: 23.0, name: 'صربيا' },
        'croatia': { minLat: 42.1, maxLat: 47.0, minLon: 12.4, maxLon: 19.4, name: 'كرواتيا' },
        'sweden': { minLat: 55.3, maxLat: 69.1, minLon: 11.3, maxLon: 24.2, name: 'السويد' },
        'norway': { minLat: 57.9, maxLat: 70.9, minLon: 5.1, maxLon: 31.2, name: 'النرويج' },
        'denmark': { minLat: 54.6, maxLat: 57.8, minLon: 8.1, maxLon: 15.2, name: 'الدنمارك' },
        'finland': { minLat: 59.8, maxLat: 70.1, minLon: 19.5, maxLon: 31.6, name: 'فنلندا' },
        'ireland': { minLat: 51.4, maxLat: 55.4, minLon: -10.6, maxLon: -5.4, name: 'أيرلندا' },
        
        // North Africa & Africa
        'libya': { minLat: 19.5, maxLat: 33.2, minLon: 9.2, maxLon: 25.2, name: 'ليبيا' },
        'algeria': { minLat: 19.0, maxLat: 37.1, minLon: -8.7, maxLon: 12.0, name: 'الجزائر' },
        'morocco': { minLat: 27.1, maxLat: 36.0, minLon: -13.2, maxLon: -2.6, name: 'المغرب' },
        'tunisia': { minLat: 30.2, maxLat: 37.5, minLon: 7.5, maxLon: 11.6, name: 'تونس' },
        'sudan': { minLat: 9.5, maxLat: 22.0, minLon: 21.8, maxLon: 38.6, name: 'السودان' },
        'ethiopia': { minLat: 3.4, maxLat: 14.9, minLon: 32.9, maxLon: 47.8, name: 'إثيوبيا' },
        'kenya': { minLat: -4.7, maxLat: 5.0, minLon: 33.9, maxLon: 41.9, name: 'كينيا' },
        'nigeria': { minLat: 4.3, maxLat: 13.9, minLon: 2.7, maxLon: 14.7, name: 'نيجيريا' },
        'southafrica': { minLat: -34.8, maxLat: -22.1, minLon: 16.5, maxLon: 32.9, name: 'جنوب أفريقيا' },
        
        // North America
        'usa': { minLat: 24.5, maxLat: 49.4, minLon: -125.0, maxLon: -66.9, name: 'الولايات المتحدة' },
        'canada': { minLat: 41.7, maxLat: 83.1, minLon: -141.0, maxLon: -52.6, name: 'كندا' },
        'mexico': { minLat: 14.5, maxLat: 32.7, minLon: -117.1, maxLon: -86.7, name: 'المكسيك' },
        
        // Central & South America
        'brazil': { minLat: -33.7, maxLat: 5.2, minLon: -73.9, maxLon: -34.8, name: 'البرازيل' },
        'argentina': { minLat: -55.1, maxLat: -21.8, minLon: -73.6, maxLon: -53.6, name: 'الأرجنتين' },
        'colombia': { minLat: -4.2, maxLat: 12.5, minLon: -77.0, maxLon: -66.9, name: 'كولومبيا' },
        'venezuela': { minLat: 0.6, maxLat: 12.8, minLon: -73.4, maxLon: -59.8, name: 'فنزويلا' },
        'peru': { minLat: -17.6, maxLat: -0.0, minLon: -81.3, maxLon: -68.7, name: 'بيرو' },
        'chile': { minLat: -56.5, maxLat: -17.8, minLon: -81.2, maxLon: -66.4, name: 'تشيلي' },
        
        // South Asia
        'bangladesh': { minLat: 20.3, maxLat: 26.6, minLon: 88.0, maxLon: 92.7, name: 'بنغلاديش' },
        'thailand': { minLat: 5.6, maxLat: 20.5, minLon: 97.3, maxLon: 105.6, name: 'تايلاند' },
        'vietnam': { minLat: 8.6, maxLat: 23.4, minLon: 102.1, maxLon: 109.5, name: 'فيتنام' },
        'indonesia': { minLat: -10.4, maxLat: 5.9, minLon: 95.3, maxLon: 140.7, name: 'إندونيسيا' },
        'philippines': { minLat: 5.6, maxLat: 19.0, minLon: 117.2, maxLon: 126.6, name: 'الفلبين' },
        'australia': { minLat: -44.0, maxLat: -10.1, minLon: 112.9, maxLon: 154.0, name: 'أستراليا' },
        
        // Multiple regions combined
        'middle_east': { minLat: 12, maxLat: 42, minLon: 26, maxLon: 63, name: 'الشرق الأوسط' },
        'europe': { minLat: 35, maxLat: 71, minLon: -10, maxLon: 40, name: 'أوروبا' },
    },

    /**
     * Fetch major cities from a region using Overpass API
     * Filters for cities with population > threshold
     */
    async fetchMajorCities(region, populationThreshold = 50000) {
        const bbox = this.regions[region] || region;
        const cacheKey = `cities_${region}_${populationThreshold}`;
        
        if (this.cache[cacheKey]) {
            console.log(`[GEO_FETCHER] Using cached cities for ${region}`);
            return this.cache[cacheKey];
        }

        console.log(`[GEO_FETCHER] Fetching major cities for ${region}...`);
        
        // Overpass QL query: find nodes/ways with place=city/town/village
        // Filter by population tag
        const query = `
[bbox:${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}];
(
  node["place"~"city|town|village"]["population"];
  way["place"~"city|town|village"]["population"];
);
out center;
`;

        try {
            const url = 'https://overpass-api.de/api/interpreter';
            const response = await fetch(url, {
                method: 'POST',
                body: query,
                headers: { 'Content-Type': 'application/osm3s+xml' }
            });

            if (!response.ok) {
                throw new Error(`Overpass API error: ${response.status}`);
            }

            const xml = await response.text();
            const cities = this._parseOSMXML(xml, populationThreshold);
            
            this.cache[cacheKey] = cities;
            console.log(`[GEO_FETCHER] Fetched ${cities.length} major cities`);
            return cities;
        } catch (error) {
            console.error(`[GEO_FETCHER] Failed to fetch cities for ${region}:`, error);
            // Fallback: return pre-defined major cities
            return this._getFallbackCities(region);
        }
    },

    /**
     * Fetch primary highways (motorways, trunk roads) between major cities
     */
    async fetchPrimaryHighways(region) {
        const bbox = this.regions[region] || region;
        const cacheKey = `highways_${region}`;
        
        if (this.cache[cacheKey]) {
            console.log(`[GEO_FETCHER] Using cached highways for ${region}`);
            return this.cache[cacheKey];
        }

        console.log(`[GEO_FETCHER] Fetching primary highways for ${region}...`);

        // Query: motorways, trunk, primary roads only
        const query = `
[bbox:${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}];
(
  way["highway"~"motorway|trunk|primary"];
);
out geom;
`;

        try {
            const url = 'https://overpass-api.de/api/interpreter';
            const response = await fetch(url, {
                method: 'POST',
                body: query,
                headers: { 'Content-Type': 'application/osm3s+xml' }
            });

            if (!response.ok) {
                throw new Error(`Overpass API error: ${response.status}`);
            }

            const xml = await response.text();
            const highways = this._parseHighwaysOSMXML(xml);
            
            this.cache[cacheKey] = highways;
            console.log(`[GEO_FETCHER] Fetched ${highways.length} primary highways`);
            return highways;
        } catch (error) {
            console.error(`[GEO_FETCHER] Failed to fetch highways for ${region}:`, error);
            return [];
        }
    },

    /**
     * Fetch provincial/administrative boundaries
     */
    async fetchProvincialBoundaries(region, adminLevel = 4) {
        const bbox = this.regions[region] || region;
        const cacheKey = `provinces_${region}_${adminLevel}`;
        
        if (this.cache[cacheKey]) {
            console.log(`[GEO_FETCHER] Using cached provinces for ${region}`);
            return this.cache[cacheKey];
        }

        console.log(`[GEO_FETCHER] Fetching provincial boundaries (admin_level=${adminLevel})...`);

        // Query: administrative boundaries
        const query = `
[bbox:${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}];
(
  relation["boundary"="administrative"]["admin_level"="${adminLevel}"];
);
out geom;
`;

        try {
            const url = 'https://overpass-api.de/api/interpreter';
            const response = await fetch(url, {
                method: 'POST',
                body: query,
                headers: { 'Content-Type': 'application/osm3s+xml' }
            });

            if (!response.ok) {
                throw new Error(`Overpass API error: ${response.status}`);
            }

            const xml = await response.text();
            const provinces = this._parseProvincesOSMXML(xml);
            
            this.cache[cacheKey] = provinces;
            console.log(`[GEO_FETCHER] Fetched ${provinces.length} provincial boundaries`);
            return provinces;
        } catch (error) {
            console.error(`[GEO_FETCHER] Failed to fetch provinces:`, error);
            return [];
        }
    },

    /**
     * Parse Overpass XML response for cities
     * Extract: id, lat, lon, name, population
     */
    _parseOSMXML(xml, populationThreshold) {
        const cities = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'application/xml');

        // Find all node/way elements
        const nodes = doc.querySelectorAll('node, way');
        
        nodes.forEach(elem => {
            let id, lat, lon, name, population;
            
            if (elem.tagName === 'node') {
                lat = parseFloat(elem.getAttribute('lat'));
                lon = parseFloat(elem.getAttribute('lon'));
                id = elem.getAttribute('id');
            } else if (elem.tagName === 'way') {
                // For ways, use center or first node
                const center = elem.querySelector('center');
                if (center) {
                    lat = parseFloat(center.getAttribute('lat'));
                    lon = parseFloat(center.getAttribute('lon'));
                }
                id = elem.getAttribute('id');
            }

            // Extract tags: name, population, place type
            const tags = {};
            elem.querySelectorAll('tag').forEach(tag => {
                tags[tag.getAttribute('k')] = tag.getAttribute('v');
            });

            name = tags.name || `City_${id}`;
            population = parseInt(tags.population) || 0;
            const placeType = tags.place || 'unknown';

            // Filter: only include if population meets threshold
            if (lat && lon && population >= populationThreshold) {
                cities.push({
                    id,
                    lat,
                    lon,
                    name,
                    population,
                    placeType,
                    importance: this._calculateImportance(population, placeType),
                });
            }
        });

        // Sort by importance descending
        cities.sort((a, b) => b.importance - a.importance);
        return cities;
    },

    /**
     * Parse highways from Overpass XML
     * Return array of coordinate sequences (LineStrings)
     */
    _parseHighwaysOSMXML(xml) {
        const highways = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'application/xml');

        const ways = doc.querySelectorAll('way');
        
        ways.forEach(way => {
            const tags = {};
            way.querySelectorAll('tag').forEach(tag => {
                tags[tag.getAttribute('k')] = tag.getAttribute('v');
            });

            const coords = [];
            way.querySelectorAll('nd').forEach(nd => {
                const ref = nd.getAttribute('ref');
                const node = doc.querySelector(`node[id="${ref}"]`);
                if (node) {
                    coords.push({
                        lat: parseFloat(node.getAttribute('lat')),
                        lon: parseFloat(node.getAttribute('lon'))
                    });
                }
            });

            if (coords.length > 1) {
                highways.push({
                    id: way.getAttribute('id'),
                    name: tags.name || 'Unnamed Road',
                    highway: tags.highway, // motorway, trunk, primary
                    coords
                });
            }
        });

        return highways;
    },

    /**
     * Parse provincial boundaries from Overpass XML
     */
    _parseProvincesOSMXML(xml) {
        const provinces = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'application/xml');

        const relations = doc.querySelectorAll('relation');
        
        relations.forEach(relation => {
            const tags = {};
            relation.querySelectorAll('tag').forEach(tag => {
                tags[tag.getAttribute('k')] = tag.getAttribute('v');
            });

            const name = tags.name || `Province_${relation.getAttribute('id')}`;
            const adminLevel = tags.admin_level || '4';
            const members = [];

            relation.querySelectorAll('member[type="way"]').forEach(member => {
                members.push(member.getAttribute('ref'));
            });

            if (members.length > 0) {
                provinces.push({
                    id: relation.getAttribute('id'),
                    name,
                    adminLevel,
                    memberWayIds: members
                });
            }
        });

        return provinces;
    },

    /**
     * Calculate importance score (0-100) based on population and place type
     * Used for LOD and marker sizing
     */
    _calculateImportance(population, placeType) {
        let score = 0;

        // Population contribution (0-70 points)
        if (population >= 1000000) score += 70;
        else if (population >= 500000) score += 60;
        else if (population >= 100000) score += 50;
        else if (population >= 50000) score += 30;
        else score += 10;

        // Place type bonus (0-30 points)
        if (placeType === 'city') score += 30;
        else if (placeType === 'town') score += 15;
        else if (placeType === 'village') score += 5;

        return Math.min(100, score);
    },

    /**
     * Fallback: hardcoded major cities for a region
     * Used if Overpass API is unavailable
     */
    _getFallbackCities(region) {
        const fallbacks = {
            'iraq': [
                { lat: 33.31, lon: 44.36, name: 'Baghdad', population: 7216000, importance: 100, placeType: 'city' },
                { lat: 36.19, lon: 44.01, name: 'Erbil', population: 1500000, importance: 85, placeType: 'city' },
                { lat: 32.58, lon: 44.97, name: 'Basra', population: 1200000, importance: 80, placeType: 'city' },
                { lat: 34.53, lon: 41.71, name: 'Mosul', population: 1500000, importance: 85, placeType: 'city' },
                { lat: 32.16, lon: 46.81, name: 'Ahvaz', population: 1000000, importance: 75, placeType: 'city' },
            ],
            'middle_east': [
                { lat: 33.31, lon: 44.36, name: 'Baghdad', population: 7216000, importance: 100, placeType: 'city' },
                { lat: 31.95, lon: 35.93, name: 'Amman', population: 4000000, importance: 90, placeType: 'city' },
                { lat: 33.51, lon: 36.28, name: 'Damascus', population: 2000000, importance: 85, placeType: 'city' },
                { lat: 31.95, lon: 35.18, name: 'Jerusalem', population: 1000000, importance: 80, placeType: 'city' },
                { lat: 33.63, lon: 51.68, name: 'Tehran', population: 14000000, importance: 100, placeType: 'city' },
            ],
            'usa': [
                { lat: 40.71, lon: -74.01, name: 'New York', population: 8400000, importance: 100, placeType: 'city' },
                { lat: 34.05, lon: -118.24, name: 'Los Angeles', population: 4000000, importance: 95, placeType: 'city' },
                { lat: 41.88, lon: -87.63, name: 'Chicago', population: 2700000, importance: 90, placeType: 'city' },
                { lat: 38.91, lon: -77.04, name: 'Washington', population: 700000, importance: 85, placeType: 'city' },
                { lat: 33.75, lon: -84.39, name: 'Atlanta', population: 500000, importance: 75, placeType: 'city' },
            ],
        };
        
        return fallbacks[region] || [];
    },

    /**
     * Combine fetched data: merge cities, highways, provinces into unified data structure
     */
    async fetchAllData(region) {
        console.log(`[GEO_FETCHER] Fetching complete geo-data for ${region}...`);
        
        try {
            const [cities, highways, provinces] = await Promise.all([
                this.fetchMajorCities(region),
                this.fetchPrimaryHighways(region),
                this.fetchProvincialBoundaries(region)
            ]);

            return {
                region,
                cities,
                highways,
                provinces,
                timestamp: Date.now()
            };
        } catch (error) {
            console.error(`[GEO_FETCHER] Failed to fetch all data:`, error);
            return { region, cities: [], highways: [], provinces: [], timestamp: Date.now() };
        }
    },

    /**
     * Clear cache (for manual refresh)
     */
    clearCache() {
        this.cache = {};
        console.log('[GEO_FETCHER] Cache cleared');
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GEO_FETCHER;
}
