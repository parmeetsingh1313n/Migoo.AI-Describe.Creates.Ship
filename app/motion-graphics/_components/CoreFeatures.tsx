'use client';

export default function CoreFeatures() {
  return (
    <section className="c1-section">
      {/* Load Google Fonts Outfit */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap"
      />

      <style>{`
        /* ── Global resets within container ── */
        .c1-section {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
          font-family: 'Outfit', sans-serif;
          background: transparent;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 80px 20px;
        }

        .c1-section * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        /* ── Container ── */
        .c1-container {
          max-width: 1100px;
          width: 100%;
          text-align: center;
        }

        /* ── Badge ── */
        .c1-badge {
          display: inline-block;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 16px;
          background: linear-gradient(90deg, #F5C344, #F28482, #B567C2);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        /* ── Title ── */
        .c1-title {
          font-size: 2.75rem;
          font-weight: 500;
          color: #0f172a;
          letter-spacing: -0.02em;
          margin-bottom: 12px;
          line-height: 1.15;
        }

        /* ── Subtitle ── */
        .c1-subtitle {
          font-size: 1.125rem;
          color: #64748b;
          line-height: 1.5;
          margin-bottom: 50px;
        }

        /* ── Grid ── */
        .c1-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 24px;
        }

        /* ── Card Base ── */
        .c1-card {
          border-radius: 20px;
          height: 340px;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          position: relative;
          overflow: hidden;
          text-align: left;
          background: #F4F8F9;
          border: 1px solid rgba(0, 0, 0, 0.03);
          box-shadow: 0 10px 30px -10px rgba(0,0,0,0.1);
        }

        .c1-card-content {
          padding: 24px;
          z-index: 2;
          background: linear-gradient(to top, rgba(244,248,249,1) 60%, rgba(244,248,249,0.85) 80%, rgba(244,248,249,0) 100%);
        }

        .c1-card h3 {
          font-size: 1.05rem;
          font-weight: 600;
          color: #1e293b;
          margin-bottom: 6px;
        }

        .c1-card-desc {
          font-size: 0.85rem;
          color: #64748b;
          line-height: 1.4;
        }

        /* ── Card 1: Product & Event Promos ── */
        .c1-card-1 {
          background: radial-gradient(circle at 50% 0%, #FFB347 0%, #F9ED96 30%, #F4F8F9 60%, #F4F8F9 100%);
        }

        .c1-prompt-box {
          position: absolute;
          top: 30px;
          left: 24px;
          right: 24px;
          background: #ffffff;
          border-radius: 12px;
          padding: 16px;
          font-size: 0.8rem;
          color: #475569;
          line-height: 1.6;
          box-shadow: 0 8px 20px rgba(0,0,0,0.04);
          z-index: 1;
        }

        .c1-blur-text {
          font-weight: 600;
          background: linear-gradient(90deg, #FFB347, #E5A1F5);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .c1-pill-btn {
          position: absolute;
          top: 180px;
          left: 40px;
          background: #ffffff;
          border: 1px solid #000000;
          padding: 5px 14px;
          border-radius: 20px;
          font-size: 0.75rem;
          font-weight: 600;
          color: #1e293b;
          box-shadow: 0 4px 15px rgba(0,0,0,0.08);
          z-index: 1;
          display: flex;
          align-items: center;
          gap: 6px;
          cursor: default;
        }

        .c1-pill-sparkle {
          color: #a855f7;
          font-size: 1rem;
        }

        .c1-cursor {
          position: absolute;
          top: 205px;
          left: 110px;
          width: 24px;
          height: 24px;
          fill: #0f172a;
          filter: drop-shadow(0 4px 6px rgba(0,0,0,0.2));
          z-index: 10;
        }

        /* ── Card 2: Data & Pitch Stories ── */
        .c1-card-2 {
          background: radial-gradient(circle at 50% 0%, #E5A1F5 0%, #F8ACA0 30%, #F4F8F9 60%, #F4F8F9 100%);
        }

        .c1-api-visual {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 70px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 24px;
          z-index: 1;
        }

        .c1-network-img {
          width: 100%;
          height: 180px;
          object-fit: contain;
          margin-top: 20px;
        }

        /* ── Card 3: Social Clips & Trailers ── */
        .c1-card-3 {
          background: radial-gradient(circle at 50% 0%, #F9ED96 0%, #E5A1F5 30%, #F4F8F9 60%, #F4F8F9 100%);
        }

        .c1-mesh {
          position: absolute;
          inset: 0;
          background-image: 
            linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px);
          background-size: 16px 16px;
          mask-image: radial-gradient(circle at center top, black 0%, transparent 80%);
          -webkit-mask-image: radial-gradient(circle at center top, black 0%, transparent 80%);
          z-index: 1;
        }

        .c1-folder {
          position: absolute;
          top: 50px;
          left: 50%;
          transform: translateX(-50%);
          width: 170px;
          filter: drop-shadow(0 15px 25px rgba(0,0,0,0.08));
          z-index: 1;
        }

        .c1-search {
          position: absolute;
          top: 220px;
          left: 50%;
          transform: translateX(-50%);
          background: #ffffff;
          border: 1px solid #000000;
          padding: 6px 18px;
          border-radius: 20px;
          font-size: 0.75rem;
          font-weight: 500;
          color: #1e293b;
          box-shadow: 0 8px 20px rgba(0,0,0,0.06);
          white-space: nowrap;
          display: flex;
          align-items: center;
          gap: 8px;
          z-index: 1;
          cursor: default;
        }

        .c1-search-svg {
          width: 14px;
          height: 14px;
          stroke: #64748b;
          stroke-width: 2;
          fill: none;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        /* ── Breakpoints ── */
        @media (max-width: 900px) {
          .c1-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 600px) {
          .c1-grid {
            grid-template-columns: 1fr;
          }
          .c1-title {
            font-size: 2.25rem;
          }
        }
      `}</style>

      <div className="c1-container">
        {/* Header Block */}
        <div className="c1-header">
          <span className="c1-badge">Core Features</span>
          <h2 className="c1-title">Built for Speed & Quality</h2>
          <p className="c1-subtitle">
            Everything you need to go<br />from idea to motion
          </p>
        </div>

        {/* Card Grid */}
        <div className="c1-grid">
          
          {/* Card 1: Product Promos */}
          <div className="c1-card c1-card-1">
            <div className="c1-prompt-box">
              A bright, high-resolution 3D illustration of a <span className="c1-blur-text">cheerful cartoon</span> of a <span className="c1-blur-text">girl character</span> <span className="c1-blur-text">centred against a</span> smooth blue background
            </div>
            
            <div className="c1-pill-btn">
              Add more details <span className="c1-pill-sparkle">✦</span>
            </div>

            <svg className="c1-cursor" viewBox="0 0 24 24">
              <path d="M4 2L20 11L11 13L9 22L4 2Z" stroke="#ffffff" strokeWidth="1" />
            </svg>

            <div className="c1-card-content">
              <h3>Product Promos</h3>
              <p className="c1-card-desc">Animate features with cinematic text & stats. Perfect for conference & launch announcements.</p>
            </div>
          </div>

          {/* Card 2: Data Stories */}
          <div className="c1-card c1-card-2">
            <div className="c1-api-visual">
              <img
                src="https://pub-f170a2592d2c4a1485466404c36807be.r2.dev/viktor/network.svg"
                alt="Network Connections Diagram"
                className="c1-network-img"
              />
            </div>

            <div className="c1-card-content">
              <h3>Data Stories</h3>
              <p className="c1-card-desc">Animated charts, counters & comparisons. Create animated pitch decks for investors.</p>
            </div>
          </div>

          {/* Card 3: Social Clips */}
          <div className="c1-card c1-card-3">
            <div className="c1-mesh" />
            
            <img
              src="https://pub-f170a2592d2c4a1485466404c36807be.r2.dev/viktor/library%20icon.svg"
              alt="Folder Library Icon"
              className="c1-folder"
            />

            <div className="c1-search">
              <svg className="c1-search-svg" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <span>Search in library</span>
            </div>

            <div className="c1-card-content">
              <h3>Social Clips</h3>
              <p className="c1-card-desc">Instagram Reels, TikTok & YouTube Shorts. Promote courses with animated previews.</p>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
