const { execSync } = require('child_process');
const fs = require('fs');
try {
  let r = execSync('npm run build', { stdio: 'pipe' });
  fs.writeFileSync('build-output.txt', 'OK\n' + r.toString());
} catch (e) {
  fs.writeFileSync('build-output.txt', 'ERR\n' + (e.stdout ? e.stdout.toString() : '') + '\n' + (e.stderr ? e.stderr.toString() : ''));
}
