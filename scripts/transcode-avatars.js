/**
 * Re-transcodes HeyGen avatar clips with ALL-KEYFRAME encoding for perfect Remotion seeking.
 * Run: node scripts/transcode-avatars.js
 *
 * Why all-keyframes (-g 1)?
 * Remotion's compositor uses exact-position seeking. With a large GOP (e.g. 250 frames),
 * seeking to an intermediate frame means decoding from the last I-frame,
 * which some Remotion compositor versions can't do → "No frame found at position X".
 * Making every frame a keyframe eliminates seeking entirely.
 */
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const ffmpegPath = require('ffmpeg-static');
const avatarsDir = path.join(__dirname, '..', 'public', 'avatars');

const clips = [
    { input: 'Avatar1 Intro.mp4', output: 'avatar1-intro.mp4' },
    { input: 'Avatar2 Intro.mp4', output: 'avatar2-intro.mp4' },
    { input: 'Avatar3 Intro.mp4', output: 'avatar3-intro.mp4' },
    { input: 'Avatar4 Outro.mp4', output: 'avatar4-outro.mp4' },
    { input: 'Avatar5 Outro.mp4', output: 'avatar5-outro.mp4' },
    { input: 'Avatar6 Outro.mp4', output: 'avatar6-outro.mp4' },
];

async function transcode(input, output) {
    const inputPath  = path.join(avatarsDir, input);
    const outputPath = path.join(avatarsDir, output);

    if (!fs.existsSync(inputPath)) { console.warn(`⚠️  NOT FOUND: ${input}`); return; }

    // Always overwrite — re-transcode with correct settings
    if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
        console.log(`🗑️  Removed old: ${output}`);
    }

    // -r 30         → force constant 30fps output
    // -vsync cfr    → enforce CFR (constant frame rate)
    // -g 1          → every frame is a keyframe (I-frame only)
    // -keyint_min 1 → minimum keyframe interval = 1 (all keyframes)
    // -sc_threshold 0 → disable scene-change detection for consistent frame boundaries
    // -bf 0         → no B-frames
    // -refs 1       → single reference frame
    // -preset slow  → higher quality encoding for more reliable compositor decoding
    // -pix_fmt yuv420p → broad compatibility
    // -an              → strip audio (we play our own TTS audio in Remotion)
    // -movflags +faststart → moov atom at file start for instant seeking (required by Remotion compositor)
    const cmd = `"${ffmpegPath}" -y -i "${inputPath}" -r 30 -vsync cfr -c:v libx264 -preset slow -crf 18 -g 1 -keyint_min 1 -sc_threshold 0 -bf 0 -refs 1 -pix_fmt yuv420p -an -movflags +faststart "${outputPath}"`;

    console.log(`🎬 Re-transcoding (all-keyframe): ${input} → ${output}`);
    return new Promise((resolve, reject) =>
        exec(cmd, (err, _stdout, stderr) => {
            if (err) {
                console.error(`❌ FAILED: ${input}`);
                console.error(stderr?.slice(-500));
                reject(err);
            } else {
                const mb = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
                console.log(`✅ Done: ${output} (${mb} MB, all-keyframe CFR 30fps)`);
                resolve();
            }
        })
    );
}

(async () => {
    console.log(`\n🔑 All-keyframe CFR transcode for Remotion compatibility`);
    console.log(`FFmpeg: ${ffmpegPath}`);
    console.log(`Dir:    ${avatarsDir}\n`);
    for (const { input, output } of clips) await transcode(input, output);
    console.log('\n✨ Done! All clips re-transcoded with all-keyframe encoding.\n');
})();
