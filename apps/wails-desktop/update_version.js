const fs = require('fs');

const args = process.argv.slice(2);
const rawVersion = args[0];
const notes = args[1] || "";

function normalizeVersion(value) {
    const normalized = String(value || "").trim().replace(/^v/i, "");
    if (!/^\d+(?:\.\d+){1,3}$/.test(normalized)) {
        return "";
    }
    return normalized;
}

const newVer = normalizeVersion(rawVersion);

if (!rawVersion || !newVer) {
    console.error("Noto'g'ri versiya! Masalan: 1.9.85 (yoki v1.9.85)");
    process.exit(1);
}

// 1. Update version.json
fs.writeFileSync('version.json', JSON.stringify({ version: newVer, notes: notes }));
console.log(`[+] version.json yangilandi: ${newVer}`);

// 2. Update wails.json
const wailsPath = 'wails.json';
const wailsData = JSON.parse(fs.readFileSync(wailsPath, 'utf8'));
wailsData.info.productVersion = newVer;
fs.writeFileSync(wailsPath, JSON.stringify(wailsData, null, 2));
console.log(`[+] wails.json yangilandi: ${newVer}`);

// 3. Update updater.go
const updaterPath = 'updater.go';
let updaterCode = fs.readFileSync(updaterPath, 'utf8');
updaterCode = updaterCode.replace(/AppVersion(?:[ \t]*)=(?:[ \t]*)"[^"]+"/, `AppVersion = "${newVer}"`);
fs.writeFileSync(updaterPath, updaterCode);
console.log(`[+] updater.go yangilandi: ${newVer}`);

// 4. Update frontend version files
if (fs.existsSync('frontend/version.json')) {
    fs.writeFileSync('frontend/version.json', JSON.stringify({ version: newVer, notes: notes }));
    console.log(`[+] frontend/version.json yangilandi: ${newVer}`);
}
if (fs.existsSync('frontend/package.json')) {
    const pkg = JSON.parse(fs.readFileSync('frontend/package.json', 'utf8'));
    pkg.version = newVer;
    fs.writeFileSync('frontend/package.json', JSON.stringify(pkg, null, 2));
    console.log(`[+] frontend/package.json yangilandi: ${newVer}`);
}
