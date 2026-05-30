'use client';

import Link from 'next/link';

export default function EmptyNotesState() {
  const handleScrollToPrompt = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const element = document.getElementById('note-topic-input');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.focus();
    }
  };

  return (
    <div className="ec-root">
      <style>{`
        /* ── CSS Custom Properties ── */
        .ec-root {
          --text-main: #1a1a1a;
          --text-secondary: #888888;
          --bg-page: transparent;
          --card-bg: #ffffff;
        }

        /* ── Root Layout ── */
        .ec-root {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 65vh;
          overflow: visible;
          font-family: 'DM Sans', sans-serif;
          background: transparent;
        }

        /* ── Spaceship image with faded edges ── */
        .ec-ship-wrap {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -44%);
          width: 380px;
          pointer-events: none;
          z-index: 0;
        }

        .ec-ship {
          width: 100%;
          height: auto;
          display: block;
          mask-image: radial-gradient(ellipse 62% 55% at 50% 50%, black 30%, transparent 75%);
          -webkit-mask-image: radial-gradient(ellipse 62% 55% at 50% 50%, black 30%, transparent 75%);
        }

        /* ── Glow blobs behind ship ── */
        .ec-glow-purple {
          position: absolute;
          width: 260px; height: 260px;
          border-radius: 50%;
          background: rgba(143, 78, 230, 0.22);
          filter: blur(60px);
          top: 50%; left: 50%;
          transform: translate(-65%, -52%);
          pointer-events: none;
          z-index: 0;
        }
        .ec-glow-pink {
          position: absolute;
          width: 220px; height: 220px;
          border-radius: 50%;
          background: rgba(244, 114, 182, 0.18);
          filter: blur(55px);
          top: 50%; left: 50%;
          transform: translate(-30%, -40%);
          pointer-events: none;
          z-index: 0;
        }
        .ec-glow-blue {
          position: absolute;
          width: 200px; height: 200px;
          border-radius: 50%;
          background: rgba(96, 165, 250, 0.18);
          filter: blur(50px);
          top: 50%; left: 50%;
          transform: translate(-50%, -20%);
          pointer-events: none;
          z-index: 0;
        }

        /* ── Float Animation ── */
        @keyframes floatSlow {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-10px) rotate(3deg); }
        }

        /* ── Main Content ── */
        .ec-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          max-width: 700px;
          padding: 20px 20px 30px;
          width: 100%;
        }

        /* ── Lost text ── */
        .ec-lost {
          font-size: 15px;
          color: var(--text-secondary);
          font-weight: 400;
          margin-bottom: 12px;
          font-family: 'DM Sans', sans-serif;
        }

        /* ── Title wrapper ── */
        .ec-title-wrap {
          position: relative;
          display: inline-block;
          margin-bottom: 14px;
        }

        /* ── Gradient icon decoration ── */
        .ec-deco {
          position: absolute;
          font-family: 'Material Symbols Rounded';
          font-weight: normal;
          font-style: normal;
          font-size: 24px;
          line-height: 1;
          letter-spacing: normal;
          text-transform: none;
          white-space: nowrap;
          word-wrap: normal;
          direction: ltr;
          -webkit-font-smoothing: antialiased;
          background: linear-gradient(to bottom, #F7B2FB 50%, #786EF1 80%, #5588FB 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          filter: drop-shadow(0 0 6px rgba(255,255,255,0.9)) drop-shadow(0 0 1px rgba(255,255,255,1));
          user-select: none;
          pointer-events: none;
        }

        .ec-deco-cloud {
          top: -18px;
          left: -24px;
          font-size: 42px;
          animation: floatSlow 5s ease-in-out 0.3s infinite;
        }

        .ec-deco-heart {
          bottom: -15px;
          right: 20px;
          font-size: 32px;
          animation: floatSlow 4.5s ease-in-out 1s infinite;
        }

        /* ── Title ── */
        .ec-title {
          font-size: clamp(32px, 4.5vw, 48px);
          font-weight: 500;
          letter-spacing: -1.5px;
          line-height: 1.08;
          color: #0f0f0f;
          margin: 0;
          padding: 0 10px;
          font-family: 'DM Sans', sans-serif;
        }

        /* ── Subtext ── */
        .ec-subtext {
          font-size: 14px;
          color: var(--text-secondary);
          line-height: 1.7;
          max-width: 470px;
          margin-bottom: 28px;
          font-family: 'DM Sans', sans-serif;
        }

        /* ── Highlighted inline tags ── */
        .ec-tag {
          display: inline-flex;
          align-items: center;
          background: #E0E2E7;
          font-size: 12.5px;
          font-weight: 600;
          padding: 2px 12px;
          border-radius: 6px;
          color: var(--text-main);
          vertical-align: middle;
          margin: 0 3px;
          font-family: 'DM Sans', sans-serif;
        }

        /* ── Cards container ── */
        .ec-cards {
          display: flex;
          flex-direction: column;
          gap: 12px;
          max-width: 460px;
          width: 100%;
          margin-top: 130px;
        }

        /* ── Individual card ── */
        .ec-card {
          background: var(--card-bg);
          border-radius: 18px;
          padding: 18px 22px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border: 1px solid rgba(0,0,0,0.05);
          box-shadow: 0 2px 12px rgba(0,0,0,0.04);
          cursor: pointer;
          text-decoration: none;
          transition: transform 0.3s ease, box-shadow 0.3s ease;
          color: inherit;
        }

        .ec-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 28px rgba(0,0,0,0.08);
        }

        .ec-card-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        /* ── Icon circle ── */
        .ec-card-icon {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: #eaecf0;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: transform 0.3s ease;
        }

        .ec-card:hover .ec-card-icon {
          transform: scale(1.05);
        }

        .ec-card-text {
          text-align: left;
        }

        .ec-card-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-main);
          font-family: 'DM Sans', sans-serif;
        }

        .ec-card-sub {
          font-size: 12px;
          color: var(--text-secondary);
          font-family: 'DM Sans', sans-serif;
        }

        /* ── Right arrow ── */
        .ec-card-arrow {
          font-size: 21px;
          color: var(--text-secondary);
          transition: transform 0.3s ease;
          line-height: 1;
          font-weight: 300;
        }

        .ec-card:hover .ec-card-arrow {
          transform: translateX(6px);
        }

        /* ── Responsive: 768px ── */
        @media (max-width: 768px) {
          .ec-ship-wrap {
            width: 260px;
          }
          .ec-title {
            font-size: 30px;
          }
          .ec-deco-cloud {
            font-size: 32px;
            top: -14px;
            left: -18px;
          }
          .ec-deco-heart {
            font-size: 24px;
            bottom: -10px;
            right: 12px;
          }
          .ec-cards {
            gap: 10px;
            max-width: 100%;
            padding: 0 4px;
          }
          .ec-card {
            padding: 14px 18px;
          }
          .ec-card-icon {
            width: 42px;
            height: 42px;
          }
        }

        /* ── Responsive: 480px ── */
        @media (max-width: 480px) {
          .ec-ship-wrap {
            width: 200px;
          }
          .ec-title {
            font-size: 26px;
          }
          .ec-deco-cloud {
            font-size: 26px;
            top: -12px;
            left: -14px;
          }
          .ec-deco-heart {
            font-size: 20px;
            bottom: -8px;
            right: 6px;
          }
        }
      `}</style>

      {/* ── Glow blobs ── */}
      <div className="ec-glow-purple" />
      <div className="ec-glow-pink" />
      <div className="ec-glow-blue" />

      {/* ── Spaceship with masked/faded edges ── */}
      <div className="ec-ship-wrap">
        <img
          src="https://pub-e68758f43067417dba612b2371819aa1.r2.dev/viktor-components/alien-spaceship.png"
          alt=""
          className="ec-ship"
        />
      </div>

      {/* ── Main Content ── */}
      <div className="ec-main" style={{ position: 'relative', zIndex: 1 }}>

        {/* Lost text */}
        <p className="ec-lost">No notes yet...</p>

        {/* Title wrapper with decorations */}
        <div className="ec-title-wrap">

          {/* Cloud decoration */}
          <span className="ec-deco ec-deco-cloud">cloud</span>

          {/* Heart decoration */}
          <span className="ec-deco ec-deco-heart">favorite</span>

          {/* Title */}
          <h2 className="ec-title">Blank Canvas, Infinite Knowledge</h2>
        </div>

        {/* Subtext */}
        <p className="ec-subtext">
          Create your first brilliant study note by entering a <span className="ec-tag">topic</span> above,
          choosing a decorative <span className="ec-tag">page design</span> and letting Migoo craft an exportable Cornell, Mind-map, or summary layout.
        </p>

        {/* Navigation Cards */}
        <div className="ec-cards">

          {/* Card 1 — Create New Note */}
          <a href="#note-topic-input" onClick={handleScrollToPrompt} className="ec-card">
            <div className="ec-card-left">
              <div className="ec-card-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
              </div>
              <div className="ec-card-text">
                <div className="ec-card-title">Start Fresh Canvas</div>
                <div className="ec-card-sub">Enter your note topic above...</div>
              </div>
            </div>
            <span className="ec-card-arrow">›</span>
          </a>

          {/* Card 2 — Explore Full Courses */}
          <Link href="/course-generator" className="ec-card">
            <div className="ec-card-left">
              <div className="ec-card-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
              </div>
              <div className="ec-card-text">
                <div className="ec-card-title">Explore Full Courses</div>
                <div className="ec-card-sub">Learn smarter with full video courses...</div>
              </div>
            </div>
            <span className="ec-card-arrow">›</span>
          </Link>

        </div>
      </div>
    </div>
  );
}
