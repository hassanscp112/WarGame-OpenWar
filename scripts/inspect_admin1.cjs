const https = require('https');

const url = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_label_points.geojson';

let data = '';
https.get(url, { headers: { 'User-Agent': 'Node' } }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400) {
        https.get(res.headers.location, { headers: { 'User-Agent': 'Node' } }, handleRes).on('error', console.error);
        return;
    }
    handleRes(res);
}).on('error', console.error);

function handleRes(res) {
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        let geo = JSON.parse(data);
        console.log('Total features:', geo.features.length);

        // Show first feature's properties
        let f = geo.features[0];
        console.log('\nFirst feature properties:');
        console.log(JSON.stringify(f.properties, null, 2));

        // Show geometry type
        console.log('\nGeometry type:', f.geometry.type);
        console.log('Coordinates:', JSON.stringify(f.geometry.coordinates));

        // Check a few more
        console.log('\n--- Property keys across all features ---');
        let keys = new Set();
        geo.features.slice(0, 5).forEach(f => {
            Object.keys(f.properties).forEach(k => keys.add(k));
        });
        console.log([...keys].join(', '));
    });
}
