/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GEO-RENDERER: 3D Rendering Pipeline for Geographic Data
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Purpose:
 *   - Render filtered geographic data on the 3D globe
 *   - City markers (InstancedMesh for performance)
 *   - Highways (surface-hugging line strips)
 *   - Provincial/national boundaries
 *   - On-demand loading based on camera view
 * 
 * Integration: Works with geo_fetcher.js and geo_filter.js
 */

const GEO_RENDERER = {
    // Rendering state
    scene: null,
    camera: null,
    
    // Data cache
    loadedRegions: {},
    activeRegion: null,
    
    // Three.js meshes
    cityMarkers: {
        tier1: null, // National capitals (InstancedMesh)
        tier2: null, // Provincial capitals (InstancedMesh)
        tier3: null  // Secondary cities (InstancedMesh)
    },
    highwayMesh: null,       // LineSegments for roads
    boundaryMesh: null,      // LineSegments for borders
    
    // Data structures
    cityData: [],            // Flattened city array with mesh indices
    highwayData: [],         // Highway segments
    
    // Performance tracking
    stats: {
        citiesRendered: 0,
        highwaysRendered: 0,
        lastUpdateTime: 0
    },

    /**
     * Initialize the renderer (call once at startup)
     */
    init(scene, camera) {
        if (!scene || !camera) {
            console.error('[GEO_RENDERER] Invalid scene or camera provided');
            return;
        }
        this.scene = scene;
        this.camera = camera;
        console.log('[GEO_RENDERER] Initialized successfully');
    },

    /**
     * Load and render a geographic region
     */
    async loadRegion(regionName) {
        // Safety checks
        if (!this.scene || !this.camera) {
            console.error('[GEO_RENDERER] Scene or camera not initialized. Call init(scene, camera) first.');
            return null;
        }

        if (!regionName) {
            console.error('[GEO_RENDERER] Invalid region name');
            return null;
        }

        if (this.loadedRegions[regionName]) {
            console.log(`[GEO_RENDERER] Region ${regionName} already loaded`);
            return this.loadedRegions[regionName];
        }

        console.log(`[GEO_RENDERER] Loading region: ${regionName}`);

        try {
            // Step 1: Fetch raw data
            const rawData = await GEO_FETCHER.fetchAllData(regionName);

            // Step 2: Filter data
            const filteredData = {
                region: rawData.region,
                cities: GEO_FILTER.filterCities(rawData.cities),
                highways: GEO_FILTER.filterHighways(rawData.highways, rawData.cities),
                provinces: GEO_FILTER.filterProvinces(rawData.provinces)
            };
            
            // Step 2b: Classify FILTERED cities, not raw
            filteredData.cityTiers = GEO_FILTER.classifyCitiesByTier(filteredData.cities);

            // Step 3: Generate report
            GEO_FILTER.generateReport(rawData, filteredData);

            // Step 4: Create 3D meshes
            // City markers DISABLED — game already renders cities via cityNodes system
            // this._createCityMarkers(filteredData.cities, filteredData.cityTiers);
            this._createHighwayMesh(filteredData.highways);

            // Cache the region
            this.loadedRegions[regionName] = filteredData;
            this.activeRegion = regionName;

            console.log(`[GEO_RENDERER] Region ${regionName} loaded and rendered successfully`);
            return filteredData;
        } catch (error) {
            console.error(`[GEO_RENDERER] Failed to load region ${regionName}:`, error);
            return null;
        }
    },

    /**
     * Create city marker InstancedMesh for efficient rendering
     * Three tiers: national capitals, provincial capitals, other cities
     */
    _createCityMarkers(cities, tiers) {
        console.log('[GEO_RENDERER] Creating city markers...');

        // Safety check: verify latLonToVec3 exists
        if (typeof latLonToVec3 !== 'function') {
            console.error('[GEO_RENDERER] latLonToVec3 function not found in global scope');
            return;
        }

        // Define marker sizes for each tier
        const tierConfig = {
            1: { scale: 3.0, color: 0x00ff88, capacity: 100 },
            2: { scale: 2.0, color: 0x00ccff, capacity: 500 },
            3: { scale: 1.0, color: 0x66ccdd, capacity: 1000 }
        };

        // Create InstancedMesh for each tier
        for (let tierNum = 1; tierNum <= 3; tierNum++) {
            const tierCities = tiers[tierNum] || [];
            const config = tierConfig[tierNum];

            if (tierCities.length === 0) continue;

            // Create sphere geometry for marker
            const geometry = new THREE.SphereGeometry(6, 16, 16);
            const material = new THREE.MeshBasicMaterial({
                color: config.color,
                transparent: true,
                opacity: 0.9
            });

            // Create InstancedMesh
            const mesh = new THREE.InstancedMesh(
                geometry,
                material,
                Math.min(tierCities.length, config.capacity)
            );

            mesh.userData = { tier: tierNum, cities: tierCities };
            this.scene.add(mesh);

            // Position instances
            const matrix = new THREE.Matrix4();
            tierCities.forEach((city, idx) => {
                if (idx >= config.capacity) return;

                // Convert lat/lon to 3D position
                const pos = latLonToVec3(city.lat, city.lon, EARTH_RADIUS + 10.0);

                matrix.makeScale(config.scale, config.scale, config.scale);
                matrix.setPosition(pos);

                mesh.setMatrixAt(idx, matrix);
                
                // Store mapping for interaction
                this.cityData.push({
                    meshType: `tier${tierNum}`,
                    instanceIdx: idx,
                    city: city
                });
            });

            mesh.instanceMatrix.needsUpdate = true;

            // Store reference
            this.cityMarkers[`tier${tierNum}`] = mesh;
            this.stats.citiesRendered += tierCities.length;
        }

        console.log(`[GEO_RENDERER] Created city markers: ${this.stats.citiesRendered} total`);
    },

    /**
     * Create highway mesh: line strips that follow Earth's curvature
     */
    _createHighwayMesh(highways) {
        console.log(`[GEO_RENDERER] Creating highway mesh (${highways.length} roads)...`);

        // Safety check: verify latLonToVec3 exists
        if (typeof latLonToVec3 !== 'function') {
            console.error('[GEO_RENDERER] latLonToVec3 function not found in global scope');
            return;
        }

        const geometry = new THREE.BufferGeometry();
        const material = new THREE.LineBasicMaterial({
            color: 0xffcc00,
            transparent: true,
            opacity: 0.6,
            linewidth: 2
        });

        const positions = [];
        const indices = [];
        let vertexIndex = 0;

        highways.forEach(highway => {
            if (!highway.coords || highway.coords.length < 2) return;

            // Add vertices for this highway segment
            const startIdx = vertexIndex;
            highway.coords.forEach(coord => {
                const pos = latLonToVec3(coord.lat, coord.lon, EARTH_RADIUS + 1.5);
                positions.push(pos.x, pos.y, pos.z);
                vertexIndex++;
            });

            // Create line segment indices
            for (let i = startIdx; i < vertexIndex - 1; i++) {
                indices.push(i, i + 1);
            }

            this.highwayData.push({
                start: startIdx,
                end: vertexIndex - 1,
                highway: highway
            });
        });

        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));

        this.highwayMesh = new THREE.LineSegments(geometry, material);
        this.scene.add(this.highwayMesh);

        this.stats.highwaysRendered = highways.length;
        console.log(`[GEO_RENDERER] Highway mesh created: ${highways.length} roads`);
    },

    /**
     * Update visible meshes based on camera frustum
     * Implementation of LOD and on-demand loading
     */
    updateVisibility(cameraFrustum) {
        // TODO: Implement frustum culling
        // For now, show all meshes
        Object.values(this.cityMarkers).forEach(mesh => {
            if (mesh) mesh.visible = true;
        });
        if (this.highwayMesh) this.highwayMesh.visible = true;
    },

    /**
     * Get city at screen position for clicking/selection
     * Used for interaction (city panel, selection, etc.)
     */
    getCityAtScreenPos(raycaster, mouse) {
        // Safety checks
        if (!raycaster || !mouse) {
            console.warn('[GEO_RENDERER] Invalid raycaster or mouse parameter');
            return null;
        }

        if (!this.cityMarkers.tier1 && !this.cityMarkers.tier2 && !this.cityMarkers.tier3) {
            console.warn('[GEO_RENDERER] No city markers loaded');
            return null;
        }

        const intersects = [];

        // Check all city marker meshes
        Object.values(this.cityMarkers).forEach(mesh => {
            if (!mesh) return;
            const hits = raycaster.intersectObject(mesh);
            if (hits.length > 0) {
                intersects.push(...hits.map(hit => ({
                    point: hit.point,
                    distance: hit.distance,
                    instanceId: hit.instanceId,
                    mesh: mesh
                })));
            }
        });

        // Return closest hit
        if (intersects.length > 0) {
            intersects.sort((a, b) => a.distance - b.distance);
            const hit = intersects[0];
            
            // Find corresponding city data
            const cityInfo = this.cityData.find(
                c => c.meshType === `tier${hit.mesh.userData.tier}` && c.instanceIdx === hit.instanceId
            );

            return cityInfo ? cityInfo.city : null;
        }

        return null;
    },

    /**
     * Highlight a city (brighten its marker)
     */
    highlightCity(city) {
        // Find the marker mesh for this city
        this.cityData.forEach(cityInfo => {
            if (cityInfo.city === city) {
                const mesh = this.cityMarkers[cityInfo.meshType];
                if (mesh) {
                    // Create a bright color matrix for this instance
                    const matrix = new THREE.Matrix4();
                    const pos = latLonToVec3(city.lat, city.lon, EARTH_RADIUS + 10.0);
                    const scale = (cityInfo.meshType === 'tier1') ? 3.5 : 
                                  (cityInfo.meshType === 'tier2') ? 2.5 : 1.5;
                    
                    matrix.makeScale(scale, scale, scale);
                    matrix.setPosition(pos);
                    mesh.setMatrixAt(cityInfo.instanceIdx, matrix);
                    mesh.instanceMatrix.needsUpdate = true;
                }
            }
        });
    },

    /**
     * Generate summary statistics
     */
    getStats() {
        // Calculate memory estimate
        const citiesMemory = this.cityData.length * 0.1; // ~0.1MB per 1000 cities
        const highwaysMemory = this.highwayData.length * 0.2; // ~0.2MB per highway
        const estimatedMemoryMB = Math.ceil((citiesMemory + highwaysMemory) * 10) / 10;

        return {
            ...this.stats,
            activeRegion: this.activeRegion,
            loadedRegions: Object.keys(this.loadedRegions),
            totalCitiesLoaded: this.cityData.length,
            totalHighwaysLoaded: this.highwayData.length,
            drawCalls: this._countDrawCalls(),
            estimatedMemory: `~${estimatedMemoryMB}MB`,
            timestamp: new Date().toISOString()
        };
    },

    /**
     * Count active draw calls
     */
    _countDrawCalls() {
        let count = 0;
        if (this.cityMarkers.tier1) count++;
        if (this.cityMarkers.tier2) count++;
        if (this.cityMarkers.tier3) count++;
        if (this.highwayMesh) count++;
        return count;
    },

    /**
     * Clear all rendered data and reset
     */
    clear() {
        console.log('[GEO_RENDERER] Clearing all rendered data...');

        Object.values(this.cityMarkers).forEach(mesh => {
            if (mesh) {
                this.scene.remove(mesh);
                mesh.geometry.dispose();
                mesh.material.dispose();
            }
        });

        if (this.highwayMesh) {
            this.scene.remove(this.highwayMesh);
            this.highwayMesh.geometry.dispose();
            this.highwayMesh.material.dispose();
        }

        this.cityMarkers = { tier1: null, tier2: null, tier3: null };
        this.highwayMesh = null;
        this.cityData = [];
        this.highwayData = [];
        this.activeRegion = null;

        console.log('[GEO_RENDERER] Cleared');
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GEO_RENDERER;
}
