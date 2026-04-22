const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Renders a Remotion video locally using the CLI.
 * This is for LOCAL DEVELOPMENT ONLY — not used on Vercel.
 * On Vercel, rendering is done via GitHub Actions (see .github/workflows/render-video.yml).
 */
async function renderLocal(videoId, props) {
    return new Promise((resolve, reject) => {
        console.log(`🚀 Starting local render for video: ${videoId}`);

        // Create a temp props file
        const propsPath = path.join(process.cwd(), 'tmp', `props-${videoId}.json`);
        if (!fs.existsSync(path.join(process.cwd(), 'tmp'))) {
            fs.mkdirSync(path.join(process.cwd(), 'tmp'));
        }
        fs.writeFileSync(propsPath, JSON.stringify(props));

        const outputPath = path.join(process.cwd(), 'public', 'renders', `${videoId}.mp4`);
        if (!fs.existsSync(path.join(process.cwd(), 'public', 'renders'))) {
            fs.mkdirSync(path.join(process.cwd(), 'public', 'renders'), { recursive: true });
        }

        const command = `npx remotion render MainVideo "${outputPath}" --props="${propsPath.replace(/\\/g, '/')}"`;

        console.log(`💻 Executing: ${command}`);

        const child = exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`❌ Render error: ${error.message}`);
                return reject(error);
            }
            if (stderr) {
                console.warn(`⚠️ Render warning: ${stderr}`);
            }
            console.log(`✅ Render complete: ${outputPath}`);
            resolve(`/renders/${videoId}.mp4`);
        });

        child.stdout.on('data', (data) => {
            console.log(`[Remotion] ${data}`);
        });
    });
}

module.exports = { renderLocal };
