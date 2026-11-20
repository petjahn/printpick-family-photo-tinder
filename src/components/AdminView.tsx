import React, { useEffect, useMemo, useState } from 'react';
import {
  Download,
  Trash2,
  RotateCcw,
  ExternalLink,
  CheckCheck,
  RefreshCw,
  Copy,
  Heart,
  Check,
} from 'lucide-react';
import { PhotoRecord, PhotoStatus } from '../types';
import { getCachedFullResBlob } from '../services/idbCache';
import { fetchFullResPhotoBlob } from '../services/googlePhotos';
import { buildZipBlob, triggerBrowserDownload, ZipEntryInput } from '../services/zipExport';

export type AdminTab = 'print' | 'delete' | 'shown';

interface AdminViewProps {
  records: Record<string, PhotoRecord>;
  accessToken: string;
  initialTab?: AdminTab;
  onUnmark: (ids: string[]) => Promise<void>;
  onUpdateStatus: (ids: string[], newStatus: PhotoStatus) => Promise<void>;
  onRefreshExpiredViaPicker: () => Promise<void>;
}

export const AdminView: React.FC<AdminViewProps> = ({
  records,
  accessToken,
  initialTab = 'print',
  onUnmark,
  onUpdateStatus,
  onRefreshExpiredViaPicker,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [shownFilter, setShownFilter] = useState<'all' | 'shown' | 'printed'>('all');

  useEffect(() => {
    setActiveTab(initialTab);
    setSelectedIds(new Set());
  }, [initialTab]);

  const allList = useMemo(() => Object.values(records), [records]);

  const printItems = useMemo(
    () => allList.filter((r) => r.status === 'print').sort((a, b) => b.updatedAt - a.updatedAt),
    [allList]
  );

  const deleteItems = useMemo(
    () => allList.filter((r) => r.status === 'delete').sort((a, b) => b.updatedAt - a.updatedAt),
    [allList]
  );

  const shownItems = useMemo(
    () =>
      allList
        .filter((r) => {
          if (shownFilter === 'shown') return r.status === 'shown';
          if (shownFilter === 'printed') return r.status === 'printed';
          return r.status === 'shown' || r.status === 'printed';
        })
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [allList, shownFilter]
  );

  const totalHistoryCount = useMemo(
    () => allList.filter((r) => r.status === 'shown' || r.status === 'printed').length,
    [allList]
  );

  const visibleItems = useMemo(() => {
    const base =
      activeTab === 'print' ? printItems : activeTab === 'delete' ? deleteItems : shownItems;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (item) =>
        item.filename.toLowerCase().includes(q) ||
        item.createTime.toLowerCase().includes(q) ||
        (item.updatedBy || '').toLowerCase().includes(q)
    );
  }, [activeTab, printItems, deleteItems, shownItems, searchQuery]);

  const deleteGroupsByDate = useMemo(() => {
    const groups: Record<string, PhotoRecord[]> = {};
    for (const item of visibleItems) {
      const dateStr = (item.createTime || '').slice(0, 10) || 'Unknown Date';
      if (!groups[dateStr]) groups[dateStr] = [];
      groups[dateStr].push(item);
    }
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [visibleItems]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    if (selectedIds.size === visibleItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleItems.map((i) => i.id)));
    }
  };

  const handleBulkUnmark = async () => {
    const targets = Array.from(selectedIds);
    if (targets.length === 0) return;
    await onUnmark(targets);
    setSelectedIds(new Set());
    setStatusMessage(`Returned ${targets.length} photo(s) back to the Swipe deck.`);
  };

  const handleDownloadPrintZip = async () => {
    const targets =
      selectedIds.size > 0
        ? printItems.filter((item) => selectedIds.has(item.id))
        : printItems;

    if (targets.length === 0) return;
    setIsExportingZip(true);
    setStatusMessage(`Preparing ZIP for ${targets.length} photo(s)...`);

    const zipInputs: ZipEntryInput[] = [];
    const expiredItems: PhotoRecord[] = [];

    for (let i = 0; i < targets.length; i++) {
      const item = targets[i];
      setStatusMessage(`Packing ${i + 1} of ${targets.length}: ${item.filename}...`);

      let blob = await getCachedFullResBlob(item.id);

      if (!blob && item.baseUrl) {
        const isStillFresh = !item.baseUrlExpiresAt || Date.now() < item.baseUrlExpiresAt;
        if (isStillFresh) {
          try {
            if (item.baseUrl.startsWith('blob:') || item.baseUrl.startsWith('data:')) {
              const r = await fetch(item.baseUrl);
              blob = await r.blob();
            } else if (accessToken) {
              blob = await fetchFullResPhotoBlob(item.id, item.baseUrl, accessToken);
            }
          } catch {
            // link expired
          }
        }
      }

      if (!blob) {
        expiredItems.push(item);
        const fallbackDataUrl = item.previewDataUrl || item.thumbDataUrl;
        if (fallbackDataUrl) {
          const r = await fetch(fallbackDataUrl);
          blob = await r.blob();
        }
      }

      if (blob) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        zipInputs.push({
          path: `print_order/${item.filename}`,
          bytes,
        });
      }
    }

    const dateTag = new Date().toISOString().slice(0, 10);
    const zipBlob = buildZipBlob(zipInputs);
    triggerBrowserDownload(zipBlob, `PrintPick_Order_${dateTag}.zip`);
    setIsExportingZip(false);

    if (expiredItems.length > 0) {
      setStatusMessage(
        `Downloaded ZIP (${expiredItems.length} photo(s) had expired 60m Google links — tap "Refresh Links" to re-fetch full resolution).`
      );
    } else {
      setStatusMessage(
        `Downloaded PrintPick_Order_${dateTag}.zip (${zipInputs.length} photos). Tap "Mark Printed" once sent to your print shop!`
      );
    }
  };

  const handleMarkBatchAsPrinted = async () => {
    const targets =
      selectedIds.size > 0
        ? printItems.filter((item) => selectedIds.has(item.id)).map((i) => i.id)
        : printItems.map((i) => i.id);
    if (targets.length === 0) return;

    await onUpdateStatus(targets, 'printed');
    setSelectedIds(new Set());
    setStatusMessage(
      `Archived ${targets.length} photo(s) as Printed! Your Print queue is now clear for next month.`
    );
  };

  const handleConfirmDeletedInGooglePhotos = async (ids: string[]) => {
    if (ids.length === 0) return;
    await onUpdateStatus(ids, 'shown');
    setSelectedIds(new Set());
    setStatusMessage(`Cleared ${ids.length} photo(s) from the Deletion list.`);
  };

  return (
    <main className="admin-screen" aria-label="Review and Print Manager">
      {/* Segmented 3-Way Tab Bar */}
      <div className="segmented-tabs" role="tablist">
        <button
          id="admin-tab-print"
          type="button"
          role="tab"
          aria-selected={activeTab === 'print'}
          className={`seg-tab ${activeTab === 'print' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('print');
            setSelectedIds(new Set());
          }}
        >
          <span>Print</span>
          <span className="count-chip">{printItems.length}</span>
        </button>

        <button
          id="admin-tab-delete"
          type="button"
          role="tab"
          aria-selected={activeTab === 'delete'}
          className={`seg-tab ${activeTab === 'delete' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('delete');
            setSelectedIds(new Set());
          }}
        >
          <span>Delete</span>
          <span className="count-chip">{deleteItems.length}</span>
        </button>

        <button
          id="admin-tab-shown"
          type="button"
          role="tab"
          aria-selected={activeTab === 'shown'}
          className={`seg-tab ${activeTab === 'shown' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('shown');
            setSelectedIds(new Set());
          }}
        >
          <span>History</span>
          <span className="count-chip">{totalHistoryCount}</span>
        </button>
      </div>

      {/* Contextual Action Banner */}
      {activeTab === 'print' && (
        <div className="action-banner-card">
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 800, letterSpacing: '-0.02em' }}>
              Ready for Print Shop ({printItems.length})
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--ink-secondary)', marginTop: '2px' }}>
              Download a single ZIP file to send to your local printer, then mark the batch as printed.
            </p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <button
              id="btn-admin-download-zip"
              type="button"
              className="pill-btn pill-btn-emerald"
              disabled={printItems.length === 0 || isExportingZip}
              onClick={handleDownloadPrintZip}
            >
              <Download size={15} />
              <span>
                Download ZIP ({selectedIds.size > 0 ? selectedIds.size : printItems.length})
              </span>
            </button>

            <button
              id="btn-admin-mark-printed"
              type="button"
              className="pill-btn pill-btn-ink"
              disabled={printItems.length === 0}
              onClick={handleMarkBatchAsPrinted}
            >
              <CheckCheck size={15} />
              <span>Mark Printed</span>
            </button>

            <button
              id="btn-admin-refresh-urls"
              type="button"
              className="pill-btn"
              onClick={onRefreshExpiredViaPicker}
              title="Re-pick photos in Google Photos if 60-minute full-res links expired"
            >
              <RefreshCw size={14} />
              <span>Refresh Links</span>
            </button>
          </div>
        </div>
      )}

      {activeTab === 'delete' && deleteItems.length > 0 && (
        <div className="action-banner-card">
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 800, letterSpacing: '-0.02em' }}>
              Google Photos Cleanup Helper ({deleteItems.length})
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--ink-secondary)', marginTop: '2px' }}>
              Open each date in Google Photos to trash blurry shots there, then tap Confirm Deleted.
            </p>
          </div>
          <button
            id="btn-admin-confirm-all-deleted"
            type="button"
            className="pill-btn pill-btn-rose"
            onClick={() =>
              handleConfirmDeletedInGooglePhotos(
                selectedIds.size > 0 ? Array.from(selectedIds) : deleteItems.map((i) => i.id)
              )
            }
          >
            <Trash2 size={15} />
            <span>
              Confirm Deleted ({selectedIds.size > 0 ? selectedIds.size : deleteItems.length})
            </span>
          </button>
        </div>
      )}

      {/* Search + Bulk Actions */}
      <div className="filter-row">
        <input
          type="search"
          className="modern-search"
          placeholder="Search date (2026-11) or filename..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        {activeTab === 'shown' && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {(['all', 'shown', 'printed'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`pill-btn ${shownFilter === f ? 'pill-btn-ink' : ''}`}
                style={{ padding: '7px 12px', fontSize: '12px' }}
                onClick={() => setShownFilter(f)}
              >
                {f === 'all' ? 'All' : f === 'shown' ? 'Skipped' : 'Printed'}
              </button>
            ))}
          </div>
        )}

        {visibleItems.length > 0 && (
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              className="pill-btn"
              style={{ padding: '7px 12px', fontSize: '12px' }}
              onClick={selectAllVisible}
            >
              {selectedIds.size === visibleItems.length ? 'Clear' : 'Select All'}
            </button>

            {selectedIds.size > 0 && (
              <button
                type="button"
                className="pill-btn pill-btn-ink"
                style={{ padding: '7px 12px', fontSize: '12px' }}
                onClick={handleBulkUnmark}
              >
                <RotateCcw size={13} />
                <span>Unmark ({selectedIds.size})</span>
              </button>
            )}
          </div>
        )}
      </div>

      {statusMessage && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-strong)',
            fontSize: '13px',
            fontWeight: 500,
          }}
        >
          {statusMessage}
        </div>
      )}

      {/* Photo Grid or Empty State */}
      {visibleItems.length === 0 ? (
        <div
          style={{
            padding: '56px 24px',
            textAlign: 'center',
            background: 'var(--bg-surface)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-hairline)',
            color: 'var(--ink-secondary)',
            fontSize: '14px',
          }}
        >
          No photos in{' '}
          <strong>
            {activeTab === 'print'
              ? 'Print Queue'
              : activeTab === 'delete'
              ? 'Marked for Deletion'
              : 'Seen History'}
          </strong>{' '}
          yet.
        </div>
      ) : activeTab === 'delete' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {deleteGroupsByDate.map(([dateStr, items]) => (
            <div
              key={dateStr}
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-hairline)',
                borderRadius: 'var(--radius-lg)',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                }}
              >
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 800 }}>{dateStr}</div>
                  <div style={{ fontSize: '12px', color: 'var(--ink-secondary)' }}>
                    {items.length} photo{items.length > 1 ? 's' : ''} marked for deletion
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  <a
                    href={`https://photos.google.com/search/${encodeURIComponent(dateStr)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pill-btn"
                    style={{ textDecoration: 'none', padding: '6px 12px', fontSize: '12px' }}
                  >
                    <ExternalLink size={13} />
                    <span>Open Date in Google Photos</span>
                  </a>

                  <button
                    type="button"
                    className="pill-btn"
                    style={{ padding: '6px 11px', fontSize: '12px' }}
                    onClick={() => {
                      navigator.clipboard?.writeText(items.map((i) => i.filename).join(', '));
                      setStatusMessage(`Copied ${items.length} filename(s) for ${dateStr}`);
                    }}
                  >
                    <Copy size={13} />
                    <span>Copy Names</span>
                  </button>
                </div>
              </div>

              <div className="modern-photo-grid">
                {items.map((item) => (
                  <PhotoTile
                    key={item.id}
                    item={item}
                    selected={selectedIds.has(item.id)}
                    onToggleSelect={() => toggleSelect(item.id)}
                    onUnmark={() => onUnmark([item.id])}
                    secondaryAction={{
                      label: 'Done',
                      onClick: () => handleConfirmDeletedInGooglePhotos([item.id]),
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="modern-photo-grid">
          {visibleItems.map((item) => (
            <PhotoTile
              key={item.id}
              item={item}
              selected={selectedIds.has(item.id)}
              onToggleSelect={() => toggleSelect(item.id)}
              onUnmark={() => onUnmark([item.id])}
              secondaryAction={
                activeTab === 'shown'
                  ? {
                      label: 'Print',
                      isPrint: true,
                      onClick: () => onUpdateStatus([item.id], 'print'),
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </main>
  );
};

interface PhotoTileProps {
  item: PhotoRecord;
  selected: boolean;
  onToggleSelect: () => void;
  onUnmark: () => void;
  secondaryAction?: {
    label: string;
    isPrint?: boolean;
    onClick: () => void;
  };
}

const PhotoTile: React.FC<PhotoTileProps> = ({
  item,
  selected,
  onToggleSelect,
  onUnmark,
  secondaryAction,
}) => {
  return (
    <div className={`photo-tile ${selected ? 'is-selected' : ''}`}>
      <div className="photo-tile-thumb" onClick={onToggleSelect}>
        <img src={item.thumbDataUrl} alt={item.filename} loading="lazy" />

        <div className="tile-check-badge">{selected ? <Check size={13} strokeWidth={3} /> : null}</div>

        {item.status === 'printed' && (
          <span
            style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              padding: '3px 8px',
              borderRadius: '999px',
              background: 'rgba(5, 150, 105, 0.92)',
              color: '#fff',
              fontSize: '10px',
              fontWeight: 800,
              letterSpacing: '0.04em',
            }}
          >
            PRINTED
          </span>
        )}
      </div>

      <div className="photo-tile-footer">
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: '12px',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {new Date(item.createTime).toLocaleDateString([], {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </div>
          <div
            style={{
              fontSize: '11px',
              color: 'var(--ink-muted)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={item.filename}
          >
            {item.filename}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '5px' }}>
          <button
            type="button"
            className="pill-btn"
            style={{ flex: 1, padding: '6px 8px', fontSize: '11px' }}
            onClick={onUnmark}
          >
            <RotateCcw size={12} />
            <span>Unmark</span>
          </button>

          {secondaryAction && (
            <button
              type="button"
              className={`pill-btn ${secondaryAction.isPrint ? 'pill-btn-emerald' : 'pill-btn-ink'}`}
              style={{ flex: 1, padding: '6px 8px', fontSize: '11px' }}
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.isPrint && <Heart size={11} fill="#fff" />}
              <span>{secondaryAction.label}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
