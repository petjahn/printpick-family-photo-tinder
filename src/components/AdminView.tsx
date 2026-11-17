import React, { useMemo, useState } from 'react';
import {
  Download,
  Trash2,
  RotateCcw,
  ExternalLink,
  CheckCheck,
  RefreshCw,
  Copy,
  Heart,
  Eye,
  Printer,
} from 'lucide-react';
import { PhotoRecord, PhotoStatus } from '../types';
import { getCachedFullResBlob } from '../services/idbCache';
import { fetchFullResPhotoBlob } from '../services/googlePhotos';
import { buildZipBlob, triggerBrowserDownload, ZipEntryInput } from '../services/zipExport';

interface AdminViewProps {
  records: Record<string, PhotoRecord>;
  accessToken: string;
  onUnmark: (ids: string[]) => Promise<void>;
  onUpdateStatus: (ids: string[], newStatus: PhotoStatus) => Promise<void>;
  onRefreshExpiredViaPicker: () => Promise<void>;
}

type AdminTab = 'print' | 'delete' | 'shown';

export const AdminView: React.FC<AdminViewProps> = ({
  records,
  accessToken,
  onUnmark,
  onUpdateStatus,
  onRefreshExpiredViaPicker,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('print');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [shownFilter, setShownFilter] = useState<'all' | 'shown' | 'printed'>('all');

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

  // Group "Marked for Deletion" items by YYYY-MM-DD capture date for assisted Google Photos cleanup
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
    setStatusMessage(`Unmarked ${targets.length} photo(s) — returned to unseen queue.`);
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
      setStatusMessage(`Fetching photo ${i + 1} of ${targets.length} (${item.filename})...`);

      // 1. Check local IndexedDB full-res cache first
      let blob = await getCachedFullResBlob(item.id);

      // 2. If not cached locally, try live Google Photos baseUrl (valid for 60 minutes)
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
            // URL expired or token missing
          }
        }
      }

      // 3. If full-res URL expired and not in IndexedDB, fallback to thumbnail or flag for Picker refresh
      if (!blob) {
        expiredItems.push(item);
        if (item.thumbDataUrl) {
          const r = await fetch(item.thumbDataUrl);
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
        `Downloaded ZIP (${expiredItems.length} photo(s) had expired 60-min Google URLs — click "Refresh Expired URLs" to re-fetch full resolution).`
      );
    } else {
      setStatusMessage(
        `Downloaded PrintPick_Order_${dateTag}.zip (${zipInputs.length} full-res photos). Click "Mark Batch as Printed" when sent to your print shop!`
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
      `Marked ${targets.length} photo(s) as Printed! They are now archived under "Marked as Shown" and will never be shown again.`
    );
  };

  const handleConfirmDeletedInGooglePhotos = async (ids: string[]) => {
    if (ids.length === 0) return;
    // Transition to 'shown' (or remove) so they remain recorded as already processed and never reappear
    await onUpdateStatus(ids, 'shown');
    setSelectedIds(new Set());
    setStatusMessage(
      `Confirmed ${ids.length} photo(s) deleted in Google Photos and cleared from Deletion queue.`
    );
  };

  return (
    <main className="admin-container" aria-label="Admin Photo Management Console">
      {/* Sub-navigation Tabs */}
      <div className="admin-header-card">
        <div className="admin-subtabs" role="tablist">
          <button
            id="admin-tab-print"
            type="button"
            role="tab"
            aria-selected={activeTab === 'print'}
            className={`admin-tab-btn ${activeTab === 'print' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('print');
              setSelectedIds(new Set());
            }}
          >
            <Printer size={15} color="var(--status-print)" />
            <span>Marked for Print</span>
            <span className="mode-badge">{printItems.length}</span>
          </button>

          <button
            id="admin-tab-delete"
            type="button"
            role="tab"
            aria-selected={activeTab === 'delete'}
            className={`admin-tab-btn ${activeTab === 'delete' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('delete');
              setSelectedIds(new Set());
            }}
          >
            <Trash2 size={15} color="var(--status-delete)" />
            <span>Marked for Deletion</span>
            <span className="mode-badge">{deleteItems.length}</span>
          </button>

          <button
            id="admin-tab-shown"
            type="button"
            role="tab"
            aria-selected={activeTab === 'shown'}
            className={`admin-tab-btn ${activeTab === 'shown' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('shown');
              setSelectedIds(new Set());
            }}
          >
            <Eye size={15} color="var(--status-shown)" />
            <span>Marked as Shown</span>
            <span className="mode-badge">
              {allList.filter((r) => r.status === 'shown' || r.status === 'printed').length}
            </span>
          </button>
        </div>

        {/* Context Action Buttons for Active Tab */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {activeTab === 'print' && (
            <>
              <button
                id="btn-admin-download-zip"
                type="button"
                className="btn btn-primary"
                disabled={printItems.length === 0 || isExportingZip}
                onClick={handleDownloadPrintZip}
              >
                <Download size={15} />
                <span>
                  Download Print ZIP ({selectedIds.size > 0 ? selectedIds.size : printItems.length})
                </span>
              </button>

              <button
                id="btn-admin-mark-printed"
                type="button"
                className="btn btn-success"
                disabled={printItems.length === 0}
                onClick={handleMarkBatchAsPrinted}
                title="Empty Print queue while permanently keeping these photos marked as already printed/shown"
              >
                <CheckCheck size={15} />
                <span>Mark Batch as Printed</span>
              </button>

              <button
                id="btn-admin-refresh-urls"
                type="button"
                className="btn"
                onClick={onRefreshExpiredViaPicker}
                title="Re-open Google Photos Picker to refresh expired 60-minute download URLs"
              >
                <RefreshCw size={14} />
                <span>Refresh Expired URLs</span>
              </button>
            </>
          )}

          {activeTab === 'delete' && (
            <button
              id="btn-admin-confirm-all-deleted"
              type="button"
              className="btn btn-danger"
              disabled={deleteItems.length === 0}
              onClick={() =>
                handleConfirmDeletedInGooglePhotos(
                  selectedIds.size > 0 ? Array.from(selectedIds) : deleteItems.map((i) => i.id)
                )
              }
            >
              <Trash2 size={15} />
              <span>
                Confirm Deleted in Google Photos (
                {selectedIds.size > 0 ? selectedIds.size : deleteItems.length})
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Filter & Bulk Selection Bar */}
      <div className="admin-toolbar">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
          <input
            type="search"
            className="search-input"
            placeholder="Filter by filename, date (YYYY-MM-DD), or family member..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          {activeTab === 'shown' && (
            <div style={{ display: 'flex', gap: '6px' }}>
              {(['all', 'shown', 'printed'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className="btn"
                  style={{
                    borderColor: shownFilter === f ? 'var(--accent-blue)' : undefined,
                  }}
                  onClick={() => setShownFilter(f)}
                >
                  {f === 'all'
                    ? 'All Shown & Printed'
                    : f === 'shown'
                    ? 'Ignored (Swiped Left)'
                    : 'Already Printed'}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="btn"
            disabled={visibleItems.length === 0}
            onClick={selectAllVisible}
          >
            <span>
              {selectedIds.size === visibleItems.length && visibleItems.length > 0
                ? 'Deselect All'
                : `Select All (${visibleItems.length})`}
            </span>
          </button>

          <button
            id="btn-admin-bulk-unmark"
            type="button"
            className="btn"
            disabled={selectedIds.size === 0}
            onClick={handleBulkUnmark}
          >
            <RotateCcw size={14} />
            <span>Unmark Selected ({selectedIds.size})</span>
          </button>
        </div>
      </div>

      {statusMessage && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-color)',
            fontSize: '13px',
            color: 'var(--text-primary)',
          }}
        >
          {statusMessage}
        </div>
      )}

      {/* Tab Content */}
      {visibleItems.length === 0 ? (
        <div
          style={{
            padding: '48px 20px',
            textAlign: 'center',
            background: 'var(--bg-surface)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-secondary)',
            fontSize: '14px',
          }}
        >
          No photos currently in{' '}
          <strong>
            {activeTab === 'print'
              ? 'Marked for Print'
              : activeTab === 'delete'
              ? 'Marked for Deletion'
              : 'Marked as Shown'}
          </strong>
          .
        </div>
      ) : activeTab === 'delete' ? (
        /* Assisted Google Photos Deletion View Grouped by Date */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {deleteGroupsByDate.map(([dateStr, items]) => (
            <div
              key={dateStr}
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                padding: '16px',
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
                  gap: '10px',
                  borderBottom: '1px solid var(--border-subtle)',
                  paddingBottom: '10px',
                }}
              >
                <div>
                  <h3 style={{ fontSize: '14px', fontWeight: 600 }}>
                    Capture Date: <span className="font-mono">{dateStr}</span> ({items.length} photo
                    {items.length > 1 ? 's' : ''})
                  </h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Open this date in Google Photos to move these shots to Trash, then confirm
                    deletion.
                  </p>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  <a
                    href={`https://photos.google.com/search/${encodeURIComponent(dateStr)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn"
                    style={{ textDecoration: 'none' }}
                  >
                    <ExternalLink size={14} />
                    <span>Open {dateStr} in Google Photos</span>
                  </a>

                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      navigator.clipboard?.writeText(items.map((i) => i.filename).join(', '));
                      setStatusMessage(`Copied ${items.length} filename(s) for ${dateStr}`);
                    }}
                  >
                    <Copy size={14} />
                    <span>Copy Filenames</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => handleConfirmDeletedInGooglePhotos(items.map((i) => i.id))}
                  >
                    <Trash2 size={14} />
                    <span>Confirm Date Group Deleted</span>
                  </button>
                </div>
              </div>

              <div className="photo-grid">
                {items.map((item) => (
                  <AdminPhotoCard
                    key={item.id}
                    item={item}
                    selected={selectedIds.has(item.id)}
                    onToggleSelect={() => toggleSelect(item.id)}
                    onUnmark={() => onUnmark([item.id])}
                    secondaryAction={{
                      label: 'Confirm Deleted',
                      onClick: () => handleConfirmDeletedInGooglePhotos([item.id]),
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Standard Grid for "Marked for Print" and "Marked as Shown" */
        <div className="photo-grid">
          {visibleItems.map((item) => (
            <AdminPhotoCard
              key={item.id}
              item={item}
              selected={selectedIds.has(item.id)}
              onToggleSelect={() => toggleSelect(item.id)}
              onUnmark={() => onUnmark([item.id])}
              secondaryAction={
                activeTab === 'shown'
                  ? {
                      label: 'Move to Print',
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

interface AdminPhotoCardProps {
  item: PhotoRecord;
  selected: boolean;
  onToggleSelect: () => void;
  onUnmark: () => void;
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
}

const AdminPhotoCard: React.FC<AdminPhotoCardProps> = ({
  item,
  selected,
  onToggleSelect,
  onUnmark,
  secondaryAction,
}) => {
  const isUrlFresh = !item.baseUrlExpiresAt || Date.now() < item.baseUrlExpiresAt;

  return (
    <div className={`admin-photo-item ${selected ? 'selected' : ''}`}>
      <div className="admin-thumb-wrap" onClick={onToggleSelect} style={{ cursor: 'pointer' }}>
        <img src={item.thumbDataUrl} alt={item.filename} loading="lazy" />
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            width: '17px',
            height: '17px',
            accentColor: 'var(--accent-blue)',
          }}
        />
        {item.status === 'printed' && (
          <span
            style={{
              position: 'absolute',
              top: '10px',
              right: '10px',
              padding: '2px 8px',
              borderRadius: '999px',
              background: 'rgba(16, 185, 129, 0.88)',
              color: '#fff',
              fontSize: '10px',
              fontWeight: 700,
            }}
          >
            PRINTED
          </span>
        )}
      </div>

      <div className="admin-card-body">
        <div>
          <div
            className="font-mono"
            style={{
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={item.filename}
          >
            {item.filename}
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '11px', marginTop: '2px' }}>
            {new Date(item.createTime).toLocaleDateString([], {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}{' '}
            • {item.width}×{item.height}
          </div>
          {item.status === 'print' && (
            <div
              style={{
                fontSize: '11px',
                marginTop: '3px',
                color: isUrlFresh ? 'var(--status-print)' : 'var(--status-shown)',
              }}
            >
              {isUrlFresh ? '● Full-res link active' : '○ 60m link expired (cached or refresh)'}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
          <button
            type="button"
            className="btn"
            style={{ flex: 1, padding: '6px 8px', fontSize: '12px' }}
            onClick={onUnmark}
          >
            <RotateCcw size={13} />
            <span>Unmark</span>
          </button>

          {secondaryAction && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1, padding: '6px 8px', fontSize: '12px' }}
              onClick={secondaryAction.onClick}
            >
              <Heart size={13} />
              <span>{secondaryAction.label}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
