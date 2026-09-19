const fs = require('fs');

const POLYGONS_FILE = 'public/data/province_polygons.js';
const ADMIN1_FILE = 'ne_10m_admin_1_label_points.geojson';

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
    return { lon: sumLon / ring.length, lat: sumLat / ring.length };
}

let raw = fs.readFileSync(POLYGONS_FILE, 'utf8');
let jsonStart = raw.indexOf('{');
let jsonData = raw.substring(jsonStart).replace(/;\s*$/, '');
let geojson = JSON.parse(jsonData);

let admin1 = JSON.parse(fs.readFileSync(ADMIN1_FILE, 'utf8'));

let admin1ByCountry = {};
admin1.features.forEach(f => {
    let p = f.properties;
    let iso3 = p.sr_adm0_a3 || p.sr_gu_a3 || p.sr_sov_a3 || '';
    let coords = f.geometry.coordinates;
    if (!iso3 || !coords || coords.length < 2) return;
    if (!admin1ByCountry[iso3]) admin1ByCountry[iso3] = [];
    admin1ByCountry[iso3].push({
        lat: parseFloat(coords[1]),
        lon: parseFloat(coords[0]),
        name: p.name || ''
    });
});

let matched = 0, spatial = 0, centroid = 0;
geojson.features.forEach(f => {
    let iso3 = f.properties.a3 || '';
    if (!iso3) return;
    
    let cent = computeCentroid(f.geometry.coordinates);
    if (!cent) return;

    // Simulate spatial lookup for all to see average distance
    let bestDist = Infinity;
    let bestLabel = null;
    if (admin1ByCountry[iso3]) {
        for (let label of admin1ByCountry[iso3]) {
            let dLat = label.lat - cent.lat;
            let dLon = label.lon - cent.lon;
            let dist = dLat*dLat + dLon*dLon;
            if (dist < bestDist) {
                bestDist = dist;
                bestLabel = label;
            }
        }
    }
    if (bestLabel && bestDist < 25) { // 5 degrees threshold
        spatial++;
    } else {
        centroid++;
    }
});

console.log('Spatial matches:', spatial);
console.log('Centroid backstops:', centroid);
