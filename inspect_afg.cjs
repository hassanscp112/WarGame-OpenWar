const fs = require('fs');
const geolbl = JSON.parse(fs.readFileSync('ne_10m_admin_1_label_points.geojson', 'utf8'));
const afg = geolbl.features.filter(f => (f.properties.sr_adm0_a3 || f.properties.sr_gu_a3 || f.properties.sr_sov_a3) === 'AFG');
afg.forEach(f => console.log(f.properties.name, '|||', f.properties.name_alt, '|||', f.properties.iso_3166_2));
