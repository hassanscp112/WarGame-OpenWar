const fs = require('fs');
let lines = fs.readFileSync('src/main.js', 'utf8').split('\n');

const correctCode = `let ws = null, wsReady = false, isOnline = false, roomCode = null;
let myRole = 'player';
let serverUrl = 'ws://localhost:10294';

function connectWS() {
    const inputUrl = document.getElementById('serverUrl')?.value || 'localhost';
    serverUrl = \`ws://\${inputUrl}:10294\`;
    
    try {
        ws = new WebSocket(serverUrl);
        ws.onopen = () => {
            wsReady = true;
            const status = document.getElementById('onlineStatus');
            if(status) {
                status.textContent = ' متصل السيرفر';
                status.style.color = '#00ff88';
            }
            document.getElementById('btnCreate').disabled = false;
            document.getElementById('btnJoin').disabled = false;
        };
        ws.onclose = () => {
            wsReady = false;
            const status = document.getElementById('onlineStatus');
            if(status) {
                status.textContent = ' انقطع الاتصال';
                status.style.color = '#ff4444';
            }
            document.getElementById('btnCreate').disabled = true;
            document.getElementById('btnJoin').disabled = true;
        };
        ws.onerror = () => {
            const status = document.getElementById('onlineStatus');
            if(status) {
                status.textContent = ' السيرفر غير متاح';
                status.style.color = '#ffcc00';
            }
        };
        ws.onmessage = e => handleWSMsg(JSON.parse(e.data));
    } catch(e) {
        console.error('WS Error:', e);
    }
}`;

lines.splice(1773, 26, correctCode);
fs.writeFileSync('src/main.js', lines.join('\n'));
console.log('Fixed main.js');
