import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  RotateCcw,
  Heart,
  Trash2,
  X,
  ImagePlus,
  Sparkles,
  Maximize2,
  Minimize2,
  LogIn,
  ExternalLink,
} from 'lucide-react';
import { CandidatePhoto, PhotoStatus } from '../types';

interface SwipeViewProps {
  queue: CandidatePhoto[];
  canUndo: boolean;
  onSwipe: (photo: CandidatePhoto, status: PhotoStatus) => void;
  onUndo: () => void;
  onSignIn: () => void;
  onOpenGooglePicker: () => void;
  onJumpToAdmin: (tab?: 'print' | 'delete' | 'shown') => void;
  counts: {
    print: number;
    delete: number;
    shown: number;
  };
  pickerLoadingText: string;
  activePickerUrl?: string;
  isCloudSynced?: boolean;
}

interface GestureRefState {
  active: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastTime: number;
  vx: number;
  vy: number;
  animatingOut: boolean;
}

export const SwipeView: React.FC<SwipeViewProps> = ({
  queue,
  canUndo,
  onSwipe,
  onUndo,
  onSignIn,
  onOpenGooglePicker,
  onJumpToAdmin,
  counts,
  pickerLoadingText,
  activePickerUrl,
  isCloudSynced,
}) => {
  const current = queue[0] || null;
  const secondCard = queue[1] || null;
  const thirdCard = queue[2] || null;

  const [fitContain, setFitContain] = useState(false);
  const [stageSize, setStageSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [naturalRatios, setNaturalRatios] = useState<Record<string, number>>({});

  const stageRef = useRef<HTMLDivElement | null>(null);
  const activeCardRef = useRef<HTMLDivElement | null>(null);
  const nextCardRef = useRef<HTMLDivElement | null>(null);
  const badgePrintRef = useRef<HTMLDivElement | null>(null);
  const badgeSkipRef = useRef<HTMLDivElement | null>(null);
  const badgeDeleteRef = useRef<HTMLDivElement | null>(null);
  const tintRef = useRef<HTMLDivElement | null>(null);

  const gestureRef = useRef<GestureRefState>({
    active: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    lastTime: 0,
    vx: 0,
    vy: 0,
    animatingOut: false,
  });

  // Measure exact available stage bounds for responsive Desktop, iPad, and Mobile fitting
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setStageSize({ w: Math.floor(rect.width), h: Math.floor(rect.height) });
      }
    };

    updateSize();
    const ro = new ResizeObserver(() => updateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const getPhotoRatio = useCallback(
    (photo: CandidatePhoto): number => {
      if (naturalRatios[photo.id]) return naturalRatios[photo.id];
      if (photo.width > 0 && photo.height > 0) return photo.width / photo.height;
      return 3 / 4;
    },
    [naturalRatios]
  );

  // Compute exact card dimensions:
  // - On iPad & Desktop (stageW >= 580): fit the card frame tightly to the photo's true aspect ratio
  //   within (stageW, stageH) so both portrait and landscape photos fill the page cleanly with zero cropping!
  // - On Mobile (stageW < 580): fill the mobile card viewport, using ambient backdrop for landscape photos.
  const getCardFrameStyle = useCallback(
    (photo: CandidatePhoto): React.CSSProperties => {
      const { w: stageW, h: stageH } = stageSize;
      if (!stageW || !stageH) {
        return { width: '100%', height: '100%' };
      }

      const isTabletOrDesktop = stageW >= 580;
      if (!isTabletOrDesktop) {
        return {
          width: `${stageW}px`,
          height: `${stageH}px`,
        };
      }

      const ratio = getPhotoRatio(photo);
      let cardW = stageH * ratio;
      let cardH = stageH;
      if (cardW > stageW) {
        cardW = stageW;
        cardH = stageW / ratio;
      }

      return {
        width: `${Math.round(cardW)}px`,
        height: `${Math.round(cardH)}px`,
      };
    },
    [stageSize, getPhotoRatio]
  );

  const shouldUseContainWithAmbient = useCallback(
    (photo: CandidatePhoto): boolean => {
      if (fitContain) return true;
      const isTabletOrDesktop = stageSize.w >= 580;
      if (isTabletOrDesktop) {
        // On Desktop/iPad the card frame itself matches the photo's aspect ratio, so contain shows 100% cleanly
        return true;
      }
      // On Mobile phones, use contain + ambient backdrop automatically for landscape photos so edges aren't cut off
      const ratio = getPhotoRatio(photo);
      return ratio > 1.02;
    },
    [fitContain, stageSize.w, getPhotoRatio]
  );

  // Reset card DOM transforms whenever the top card changes
  useEffect(() => {
    gestureRef.current.active = false;
    gestureRef.current.animatingOut = false;

    const card = activeCardRef.current;
    if (card) {
      card.style.transition = 'none';
      card.style.transform = 'translate3d(0px, 0px, 0px) rotate(0deg)';
      card.style.opacity = '1';
    }
    if (nextCardRef.current) {
      nextCardRef.current.style.transition = 'none';
      nextCardRef.current.style.transform = 'scale(0.96) translateY(8px)';
      nextCardRef.current.style.opacity = '0.88';
    }
    if (badgePrintRef.current) badgePrintRef.current.style.opacity = '0';
    if (badgeSkipRef.current) badgeSkipRef.current.style.opacity = '0';
    if (badgeDeleteRef.current) badgeDeleteRef.current.style.opacity = '0';
    if (tintRef.current) tintRef.current.style.opacity = '0';
  }, [current?.id]);

  const applyDragVisuals = useCallback((dx: number, dy: number) => {
    const card = activeCardRef.current;
    if (!card) return;

    const rot = dx * 0.045;
    card.style.transform = `translate3d(${dx}px, ${dy}px, 0px) rotate(${rot}deg)`;

    const dist = Math.min(1, Math.hypot(dx, dy) / 120);
    if (nextCardRef.current) {
      const scale = 0.96 + 0.04 * dist;
      const ty = 8 * (1 - dist);
      nextCardRef.current.style.transform = `scale(${scale}) translateY(${ty}px)`;
      nextCardRef.current.style.opacity = `${0.88 + 0.12 * dist}`;
    }

    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const isUpwardDominant = dy < -20 && absY > absX * 0.85;
    const isRightDominant = !isUpwardDominant && dx > 20;
    const isLeftDominant = !isUpwardDominant && dx < -20;

    const pOpacity = isRightDominant ? Math.min(1, (dx - 20) / 70) : 0;
    const sOpacity = isLeftDominant ? Math.min(1, (-dx - 20) / 70) : 0;
    const dOpacity = isUpwardDominant ? Math.min(1, (-dy - 20) / 70) : 0;

    if (badgePrintRef.current) badgePrintRef.current.style.opacity = String(pOpacity);
    if (badgeSkipRef.current) badgeSkipRef.current.style.opacity = String(sOpacity);
    if (badgeDeleteRef.current) badgeDeleteRef.current.style.opacity = String(dOpacity);

    if (tintRef.current) {
      if (pOpacity > 0) {
        tintRef.current.style.background = 'rgba(16, 185, 129, 0.22)';
        tintRef.current.style.opacity = String(pOpacity);
      } else if (dOpacity > 0) {
        tintRef.current.style.background = 'rgba(244, 63, 94, 0.24)';
        tintRef.current.style.opacity = String(dOpacity);
      } else if (sOpacity > 0) {
        tintRef.current.style.background = 'rgba(15, 23, 42, 0.22)';
        tintRef.current.style.opacity = String(sOpacity);
      } else {
        tintRef.current.style.opacity = '0';
      }
    }
  }, []);

  const commitFlyOut = useCallback(
    (status: PhotoStatus) => {
      if (!current || gestureRef.current.animatingOut) return;
      gestureRef.current.animatingOut = true;
      gestureRef.current.active = false;

      const card = activeCardRef.current;
      const vw = window.innerWidth || 400;
      const vh = window.innerHeight || 800;

      if (card) {
        card.style.transition =
          'transform 0.24s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.22s ease';
        if (status === 'print') {
          card.style.transform = `translate3d(${vw * 0.95}px, 30px, 0px) rotate(16deg)`;
          if (badgePrintRef.current) badgePrintRef.current.style.opacity = '1';
        } else if (status === 'shown') {
          card.style.transform = `translate3d(${-vw * 0.95}px, 30px, 0px) rotate(-16deg)`;
          if (badgeSkipRef.current) badgeSkipRef.current.style.opacity = '1';
        } else {
          card.style.transform = `translate3d(0px, ${-vh * 0.95}px, 0px) rotate(0deg)`;
          if (badgeDeleteRef.current) badgeDeleteRef.current.style.opacity = '1';
        }
        card.style.opacity = '0';
      }

      if (nextCardRef.current) {
        nextCardRef.current.style.transition = 'transform 0.24s ease, opacity 0.24s ease';
        nextCardRef.current.style.transform = 'scale(1) translateY(0px)';
        nextCardRef.current.style.opacity = '1';
      }

      const swipedPhoto = current;
      setTimeout(() => {
        onSwipe(swipedPhoto, status);
      }, 210);
    },
    [current, onSwipe]
  );

  const springBack = useCallback(() => {
    const card = activeCardRef.current;
    if (card) {
      card.style.transition = 'transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1)';
      card.style.transform = 'translate3d(0px, 0px, 0px) rotate(0deg)';
    }
    if (nextCardRef.current) {
      nextCardRef.current.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
      nextCardRef.current.style.transform = 'scale(0.96) translateY(8px)';
      nextCardRef.current.style.opacity = '0.88';
    }
    if (badgePrintRef.current) badgePrintRef.current.style.opacity = '0';
    if (badgeSkipRef.current) badgeSkipRef.current.style.opacity = '0';
    if (badgeDeleteRef.current) badgeDeleteRef.current.style.opacity = '0';
    if (tintRef.current) tintRef.current.style.opacity = '0';
  }, []);

  // Unified Gesture Lifecycle (iOS Touch, iPad Touch, Android Touch, and Desktop Mouse)
  useEffect(() => {
    const card = activeCardRef.current;
    if (!card || !current) return;

    const startGesture = (clientX: number, clientY: number) => {
      if (gestureRef.current.animatingOut) return;
      const now = performance.now();
      gestureRef.current = {
        active: true,
        startX: clientX,
        startY: clientY,
        lastX: clientX,
        lastY: clientY,
        lastTime: now,
        vx: 0,
        vy: 0,
        animatingOut: false,
      };
      card.style.transition = 'none';
      if (nextCardRef.current) nextCardRef.current.style.transition = 'none';
    };

    const moveGesture = (clientX: number, clientY: number) => {
      const g = gestureRef.current;
      if (!g.active || g.animatingOut) return;

      const now = performance.now();
      const dt = Math.max(1, now - g.lastTime);
      g.vx = (clientX - g.lastX) / dt;
      g.vy = (clientY - g.lastY) / dt;
      g.lastX = clientX;
      g.lastY = clientY;
      g.lastTime = now;

      const dx = clientX - g.startX;
      const dy = clientY - g.startY;
      applyDragVisuals(dx, dy);
    };

    const endGesture = () => {
      const g = gestureRef.current;
      if (!g.active || g.animatingOut) return;
      g.active = false;

      const dx = g.lastX - g.startX;
      const dy = g.lastY - g.startY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);

      const isUpSwipe = absY > absX * 0.8 && (dy < -60 || (dy < -25 && g.vy < -0.38));
      const isRightSwipe =
        !isUpSwipe && absX >= absY * 0.7 && (dx > 60 || (dx > 25 && g.vx > 0.38));
      const isLeftSwipe =
        !isUpSwipe && absX >= absY * 0.7 && (dx < -60 || (dx < -25 && g.vx < -0.38));

      if (isUpSwipe) {
        commitFlyOut('delete');
      } else if (isRightSwipe) {
        commitFlyOut('print');
      } else if (isLeftSwipe) {
        commitFlyOut('shown');
      } else {
        springBack();
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if ((e.target as HTMLElement)?.closest('button')) return;
      if (e.touches.length !== 1) return;
      startGesture(e.touches[0].clientX, e.touches[0].clientY);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!gestureRef.current.active) return;
      if (e.cancelable) e.preventDefault();
      moveGesture(e.touches[0].clientX, e.touches[0].clientY);
    };

    const onTouchEnd = () => {
      endGesture();
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement)?.closest('button')) return;
      e.preventDefault();
      startGesture(e.clientX, e.clientY);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!gestureRef.current.active) return;
      moveGesture(e.clientX, e.clientY);
    };

    const onMouseUp = () => {
      endGesture();
    };

    card.addEventListener('touchstart', onTouchStart, { passive: true });
    card.addEventListener('touchmove', onTouchMove, { passive: false });
    card.addEventListener('touchend', onTouchEnd);
    card.addEventListener('touchcancel', onTouchEnd);

    card.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      card.removeEventListener('touchstart', onTouchStart);
      card.removeEventListener('touchmove', onTouchMove);
      card.removeEventListener('touchend', onTouchEnd);
      card.removeEventListener('touchcancel', onTouchEnd);

      card.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [current, applyDragVisuals, commitFlyOut, springBack]);

  // Keyboard shortcuts for Desktop & iPad keyboards
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        commitFlyOut('print');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        commitFlyOut('shown');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        commitFlyOut('delete');
      } else if ((e.key === 'Backspace' || e.key.toLowerCase() === 'z') && canUndo) {
        e.preventDefault();
        onUndo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commitFlyOut, canUndo, onUndo]);

  const handleImgLoad = (photoId: string, e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      const r = img.naturalWidth / img.naturalHeight;
      setNaturalRatios((prev) => (prev[photoId] === r ? prev : { ...prev, [photoId]: r }));
    }
  };

  const isTabletOrDesktop = stageSize.w >= 580;

  return (
    <main className="swipe-screen" aria-label="Swipe Photo Deck">
      {/* Compact Top Meta Strip */}
      <div className="swipe-meta-row">
        <span className="queue-counter-label">
          {queue.length > 0
            ? `${queue.length} photo${queue.length > 1 ? 's' : ''} left`
            : 'All caught up'}
          {isCloudSynced ? ' • Cloud synced' : ''}
        </span>

        <div className="mini-counters">
          <button
            type="button"
            className="mini-counter-pill"
            onClick={() => onJumpToAdmin('print')}
            title="View Print Queue"
          >
            <Heart size={13} fill="var(--color-print)" color="var(--color-print)" />
            <span>{counts.print}</span>
          </button>

          <button
            type="button"
            className="mini-counter-pill"
            onClick={() => onJumpToAdmin('delete')}
            title="View Marked for Deletion"
          >
            <Trash2 size={13} color="var(--color-delete)" />
            <span>{counts.delete}</span>
          </button>
        </div>
      </div>

      {/* Responsive 3D Card Stack Stage */}
      <div ref={stageRef} className="deck-stage">
        {pickerLoadingText ? (
          <div
            style={{
              background: 'var(--bg-surface)',
              borderRadius: 'var(--radius-xl)',
              padding: '36px 24px',
              textAlign: 'center',
              boxShadow: 'var(--shadow-elevated)',
              width: '100%',
              maxWidth: '420px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <Sparkles size={28} color="var(--color-print)" />
            <h2 style={{ fontSize: '17px', fontWeight: 700 }}>Importing from Google Photos</h2>
            <p style={{ fontSize: '13px', color: 'var(--ink-secondary)', lineHeight: 1.5 }}>
              {pickerLoadingText}
            </p>
            {activePickerUrl && (
              <a
                href={activePickerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="pill-btn pill-btn-ink"
                style={{ textDecoration: 'none', marginTop: '4px' }}
              >
                <ExternalLink size={15} />
                <span>Open Google Photos Tab</span>
              </a>
            )}
          </div>
        ) : !current ? (
          <div
            style={{
              background: 'var(--bg-surface)',
              borderRadius: 'var(--radius-xl)',
              padding: '40px 28px',
              textAlign: 'center',
              boxShadow: 'var(--shadow-elevated)',
              border: '1px solid var(--border-hairline)',
              width: '100%',
              maxWidth: '420px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '14px',
            }}
          >
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                background: 'var(--color-print-soft)',
                color: 'var(--color-print)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Heart size={26} fill="currentColor" />
            </div>
            <div>
              <h2 style={{ fontSize: '19px', fontWeight: 800, letterSpacing: '-0.02em' }}>
                {isCloudSynced ? 'No Photos in Queue' : 'Welcome to PrintPick'}
              </h2>
              <p
                style={{
                  fontSize: '13px',
                  color: 'var(--ink-secondary)',
                  marginTop: '6px',
                  lineHeight: 1.5,
                  maxWidth: '310px',
                }}
              >
                {isCloudSynced
                  ? 'Select a batch from Google Photos to start swiping. Your queue stays synced across all your devices.'
                  : 'Sign in with your Google account to sync your family queue and pick photos from Google Photos.'}
              </p>
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: '8px',
                marginTop: '4px',
              }}
            >
              {!isCloudSynced ? (
                <button type="button" className="pill-btn pill-btn-ink" onClick={onSignIn}>
                  <LogIn size={16} />
                  <span>Sign in with Google</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="pill-btn pill-btn-ink"
                  onClick={onOpenGooglePicker}
                >
                  <ImagePlus size={16} />
                  <span>Pick from Google Photos</span>
                </button>
              )}
              {counts.print > 0 && (
                <button
                  type="button"
                  className="pill-btn pill-btn-emerald"
                  onClick={() => onJumpToAdmin('print')}
                >
                  <span>Review Print Queue ({counts.print})</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* 3rd Card in Stack */}
            {thirdCard && (
              <div
                className="deck-card deck-card-behind-2"
                style={getCardFrameStyle(thirdCard)}
                aria-hidden="true"
              >
                <img
                  src={thirdCard.displayUrl || thirdCard.thumbDataUrl}
                  alt=""
                  className="deck-card-img"
                />
              </div>
            )}

            {/* 2nd Card in Stack */}
            {secondCard && (
              <div
                ref={nextCardRef}
                className="deck-card deck-card-behind-1"
                style={getCardFrameStyle(secondCard)}
                aria-hidden="true"
              >
                <img
                  src={secondCard.displayUrl || secondCard.thumbDataUrl}
                  alt=""
                  className="deck-card-img"
                  onLoad={(e) => handleImgLoad(secondCard.id, e)}
                />
              </div>
            )}

            {/* Top Interactive Swipe Card */}
            <div
              ref={activeCardRef}
              key={current.id}
              className="deck-card deck-card-active"
              style={getCardFrameStyle(current)}
            >
              <div ref={tintRef} className="gesture-tint" />

              {/* Live Swipe Badges */}
              <div ref={badgePrintRef} className="gesture-badge gesture-badge-print">
                <Heart size={18} fill="#ffffff" />
                <span>PRINT</span>
              </div>
              <div ref={badgeSkipRef} className="gesture-badge gesture-badge-skip">
                <X size={18} />
                <span>SKIP</span>
              </div>
              <div ref={badgeDeleteRef} className="gesture-badge gesture-badge-delete">
                <Trash2 size={18} />
                <span>DELETE</span>
              </div>

              {/* Fit / Fill Toggle on Mobile */}
              {!isTabletOrDesktop && (
                <button
                  type="button"
                  className="card-fit-toggle"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFitContain((v) => !v);
                  }}
                  title={fitContain ? 'Fill card' : 'Show uncropped photo'}
                >
                  {fitContain ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
                </button>
              )}

              {/* Blurred Ambient Backdrop (when fitting landscape photo on mobile) */}
              {!isTabletOrDesktop && shouldUseContainWithAmbient(current) && (
                <img
                  src={current.displayUrl || current.thumbDataUrl}
                  alt=""
                  aria-hidden="true"
                  className="deck-card-ambient"
                />
              )}

              <img
                src={current.displayUrl || current.thumbDataUrl}
                alt={current.filename}
                className={`deck-card-img ${
                  shouldUseContainWithAmbient(current) ? 'fit-contain' : ''
                }`}
                draggable={false}
                onLoad={(e) => handleImgLoad(current.id, e)}
              />

              {/* Clean Photo Caption Scrim */}
              <div className="card-bottom-scrim">
                <div>
                  <div className="card-date-title">
                    {new Date(current.createTime).toLocaleDateString([], {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </div>
                  <div className="card-sub-caption">
                    {new Date(current.createTime).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                    {isTabletOrDesktop
                      ? ' • Drag or press ← Skip • ↑ Delete • → Print'
                      : ' • Swipe left to skip, up to delete, right to print'}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Tactile Circular Thumb Action Dock */}
      <div className="thumb-dock">
        <div className="dock-item">
          <button
            id="btn-swipe-undo"
            type="button"
            className="dock-circle dock-circle-sm"
            disabled={!canUndo}
            onClick={onUndo}
            aria-label="Undo last swipe"
          >
            <RotateCcw size={19} />
          </button>
          <span className="dock-label">Undo</span>
        </div>

        <div className="dock-item">
          <button
            id="btn-swipe-left-ignore"
            type="button"
            className="dock-circle dock-circle-lg dock-circle-skip"
            disabled={!current}
            onClick={() => commitFlyOut('shown')}
            aria-label="Skip and mark as shown"
          >
            <X size={27} strokeWidth={2.5} />
          </button>
          <span className="dock-label">Skip</span>
        </div>

        <div className="dock-item">
          <button
            id="btn-swipe-up-delete"
            type="button"
            className="dock-circle dock-circle-md dock-circle-delete"
            disabled={!current}
            onClick={() => commitFlyOut('delete')}
            aria-label="Mark for deletion"
          >
            <Trash2 size={22} />
          </button>
          <span className="dock-label">Delete</span>
        </div>

        <div className="dock-item">
          <button
            id="btn-swipe-right-print"
            type="button"
            className="dock-circle dock-circle-lg dock-circle-print"
            disabled={!current}
            onClick={() => commitFlyOut('print')}
            aria-label="Mark for print"
          >
            <Heart size={26} fill="#ffffff" />
          </button>
          <span className="dock-label">Print</span>
        </div>
      </div>
    </main>
  );
};
