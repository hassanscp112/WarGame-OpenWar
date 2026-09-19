const https = require('https');
const fs = require('fs');
const path = require('path');

// GeoBoundaries CGAZ ADM1: The academic gold-standard dataset for Administrative Level 1
// Contains globally consistent ADM1 divisions (No micro-counties masquerading as regions)
const SOURCE_URL = 'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/CGAZ/geoBoundariesCGAZ_ADM1.geojson';
const OUTPUT_PATH = path.join(__dirname, '..', 'province_polygons.js');

function download(url) {
    return new Promise((resolve, reject) => {
        console.log('Downloading GeoBoundaries CGAZ ADM1 (344MB)... This may take a moment.');
        let data = [];
        let length = 0;
        https.get(url, { headers: { 'User-Agent': 'Node' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400) {
                return download(res.headers.location).then(resolve).catch(reject);
            }
            res.on('data', chunk => {
                data.push(chunk);
                length += chunk.length;
            });
            res.on('end', () => {
                console.log(`Downloaded ${(length / 1024 / 1024).toFixed(1)}MB`);
                let buffer = Buffer.concat(data, length);
                console.log('Parsing JSON...');
                resolve(JSON.parse(buffer.toString('utf8')));
            });
        }).on('error', reject);
    });
}

function simplifyCoord(c, precision) {
    if (typeof c[0] === 'number') {
        return [parseFloat(c[0].toFixed(precision)), parseFloat(c[1].toFixed(precision))];
    }
    return c.map(x => simplifyCoord(x, precision));
}

// Simple Douglas-Peucker-like point reduction
function reduceRing(ring, tolerance) {
    if (ring.length <= 4) return ring;
    let result = [ring[0]];
    for (let i = 1; i < ring.length - 1; i++) {
        let prev = result[result.length - 1];
        let dx = ring[i][0] - prev[0];
        let dy = ring[i][1] - prev[1];
        if (Math.sqrt(dx*dx + dy*dy) > tolerance) {
            result.push(ring[i]);
        }
    }
    result.push(ring[ring.length - 1]);
    return result;
}

function simplifyGeometry(geom, tolerance) {
    if (geom.type === 'Polygon') {
        return {
            type: 'Polygon',
            coordinates: geom.coordinates.map(ring => reduceRing(simplifyCoord(ring, 2), tolerance))
        };
    } else if (geom.type === 'MultiPolygon') {
        return {
            type: 'MultiPolygon',
            coordinates: geom.coordinates.map(poly => 
                poly.map(ring => reduceRing(simplifyCoord(ring, 2), tolerance))
            )
        };
    }
    return geom;
}

async function main() {
    const geojson = await download(SOURCE_URL);
    console.log(`Raw features: ${geojson.features.length}`);
    
    // GeoBoundaries structure: properties: { shapeName: "...", shapeGroup: "ISO3" }
    let features = geojson.features.map(f => {
        let name = f.properties.shapeName || '';
        let a3 = f.properties.shapeGroup || '';
        
        let outGeometry = simplifyGeometry(f.geometry, 0.05);

        return {
            type: "Feature",
            properties: { n: name, i: '', a: '', a3: a3 },
            geometry: outGeometry
        };
    });
    
    // Filter completely empty polygon objects caused by extreme simplification
    features = features.filter(f => f.geometry && f.geometry.coordinates && f.geometry.coordinates.length > 0);
    
    let countries = new Set(features.map(f => f.properties.a3));
    console.log(`Provinces Finalized: ${features.length} across ${countries.size} countries`);
    
    let output = {
        type: "FeatureCollection",
        features: features
    };
    
    const jsContent = `// Auto-generated real-world province polygons (GeoBoundaries CGAZ ADM1)\n// ${features.length} provinces across ${countries.size} countries\n// Globally consistent Admin-1 boundaries\nconst PROVINCE_POLYGONS = ${JSON.stringify(output)};\n`;
    fs.writeFileSync(OUTPUT_PATH, jsContent);
    console.log(`Written: ${OUTPUT_PATH} (${(fs.statSync(OUTPUT_PATH).size / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch(e => {
    console.error("FATAL ERROR:", e.message);
    if (e.message.indexOf('string length') > -1 || e.message.indexOf('heap out of memory') > -1) {
        console.error("Please run the script using: node --max-old-space-size=4096 scripts/build_province_polygons.js");
    }
});
