import fs from 'fs';
import path from 'path';

async function downloadAsset(url, destRelPath) {
    if (!url || !url.startsWith("http")) return url;
    
    // In GitHub Actions, we run from the project root.
    const absolutePath = path.join(process.cwd(), 'public', destRelPath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    
    try {
        console.log(`⬇️ Downloading ${url} locally to ${destRelPath}...`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(absolutePath, buffer);
        console.log(`✅ Downloaded ${destRelPath}`);
        return `/${destRelPath}`;
    } catch (err) {
        console.warn(`⚠️ Failed to download ${url}: ${err.message}. Falling back to remote URL.`);
        return url;
    }
}

async function downloadAllAssets() {
    console.log('📥 Running pre-render asset download script for GitHub Actions...');
    
    const propsPath = path.join(process.cwd(), 'tmp', 'props.json');
    if (!fs.existsSync(propsPath)) {
        console.error('❌ props.json not found in tmp/');
        process.exit(1);
    }

    const props = JSON.parse(fs.readFileSync(propsPath, 'utf8'));
    const assetsDir = `tmp/assets_gh_runner`;

    let modified = false;

    // 1. Download scene videos
    if (props.sceneVideoUrls && Array.isArray(props.sceneVideoUrls)) {
        for (let i = 0; i < props.sceneVideoUrls.length; i++) {
            if (props.sceneVideoUrls[i]) {
                const oldUrl = props.sceneVideoUrls[i];
                props.sceneVideoUrls[i] = await downloadAsset(oldUrl, `${assetsDir}/scene_${i}.mp4`) || oldUrl;
                if (props.sceneVideoUrls[i] !== oldUrl) modified = true;
            }
        }
    }

    // 2. Download audio
    if (props.audioUrl) {
        const oldUrl = props.audioUrl;
        props.audioUrl = await downloadAsset(oldUrl, `${assetsDir}/audio.wav`) || oldUrl;
        if (props.audioUrl !== oldUrl) modified = true;
    }
    
    // 3. Download music
    if (props.musicUrl) {
        const oldUrl = props.musicUrl;
        props.musicUrl = await downloadAsset(oldUrl, `${assetsDir}/music.mp3`) || oldUrl;
        if (props.musicUrl !== oldUrl) modified = true;
    }
    
    // 4. Download Avatar clips
    if (props.introClip && props.introClip.videoUrl) {
        const oldUrl = props.introClip.videoUrl;
        props.introClip.videoUrl = await downloadAsset(oldUrl, `${assetsDir}/intro_video.mp4`) || oldUrl;
        if (props.introClip.videoUrl !== oldUrl) modified = true;
    }
    if (props.outroClip && props.outroClip.videoUrl) {
        const oldUrl = props.outroClip.videoUrl;
        props.outroClip.videoUrl = await downloadAsset(oldUrl, `${assetsDir}/outro_video.mp4`) || oldUrl;
        if (props.outroClip.videoUrl !== oldUrl) modified = true;
    }

    if (modified) {
        fs.writeFileSync(propsPath, JSON.stringify(props));
        console.log('✅ props.json updated with local paths. GitHub Actions is immune from network timeouts.');
    } else {
        console.log('⏭️ No remote Remotion assets to download or no changes needed.');
    }
}

downloadAllAssets().catch(err => {
    console.error('Fatal error in download-assets.js:', err);
    process.exit(1);
});
