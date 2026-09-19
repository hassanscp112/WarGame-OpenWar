/**
 * Build world cities using:
 * 1. Province NAMES from our province_polygons.js (what's rendered on globe)
 * 2. Real coordinates from NE admin-1 states/provinces dataset (has label_x/label_y)
 * 3. Centroid fallback ONLY for unmatched provinces
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const POLYGONS_FILE = path.join(__dirname, '..', 'public', 'data', 'province_polygons.js');
const OUTPUT_FILE = path.join(__dirname, '..', 'public', 'data', 'world_cities_generated.js');

// Admin-1 with label points (latitude/longitude of each admin-1 capital)
const ADMIN1_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_label_points.geojson';
const CAPITALS_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson';

function download(url) {
    return new Promise((resolve, reject) => {
        console.log('Downloading:', url.split('/').pop());
        let data = '';
        https.get(url, { headers: { 'User-Agent': 'Node' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400) {
                return download(res.headers.location).then(resolve).catch(reject);
            }
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`Downloaded ${(data.length / 1024 / 1024).toFixed(1)}MB`);
                resolve(JSON.parse(data));
            });
        }).on('error', reject);
    });
}

function computeCentroid(coordinates) {
    let rings;
    if (Array.isArray(coordinates[0][0][0])) {
        let largest = coordinates[0];
        for (let poly of coordinates) {
            if (poly[0].length > largest[0].length) largest = poly;
        }
        rings = largest;
    } else {
        rings = coordinates;
    }
    let ring = rings[0];
    if (!ring || ring.length === 0) return null;
    let sumLon = 0, sumLat = 0;
    for (let coord of ring) {
        sumLon += coord[0];
        sumLat += coord[1];
    }
    return {
        lon: parseFloat((sumLon / ring.length).toFixed(3)),
        lat: parseFloat((sumLat / ring.length).toFixed(3))
    };
}

function normalize(name) {
    return name
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[''`\-\.]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

async function main() {
    // Step 1: Load province polygons (our source of truth for which provinces exist)
    console.log('Reading province_polygons.js...');
    let raw = fs.readFileSync(POLYGONS_FILE, 'utf8');
    let jsonStart = raw.indexOf('{');
    let jsonData = raw.substring(jsonStart).replace(/;\s*$/, '');
    let geojson = JSON.parse(jsonData);
    console.log(`Province polygons: ${geojson.features.length}`);

    // Step 2: Download NE admin-1 (has label_x, label_y for each admin-1 region)
    let admin1 = await download(ADMIN1_URL);
    console.log(`Admin-1 features: ${admin1.features.length}`);

    // Build lookup: "ISO3_normalized_name" → {lat, lon}
    let admin1Lookup = {};

    admin1.features.forEach(f => {
        let p = f.properties;
        let iso3 = p.sr_adm0_a3 || p.sr_gu_a3 || p.sr_sov_a3 || '';
        if (!iso3) return;

        // Coordinates come from the Point geometry
        let coords = f.geometry.coordinates;
        if (!coords || coords.length < 2) return;
        let labelLon = coords[0];
        let labelLat = coords[1];

        let name = p.name || '';
        if (!name) return;

        let key = `${iso3}_${normalize(name)}`;
        if (!admin1Lookup[key]) {
            admin1Lookup[key] = {
                lat: parseFloat(parseFloat(labelLat).toFixed(3)),
                lon: parseFloat(parseFloat(labelLon).toFixed(3))
            };
        }
    });

    console.log(`Admin-1 lookup entries: ${Object.keys(admin1Lookup).length}`);

    // Step 3: Process each province polygon
    let cities = [];
    let seenKey = new Set();
    let matchedAdmin1 = 0, centroidFallback = 0;

    geojson.features.forEach(f => {
        let props = f.properties;
        let name = props.n || '';
        let iso3 = props.a3 || '';
        if (!name || !iso3) return;

        let key = `${iso3}_${name}`;
        if (seenKey.has(key)) return;
        seenKey.add(key);

        let nName = normalize(name);
        let lookupKey = `${iso3}_${nName}`;

        let lat, lon;
        if (admin1Lookup[lookupKey]) {
            lat = admin1Lookup[lookupKey].lat;
            lon = admin1Lookup[lookupKey].lon;
            matchedAdmin1++;
        } else {
            // Centroid fallback
            let centroid = computeCentroid(f.geometry.coordinates);
            if (!centroid) return;
            lat = centroid.lat;
            lon = centroid.lon;
            centroidFallback++; if(centroidFallback <= 20) console.log("Missing match for:", name, "ISO3:", iso3, "normalized:", nName);
        }

        cities.push({
            name: name,
            lat: lat,
            lon: lon,
            country: iso3,
            tier: 'provincial'
        });
    });

    console.log(`\nAdmin-1 label matches: ${matchedAdmin1}`);
    console.log(`Centroid fallback: ${centroidFallback}`);

    // Step 4: Add national capitals
    let capitals = await download(CAPITALS_URL);
    let capitalCount = 0;

    capitals.features.forEach(f => {
        let p = f.properties;
        let cls = p.featurecla || '';
        if (!cls.includes('Admin-0 capital')) return;

        let coords = f.geometry.coordinates;
        if (!coords || coords.length < 2) return;

        let name = p.name || p.nameascii || '';
        let iso = p.adm0_a3 || p.iso_a3 || '';
        if (!name || !iso) return;

        let key = `${iso}_${name}`;
        if (seenKey.has(key)) return;
        seenKey.add(key);

        cities.push({
            name: name,
            lat: parseFloat(coords[1].toFixed(3)),
            lon: parseFloat(coords[0].toFixed(3)),
            country: iso,
            tier: 'national_capital'
        });
        capitalCount++;
    });

    console.log(`National capitals added: ${capitalCount}`);

    // Sort
    cities.sort((a, b) => {
        if (a.tier === 'national_capital' && b.tier !== 'national_capital') return -1;
        if (b.tier === 'national_capital' && a.tier !== 'national_capital') return 1;
        return a.country.localeCompare(b.country) || a.name.localeCompare(b.name);
    });

    let countries = new Set(cities.map(c => c.country));

    console.log(`\n=== FINAL OUTPUT ===`);
    console.log(`  Countries: ${countries.size}`);
    console.log(`  National capitals: ${cities.filter(c => c.tier === 'national_capital').length}`);
    console.log(`  Province cities: ${cities.filter(c => c.tier === 'provincial').length}`);
    console.log(`  Total: ${cities.length}`);

    let lines = cities.map(c => {
        return `{name:'${c.name.replace(/'/g, "\\'")}',lat:${c.lat},lon:${c.lon},country:'${c.country}',tier:'${c.tier}'}`;
    });

    let js = `// Auto-generated world cities — one per admin-1 province
// Real locations from NE admin-1 label points, centroid fallback for unmatched
// ${cities.length} cities across ${countries.size} countries
// Generated: ${new Date().toISOString()}

const WORLD_CITIES_DB = [
${lines.join(',\n')}
];
`;

    fs.writeFileSync(OUTPUT_FILE, js);
    console.log(`\nWritten: ${OUTPUT_FILE} (${(fs.statSync(OUTPUT_FILE).size / 1024).toFixed(0)} KB)`);
}

main().catch(console.error);

