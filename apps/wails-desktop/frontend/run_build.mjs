import { execa } from 'execa';
import fs from 'fs';

async function main() {
    try {
        const { stdout, stderr } = await execa('npm.cmd', ['run', 'build']);
        fs.writeFileSync('build-ok.log', stdout);
    } catch (err) {
        fs.writeFileSync('build-err.log', err.stdout + '\n' + err.stderr);
    }
}
main();
