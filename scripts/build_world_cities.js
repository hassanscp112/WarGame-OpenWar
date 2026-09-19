const https = require('https');
const fs = require('fs');
const path = require('path');

// Natural Earth 10m populated places — comprehensive global city dataset
const CITIES_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson';
const OUTPUT_PUBLIC = path.join(__dirname, '..', 'public', 'data', 'world_cities_generated.js');

// European ISO-A3 codes — admin-1 cities from these countries will be EXCLUDED
// (national capitals are always kept)
const EUROPE_ISO3 = new Set([
    'ALB','AND','AUT','BLR','BEL','BIH','BGR','HRV','CYP','CZE',
    'DNK','EST','FIN','FRA','DEU','GRC','HUN','ISL','IRL','ITA',
    'XKX','KOS','LVA','LIE','LTU','LUX','MKD','MLT','MDA','MCO',
    'MNE','NLD','NOR','POL','PRT','ROU','RUS','SMR','SRB','SVK',
    'SVN','ESP','SWE','CHE','UKR','GBR','VAT',
    // Territories and overseas
    'FRO','GGY','GIB','IMN','JEY','SJM','ALA'
]);

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

async function main() {
    const geo = await download(CITIES_URL);
    console.log(`Raw features: ${geo.features.length}`);

    let cities = [];
    let seenKey = new Set();
    let europeanSkipped = 0;

    geo.features.forEach(f => {
        let p = f.properties;
        let coords = f.geometry.coordinates;
        if (!coords || coords.length < 2) return;

        let lon = parseFloat(coords[0].toFixed(3));
        let lat = parseFloat(coords[1].toFixed(3));
        if (isNaN(lon) || isNaN(lat)) return;

        let name = p.name || p.nameascii || '';
        if (!name) return;

        let iso = p.adm0_a3 || p.iso_a3 || '';
        if (!iso) return;

        // Determine tier
        let tier = null;
        let isCapital = (p.featurecla === 'Admin-0 capital' || p.featurecla === 'Admin-0 capital alt');
        let isAdmin1 = (p.featurecla === 'Admin-1 capital' || p.featurecla === 'Admin-1 region capital');

        if (isCapital) {
            tier = 'national_capital';
        } else if (isAdmin1) {
            // Skip European admin-1 cities (too many small divisions)
            if (EUROPE_ISO3.has(iso)) {
                europeanSkipped++;
                return;
            }
            tier = 'provincial';
        }

        // Skip anything that isn't Admin-0 or Admin-1 capital
        if (!tier) return;

        // Deduplicate
        let key = `${iso}_${name}`;
        if (seenKey.has(key)) return;
        seenKey.add(key);

        cities.push({
            name: name,
            lat: lat,
            lon: lon,
            country: iso,
            tier: tier,
            pop: p.pop_max || 0
        });
    });

    // Sort: national capitals first, then by population
    cities.sort((a, b) => {
        if (a.tier === 'national_capital' && b.tier !== 'national_capital') return -1;
        if (b.tier === 'national_capital' && a.tier !== 'national_capital') return 1;
        return (b.pop || 0) - (a.pop || 0);
    });

    // Stats
    let countries = new Set(cities.map(c => c.country));
    let natCaps = cities.filter(c => c.tier === 'national_capital').length;
    let provCaps = cities.filter(c => c.tier === 'provincial').length;

    console.log(`\nOutput stats:`);
    console.log(`  Countries: ${countries.size}`);
    console.log(`  National capitals: ${natCaps}`);
    console.log(`  Provincial/admin-1 capitals: ${provCaps}`);
    console.log(`  European admin-1 skipped: ${europeanSkipped}`);
    console.log(`  Total cities: ${cities.length}`);

    // Generate JS
    let lines = cities.map(c => {
        return `{name:'${c.name.replace(/'/g, "\\'")}',lat:${c.lat},lon:${c.lon},country:'${c.country}',tier:'${c.tier}'}`;
    });

    let js = `// Auto-generated world cities from Natural Earth 10m populated places
// ${cities.length} cities across ${countries.size} countries
// European admin-1 cities excluded (national capitals kept)
// Generated: ${new Date().toISOString()}

const WORLD_CITIES_DB = [
${lines.join(',\n')}
];
`;

    fs.writeFileSync(OUTPUT_PUBLIC, js);
    console.log(`\nWritten: ${OUTPUT_PUBLIC} (${(fs.statSync(OUTPUT_PUBLIC).size / 1024).toFixed(0)} KB)`);
}

main().catch(console.error);
