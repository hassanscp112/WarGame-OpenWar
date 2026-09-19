const fs = require('fs');
let lines = fs.readFileSync('src/data/constants.js', 'utf8').split('\n');

let nanoIdx = lines.findIndex(l => l.includes(" nano:    {name:'نانو سرب×10'"));
if (nanoIdx !== -1) {
    lines.splice(nanoIdx, 0, "export const DCFG={");
    fs.writeFileSync('src/data/constants.js', lines.join('\n'));
    console.log('Fixed constants.js');
} else {
    console.log('Could not find nano line');
}
