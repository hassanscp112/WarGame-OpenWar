/**
 * GEO_PROVINCES - Province Border Integration
 * Fetches admin boundary data from Overpass API and renders province borders
 * Integrated into the base game map
 */

const GEO_PROVINCES = {
    // Cache for province data
    provinceMeshes: {},
    activeProvinces: [],
    
    /**
     * Fetch province boundaries for a specific region using Overpass API
     */
    async fetchProvinces(bbox) {
        // bbox format: [south, west, north, east]
        const query = `
[bbox:${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}]
[out:json];
(
  relation["boundary"="administrative"]["admin_level"="4"];
  way["boundary"="administrative"]["admin_level"="4"];
);
out geom;
`;
        try {
            const url = 'https://overpass-api.de/api/interpreter';
            const response = await fetch(url, {
                method: 'POST',
                body: query
            });
            const data = await response.json();
            return data.elements || [];
        } catch (e) {
            console.warn('[GEO_PROVINCES] Overpass API failed:', e);
            return [];
        }
    },
    
    /**
     * Convert province boundary to 3D mesh on globe
     */
    createProvinceMesh(element, color = [0.2, 0.4, 0.6]) {
        const points = [];
        
        // Handle both ways and relations
        if (element.geometry) {
            element.geometry.forEach(coord => {
                const vec3 = window.latLonToVec3 
                    ? window.latLonToVec3(coord.lat, coord.lon, 6371 + 0.3)
                    : new THREE.Vector3(0, 0, 0);
                points.push(vec3);
            });
        }
        
        if (points.length < 2) return null;
        
        // Create line geometry from points
        const geometry = new THREE.BufferGeometry();
        geometry.setFromPoints(points);
        
        // Create material
        const material = new THREE.LineBasicMaterial({
            color: new THREE.Color(color[0], color[1], color[2]),
            transparent: true,
            opacity: 0.3,
            linewidth: 1
        });
        
        // Create line mesh
        const mesh = new THREE.Line(geometry, material);
        return mesh;
    },
    
    /**
     * Load and render all provinces for a region
     */
    async loadProvincesForRegion(regionKey) {
        // Get bounding box from GEO_FETCHER regions
        const region = GEO_FETCHER?.regions?.[regionKey];
        if (!region) {
            console.warn(`[GEO_PROVINCES] Region not found: ${regionKey}`);
            return;
        }
        
        // Convert to Overpass bbox format: [minLat, minLon, maxLat, maxLon]
        const bbox = [region.minLat, region.minLon, region.maxLat, region.maxLon];
        
        console.log(`[GEO_PROVINCES] Loading provinces for: ${regionKey}`);
        
        // Fetch province data
        const elements = await this.fetchProvinces(bbox);
        
        // Clear existing province meshes for this region
        if (this.provinceMeshes[regionKey]) {
            this.provinceMeshes[regionKey].forEach(mesh => {
                if (mesh && mesh.parent) mesh.parent.remove(mesh);
            });
        }
        
        this.provinceMeshes[regionKey] = [];
        
        // Create mesh for each province
        elements.forEach((element, idx) => {
            const colors = [
                [0.2, 0.5, 0.6],  // Blue
                [0.3, 0.6, 0.4],  // Green
                [0.5, 0.3, 0.6],  // Purple
                [0.6, 0.4, 0.2],  // Brown
                [0.2, 0.6, 0.5]   // Cyan
            ];
            
            const color = colors[idx % colors.length];
            const mesh = this.createProvinceMesh(element, color);
            
            if (mesh && window.scene) {
                window.scene.add(mesh);
                this.provinceMeshes[regionKey].push(mesh);
            }
        });
        
        console.log(`[GEO_PROVINCES] Loaded ${elements.length} province boundaries`);
    },
    
    /**
     * Clear all province meshes
     */
    clearProvinces() {
        Object.values(this.provinceMeshes).forEach(meshArray => {
            if (Array.isArray(meshArray)) {
                meshArray.forEach(mesh => {
                    if (mesh && mesh.parent) mesh.parent.remove(mesh);
                });
            }
        });
        this.provinceMeshes = {};
    }
};

// Make globally accessible
window.GEO_PROVINCES = GEO_PROVINCES;
