const fs = require('fs');
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
        fs.writeFileSync('ne_10m_admin_1_label_points.geojson', JSON.stringify(geo, null, 2));
        console.log('Saved');
    });
}
