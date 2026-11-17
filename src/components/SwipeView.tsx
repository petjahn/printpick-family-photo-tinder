import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, Heart, Trash2, X, ImagePlus, CheckCircle2 } from 'lucide-react';
import { CandidatePhoto, PhotoStatus } from '../types';

interface SwipeViewProps {
  queue: CandidatePhoto[];
  canUndo: boolean;
  onSwipe: (photo: CandidatePhoto, status: PhotoStatus) => void;
  onUndo: () => void;
  onOpenGooglePicker: () => void;
  onReloadDemo: () => void;
  counts: {
    print: number;
    delete: number;
    shown: number;
  };
  pickerLoadingText: string;
}

export const SwipeView: React.FC<SwipeViewProps> = ({
  queue,
  canUndo,
  onSwipe,
  onUndo,
  onOpenGooglePicker,
  onReloadDemo,
  counts,
  pickerLoadingText,
}) => {
  const current = queue[0] || null;
  const cardRef = useRef<HTMLDivElement | null>(null);

  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    startX: number;
    startY: number;
    dx: number;
    dy: number;
  }>({
    isDragging: false,
    startX: 0,
    startY: 0,
    dx: 0,
    dy: 0,
  });

  const triggerAnimatedSwipe = (status: PhotoStatus) => {
    if (!current) return;
    const targetDx = status === 'print' ? 340 : status === 'shown' ? -340 : 0;
    const targetDy = status === 'delete' ? -340 : 0;

    setDragState({
      isDragging: false,
      startX: 0,
      startY: 0,
      dx: targetDx,
      dy: targetDy,
    });

    setTimeout(() => {
      setDragState({ isDragging: false, startX: 0, startY: 0, dx: 0, dy: 0 });
      onSwipe(current, status);
    }, 180);
  };

  // Keyboard support for desktop/iPad
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        triggerAnimatedSwipe('print');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        triggerAnimatedSwipe('shown');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        triggerAnimatedSwipe('delete');
      } else if (e.key === 'Backspace' || e.key.toLowerCase() === 'z') {
        if (canUndo) {
          e.preventDefault();
          onUndo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      dy: 0,
    });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.isDragging) return;
    setDragState((prev) => ({
      ...prev,
      dx: e.clientX - prev.startX,
      dy: e.clientY - prev.startY,
    }));
  };

  const handlePointerEnd = () => {
    if (!dragState.isDragging) return;
    const { dx, dy } = dragState;

    // Upward swipe takes priority when vertical distance is dominant
    if (dy < -95 && Math.abs(dy) > Math.abs(dx)) {
      triggerAnimatedSwipe('delete');
    } else if (dx > 90) {
      triggerAnimatedSwipe('print');
    } else if (dx < -90) {
      triggerAnimatedSwipe('shown');
    } else {
      setDragState({ isDragging: false, startX: 0, startY: 0, dx: 0, dy: 0 });
    }
  };

  const { dx, dy, isDragging } = dragState;
  const rotation = dx * 0.045;
  const printOpacity = dx > 35 && Math.abs(dx) >= Math.abs(dy) ? Math.min(1, (dx - 35) / 85) : 0;
  const shownOpacity = dx < -35 && Math.abs(dx) >= Math.abs(dy) ? Math.min(1, (-dx - 35) / 85) : 0;
  const deleteOpacity = dy < -40 && Math.abs(dy) > Math.abs(dx) ? Math.min(1, (-dy - 40) / 85) : 0;

  return (
    <main className="swipe-viewport" aria-label="Swipe Photo Culler">
      {/* Live Status Strip */}
      <div className="swipe-top-pills">
        <div className="stat-pill" title="Remaining unseen photos in current picker batch">
          <span className="font-mono" style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
            {queue.length}
          </span>
          <span>in queue</span>
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          <div className="stat-pill" title="Marked for Print (Swipe Right)">
            <span className="stat-dot" style={{ background: 'var(--status-print)' }} />
            <span className="font-mono">{counts.print}</span>
          </div>
          <div className="stat-pill" title="Marked for Deletion (Swipe Up)">
            <span className="stat-dot" style={{ background: 'var(--status-delete)' }} />
            <span className="font-mono">{counts.delete}</span>
          </div>
          <div className="stat-pill" title="Marked as Shown / Ignored (Swipe Left)">
            <span className="stat-dot" style={{ background: 'var(--status-shown)' }} />
            <span className="font-mono">{counts.shown}</span>
          </div>
        </div>
      </div>

      {/* Main Card Stack Stage */}
      <div className="card-stage">
        {pickerLoadingText ? (
          <div
            style={{
              textAlign: 'center',
              padding: '32px 20px',
              background: 'var(--bg-surface)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-color)',
              width: '100%',
            }}
          >
            <p style={{ fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>
              Connecting to Google Photos...
            </p>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{pickerLoadingText}</p>
          </div>
        ) : !current ? (
          <div
            style={{
              textAlign: 'center',
              padding: '36px 24px',
              background: 'var(--bg-surface)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-color)',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <CheckCircle2 size={38} color="var(--status-print)" />
            <h2 style={{ fontSize: '17px', fontWeight: 600 }}>Queue Complete!</h2>
            <p
              style={{
                fontSize: '13px',
                color: 'var(--text-secondary)',
                maxWidth: '340px',
                lineHeight: 1.5,
              }}
            >
              Every photo in this batch has been categorized in Firebase. Already-seen photos will
              automatically be skipped next time you pick from Google Photos.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px', marginTop: '6px' }}>
              <button type="button" className="btn btn-primary" onClick={onOpenGooglePicker}>
                <ImagePlus size={15} />
                <span>Pick More from Google Photos</span>
              </button>
              <button type="button" className="btn" onClick={onReloadDemo}>
                <span>Load Sample Roll</span>
              </button>
            </div>
          </div>
        ) : (
          <div
            ref={cardRef}
            className={`photo-card ${isDragging ? 'dragging' : ''}`}
            style={{
              transform: `translate3d(${dx}px, ${dy}px, 0) rotate(${rotation}deg)`,
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
          >
            {/* Directional Stamps */}
            <div className="swipe-stamp stamp-print" style={{ opacity: printOpacity }}>
              PRINT →
            </div>
            <div className="swipe-stamp stamp-shown" style={{ opacity: shownOpacity }}>
              ← IGNORE
            </div>
            <div className="swipe-stamp stamp-delete" style={{ opacity: deleteOpacity }}>
              ↑ DELETE
            </div>

            <div className="photo-card-media">
              <img src={current.displayUrl || current.thumbDataUrl} alt={current.filename} />
            </div>

            <div className="photo-card-footer">
              <div style={{ minWidth: 0 }}>
                <div
                  className="font-mono"
                  style={{
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {current.filename}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '11px', marginTop: '2px' }}>
                  {new Date(current.createTime).toLocaleString([], {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  • {current.width}×{current.height}
                </div>
              </div>
              <span
                style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                }}
              >
                ← Ignore • ↑ Delete • → Print
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom 4-Button Mobile Control Deck */}
      <div className="swipe-action-bar">
        <button
          id="btn-swipe-undo"
          type="button"
          className="action-circle-btn"
          disabled={!canUndo}
          onClick={onUndo}
          title="Undo last swipe (Backspace / Z)"
        >
          <RotateCcw size={20} />
          <span>Undo</span>
        </button>

        <button
          id="btn-swipe-left-ignore"
          type="button"
          className="action-circle-btn action-btn-ignore"
          disabled={!current}
          onClick={() => triggerAnimatedSwipe('shown')}
          title="Swipe Left: Ignore & mark as shown so it never appears again (←)"
        >
          <X size={22} />
          <span>Ignore (←)</span>
        </button>

        <button
          id="btn-swipe-up-delete"
          type="button"
          className="action-circle-btn action-btn-delete"
          disabled={!current}
          onClick={() => triggerAnimatedSwipe('delete')}
          title="Swipe Up: Mark photo for deletion (↑)"
        >
          <Trash2 size={20} />
          <span>Delete (↑)</span>
        </button>

        <button
          id="btn-swipe-right-print"
          type="button"
          className="action-circle-btn action-btn-print"
          disabled={!current}
          onClick={() => triggerAnimatedSwipe('print')}
          title="Swipe Right: Mark photo for printing (→)"
        >
          <Heart size={20} />
          <span>Print (→)</span>
        </button>
      </div>
    </main>
  );
};
