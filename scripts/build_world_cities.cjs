/**
 * Build world cities using:
 * 1. Province NAMES from our province_polygons.js (what's rendered on globe)
 * 2. Real coordinates from NE admin-1 states/provinces dataset
 * 3. Spatial fallback for unmatched polygons to closest admin-1 label in the same country
 * 4. Centroid fallback ONLY for extreme outliers (should be < 50 worldwide)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const POLYGONS_FILE = path.join(__dirname, '..', 'public', 'data', 'province_polygons.js');
const OUTPUT_FILE = path.join(__dirname, '..', 'public', 'data', 'world_cities_generated.js');

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
                console.log('Downloaded ' + (data.length / 1024 / 1024).toFixed(1) + 'MB');
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
        .replace(/[''\-\.]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

async function main() {
    console.log('Reading province_polygons.js...');
    let raw = fs.readFileSync(POLYGONS_FILE, 'utf8');
    let jsonStart = raw.indexOf('{');
    let jsonData = raw.substring(jsonStart).replace(/;\s*$/, '');
    let geojson = JSON.parse(jsonData);
    console.log('Province polygons: ' + geojson.features.length);

    let admin1 = await download(ADMIN1_URL);
    console.log('Admin-1 features: ' + admin1.features.length);

    let admin1Lookup = {};
    let admin1ByCountry = {};

    admin1.features.forEach(f => {
        let p = f.properties;
        let iso3 = p.sr_adm0_a3 || p.sr_gu_a3 || p.sr_sov_a3 || '';
        if (!iso3) return;

        let coords = f.geometry.coordinates;
        if (!coords || coords.length < 2) return;
        let labelLon = parseFloat(coords[0].toFixed(3));
        let labelLat = parseFloat(coords[1].toFixed(3));

        let name = p.name || '';
        if (!name) return;

        let key = iso3 + '_' + normalize(name);
        if (!admin1Lookup[key]) {
            admin1Lookup[key] = { lat: labelLat, lon: labelLon, used: false };
        }

        if (!admin1ByCountry[iso3]) admin1ByCountry[iso3] = [];
        admin1ByCountry[iso3].push({
            lat: labelLat,
            lon: labelLon,
            name: name
        });
    });

    console.log('Admin-1 lookup entries: ' + Object.keys(admin1Lookup).length);

    let cities = [];
    let seenKey = new Set();
    let matchedExact = 0, matchedSpatial = 0, centroidFallback = 0;

    geojson.features.forEach(f => {
        let props = f.properties;
        let name = props.n || '';
        let iso3 = props.a3 || '';
        if (!name || !iso3) return;

        let key = iso3 + '_' + name;
        if (seenKey.has(key)) return;
        seenKey.add(key);

        let lookupKey = iso3 + '_' + normalize(name);
        let lat, lon;
        
        let centroid = computeCentroid(f.geometry.coordinates);
        if (!centroid) return;

        if (admin1Lookup[lookupKey] && !admin1Lookup[lookupKey].used) {
            lat = admin1Lookup[lookupKey].lat;
            lon = admin1Lookup[lookupKey].lon;
            admin1Lookup[lookupKey].used = true;
            matchedExact++;
        } else {
            let bestDist = Infinity;
            let bestLabel = null;
            if (admin1ByCountry[iso3]) {
                for (let label of admin1ByCountry[iso3]) {
                    let dLat = label.lat - centroid.lat;
                    let dLon = label.lon - centroid.lon;
                    let dist = dLat*dLat + dLon*dLon;
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestLabel = label;
                    }
                }
            }
            if (bestLabel && bestDist < 25) { 
                lat = bestLabel.lat;
                lon = bestLabel.lon;
                matchedSpatial++;
            } else {
                lat = centroid.lat;
                lon = centroid.lon;
                centroidFallback++;
            }
        }

        cities.push({
            name: name,
            lat: lat,
            lon: lon,
            country: iso3,
            tier: 'provincial'
        });
    });

    console.log('\nExact matches by Name: ' + matchedExact);
    console.log('Spatial Fallbacks Setup (Real Locations): ' + matchedSpatial);
    console.log('Centroid Fallbacks: ' + centroidFallback);

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

        let key = iso + '_' + name;
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

    console.log('National capitals added: ' + capitalCount);

    cities.sort((a, b) => {
        if (a.tier === 'national_capital' && b.tier !== 'national_capital') return -1;
        if (b.tier === 'national_capital' && a.tier !== 'national_capital') return 1;
        return a.country.localeCompare(b.country) || a.name.localeCompare(b.name);
    });

    let countries = new Set(cities.map(c => c.country));

    console.log('\n=== FINAL OUTPUT ===');
    console.log('  Countries: ' + countries.size);
    console.log('  National capitals: ' + cities.filter(c => c.tier === 'national_capital').length);
    console.log('  Province cities: ' + cities.filter(c => c.tier === 'provincial').length);
    console.log('  Total: ' + cities.length);

    let lines = cities.map(c => {
        return "{name:'" + c.name.replace(/'/g, "\\'") + "',lat:" + c.lat + ",lon:" + c.lon + ",country:'" + c.country + "',tier:'" + c.tier + "'}";
    });

    let js = "// Auto-generated world cities - one per admin-1 province\n" +
             "// Real locations from NE admin-1 label points via exact name match or spatial proximity\n" +
             "// Only " + centroidFallback + " extreme outlier provinces fall back to mathematical centroid\n" +
             "// " + cities.length + " cities across " + countries.size + " countries\n" +
             "// Generated: " + new Date().toISOString() + "\n\n" +
             "const WORLD_CITIES_DB = [\n" + lines.join(',\n') + "\n];\n";

    fs.writeFileSync(OUTPUT_FILE, js);
    console.log('\nWritten: ' + OUTPUT_FILE + ' (' + (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(0) + ' KB)');
}

main().catch(console.error);
